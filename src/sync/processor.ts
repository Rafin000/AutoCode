import { RepoConfig, Config } from "../config/types.js";
import { GraphClient } from "../knowledge/graph.js";
import { VectorClient, VectorPoint } from "../knowledge/vectors.js";
import {
  upsertDocuments,
  deleteDocumentsByRepo,
  getDocumentIdsByFile,
  deleteDocumentsByIds,
  upsertRepoState,
  getRepoState,
  countDocumentsByRepo,
} from "../db/queries.js";
import {
  walkRepo,
  getHeadCommit,
  getChangedFiles,
  WalkedFile,
} from "./walker.js";
import { extractFromFile, ExtractedDocument } from "./extractor.js";

export interface SyncOptions {
  quiet?: boolean;
  full?: boolean;
}

export interface SyncReport {
  repo: string;
  mode: "full" | "incremental";
  from_commit: string | null;
  to_commit: string;
  documents_added: number;
  documents_updated: number;
  documents_deleted: number;
  files_processed: number;
  elapsed_ms: number;
}

/**
 * Sync one repo into the knowledge base.
 *
 * Flow:
 *   1. Figure out mode (full vs incremental) based on `--full` and
 *      whether a `last_synced_commit` exists in repo_state
 *   2. Collect extracted documents for the relevant files
 *   3. Delete any stale documents (deleted files or full re-sync)
 *   4. Write documents to SQLite, Neo4j, and Qdrant in that order
 *   5. Update repo_state with new commit hash + count
 *
 * Design notes:
 *   - SQLite is always updated first. It's the source of truth for
 *     "what content is indexed." Graph + vectors are derivative.
 *   - If a later write fails (Neo4j down mid-sync), SQLite still
 *     reflects what we tried to index, so a retry reconciles.
 *   - Repo-level nodes (Repo + Technologies + Skills) are always
 *     upserted so the graph has structural context even on the first
 *     incremental sync.
 */
export async function syncRepo(
  config: Config,
  repoCfg: RepoConfig,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const startedAt = Date.now();
  const log = opts.quiet ? () => {} : console.log;

  log(`• Syncing repo "${repoCfg.name}" at ${repoCfg.path}`);

  const state = getRepoState(repoCfg.name);
  const headCommit = await getHeadCommit(repoCfg.path);

  const isFull = opts.full || !state?.last_synced_commit;
  const mode: "full" | "incremental" = isFull ? "full" : "incremental";

  if (!isFull && state?.last_synced_commit === headCommit) {
    log(`  ✓ Already up to date (commit ${headCommit.slice(0, 8)})`);
    return {
      repo: repoCfg.name,
      mode: "incremental",
      from_commit: state.last_synced_commit,
      to_commit: headCommit,
      documents_added: 0,
      documents_updated: 0,
      documents_deleted: 0,
      files_processed: 0,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  log(`  mode: ${mode}${state?.last_synced_commit ? ` (from ${state.last_synced_commit.slice(0, 8)} → ${headCommit.slice(0, 8)})` : ""}`);

  const graph = new GraphClient(config.knowledge.graph);
  const vectors = new VectorClient(config.knowledge.vectors, config.embedder);

  let filesToProcess: WalkedFile[] = [];
  let filesToDelete: string[] = [];

  if (isFull) {
    // Full re-scan: delete everything for this repo, walk all files
    log("  clearing existing index for this repo...");
    deleteDocumentsByRepo(repoCfg.name);
    await graph.deleteByRepo(repoCfg.name);
    await vectors.deleteByRepo(repoCfg.name);

    log("  walking repo...");
    filesToProcess = await walkRepo(repoCfg.path);
    log(`  found ${filesToProcess.length} indexable files`);
  } else {
    // Incremental: only changed files
    log("  computing diff...");
    const changes = await getChangedFiles(
      repoCfg.path,
      state!.last_synced_commit!,
      headCommit,
    );
    const changedPaths = [
      ...changes.added,
      ...changes.modified,
      ...changes.renamed.map(([, to]) => to),
    ];
    filesToDelete = [
      ...changes.deleted,
      ...changes.renamed.map(([from]) => from),
    ];

    log(`  changes: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length} →${changes.renamed.length}`);

    // Re-use walker's classifier on the paths we need to process.
    // We also need their sizes, so stat each one.
    const allWalked = await walkRepo(repoCfg.path);
    const byPath = new Map(allWalked.map((f) => [f.relativePath, f]));
    for (const p of changedPaths) {
      const walked = byPath.get(p);
      if (walked) filesToProcess.push(walked);
    }
  }

  // Delete stale documents for removed files
  let docsDeleted = 0;
  for (const deletedPath of filesToDelete) {
    const ids = getDocumentIdsByFile(repoCfg.name, deletedPath);
    if (ids.length > 0) {
      docsDeleted += deleteDocumentsByIds(ids);
      // TODO: also delete from graph + vectors by ID (batched)
      // For now, incremental deletes just orphan them; full re-sync will clean up.
    }
  }

  // Extract documents for all files to process
  log(`  extracting documents from ${filesToProcess.length} files...`);
  const allDocs: ExtractedDocument[] = [];
  for (const file of filesToProcess) {
    const docs = extractFromFile(file, repoCfg.name);
    allDocs.push(...docs);
  }
  log(`  extracted ${allDocs.length} documents`);

  // Write SQLite first
  upsertDocuments(allDocs);

  // Build and write the graph
  await writeGraphNodes(graph, repoCfg, allDocs);

  // Embed + upsert to Qdrant
  if (allDocs.length > 0) {
    log(`  embedding ${allDocs.length} documents + upserting to vectors...`);
    const points: VectorPoint[] = allDocs.map((d) => ({
      id: d.id,
      content: d.content,
      payload: {
        repo: d.repo,
        file_path: d.file_path,
        doc_type: d.doc_type,
        anchor: d.anchor,
      },
    }));
    await vectors.upsert(points);
  }

  const finalCount = countDocumentsByRepo(repoCfg.name);
  upsertRepoState(repoCfg.name, headCommit, finalCount);

  await graph.close();

  const report: SyncReport = {
    repo: repoCfg.name,
    mode,
    from_commit: state?.last_synced_commit ?? null,
    to_commit: headCommit,
    documents_added: allDocs.length,
    documents_updated: 0,
    documents_deleted: docsDeleted,
    files_processed: filesToProcess.length,
    elapsed_ms: Date.now() - startedAt,
  };

  log(`  ✓ Done in ${(report.elapsed_ms / 1000).toFixed(1)}s — ${finalCount} total docs`);
  return report;
}

/**
 * Write repo-level + per-document nodes/edges to Neo4j.
 *
 * Schema (for v1):
 *   (Repo)-[:CONTAINS]->(Function|Class|Document)
 *   (Repo)-[:USES]->(Technology)
 */
async function writeGraphNodes(
  graph: GraphClient,
  repoCfg: RepoConfig,
  docs: ExtractedDocument[],
): Promise<void> {
  const repoNodeId = `${repoCfg.name}:repo`;

  // Repo node itself
  await graph.upsertNode("Repo", repoNodeId, {
    name: repoCfg.name,
    repo: repoCfg.name,
    path: repoCfg.path,
  });

  // Group docs by node label
  const functions: Array<{ id: string; props: Record<string, unknown> }> = [];
  const classes: Array<{ id: string; props: Record<string, unknown> }> = [];
  const documents: Array<{ id: string; props: Record<string, unknown> }> = [];
  const technologies: Array<{ id: string; props: Record<string, unknown> }> = [];

  for (const doc of docs) {
    const baseProps = {
      repo: doc.repo,
      file_path: doc.file_path,
      anchor: doc.anchor,
      doc_type: doc.doc_type,
    };

    switch (doc.doc_type) {
      case "function":
        functions.push({ id: doc.id, props: baseProps });
        break;
      case "class":
        classes.push({ id: doc.id, props: baseProps });
        break;
      case "readme_section":
      case "markdown_section":
      case "test_file":
        documents.push({ id: doc.id, props: baseProps });
        break;
      case "technology":
        technologies.push({
          id: doc.id,
          props: {
            ...baseProps,
            name: doc.anchor,
            ecosystem: (doc.metadata.ecosystem as string) ?? "unknown",
          },
        });
        break;
    }
  }

  // Batch upsert nodes
  await graph.upsertNodes("Function", functions);
  await graph.upsertNodes("Class", classes);
  await graph.upsertNodes("Document", documents);
  await graph.upsertNodes("Technology", technologies);

  // Edges: Repo contains each function/class/document
  for (const n of [...functions, ...classes, ...documents]) {
    await graph.upsertEdge(repoNodeId, n.id, "CONTAINS");
  }
  // Repo uses each technology
  for (const n of technologies) {
    await graph.upsertEdge(repoNodeId, n.id, "USES");
  }
}
