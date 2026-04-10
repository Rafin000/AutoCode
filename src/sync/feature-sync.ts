import fs from "node:fs";
import path from "node:path";
import { Config, RepoConfig } from "../config/types.js";
import { FeatureRow, updateFeature } from "../db/features.js";
import { GraphClient } from "../knowledge/graph.js";
import { VectorClient, VectorPoint } from "../knowledge/vectors.js";
import {
  upsertDocuments,
  deleteDocumentsByIds,
  getDocumentIdsByFile,
  countDocumentsByRepo,
  upsertRepoState,
} from "../db/queries.js";
import { getChangedFiles, getHeadCommit, classifyFile } from "./walker.js";
import { extractFromFile, ExtractedDocument } from "./extractor.js";
import { createRule, RuleType } from "../db/rules.js";
import { getRepoState } from "../db/queries.js";

/**
 * Sync processor for feature approval.
 *
 * When a feature is approved (after the PR is merged), this function:
 *   1. Diffs the merged code against the last synced state
 *   2. Extracts new/modified documents from changed files
 *   3. Updates SQLite + Neo4j + Qdrant with the changes
 *   4. Extracts anti-patterns from rework history (if any)
 *   5. Updates the repo's sync checkpoint
 *
 * This is the equivalent of repo-agent's sync.processor.ts, but
 * focused on post-merge knowledge updates rather than full re-indexing.
 */
export async function syncFeatureApproval(
  config: Config,
  repoCfg: RepoConfig,
  feature: FeatureRow,
): Promise<void> {
  console.log(`• Syncing knowledge from feature ${feature.id}...`);

  const headCommit = await getHeadCommit(repoCfg.path);
  const repoState = getRepoState(repoCfg.name);
  const lastCommit = repoState?.last_synced_commit;

  if (!lastCommit) {
    console.log("  (no previous sync — run `auto-coder sync` for a full index)");
    return;
  }

  // Get the diff from last sync to current HEAD
  const changes = await getChangedFiles(repoCfg.path, lastCommit, headCommit);
  const changedPaths = [
    ...changes.added,
    ...changes.modified,
    ...changes.renamed.map(([, to]) => to),
  ];
  const deletedPaths = [
    ...changes.deleted,
    ...changes.renamed.map(([from]) => from),
  ];

  console.log(`  changes: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length}`);

  if (changedPaths.length === 0 && deletedPaths.length === 0) {
    console.log("  (no file changes to sync)");
    upsertRepoState(repoCfg.name, headCommit, countDocumentsByRepo(repoCfg.name));
    return;
  }

  // Delete stale docs for removed files
  for (const deletedPath of deletedPaths) {
    const ids = getDocumentIdsByFile(repoCfg.name, deletedPath);
    if (ids.length > 0) deleteDocumentsByIds(ids);
  }

  // Extract and upsert new/modified docs
  const allDocs: ExtractedDocument[] = [];
  for (const filePath of changedPaths) {
    const absPath = path.join(repoCfg.path, filePath);
    if (!fs.existsSync(absPath)) continue;

    const category = classifyFile(filePath);
    if (category === "other") continue;

    const stat = fs.statSync(absPath);
    const docs = extractFromFile(
      {
        relativePath: filePath,
        absolutePath: absPath,
        category,
        bytes: stat.size,
      },
      repoCfg.name,
    );
    allDocs.push(...docs);
  }

  if (allDocs.length > 0) {
    console.log(`  extracted ${allDocs.length} documents from changed files`);

    // SQLite
    upsertDocuments(allDocs);

    // Neo4j
    const graph = new GraphClient(config.knowledge.graph);
    try {
      for (const doc of allDocs) {
        const label =
          doc.doc_type === "function" ? "Function" :
          doc.doc_type === "class" ? "Class" :
          doc.doc_type === "technology" ? "Technology" :
          "Document";
        await graph.upsertNode(label, doc.id, {
          repo: doc.repo,
          file_path: doc.file_path,
          anchor: doc.anchor,
          doc_type: doc.doc_type,
        });
      }
    } finally {
      await graph.close();
    }

    // Qdrant
    const vectors = new VectorClient(config.knowledge.vectors, config.embedder);
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

  // Extract anti-patterns from rework history
  if (feature.rework_history.length > 0) {
    console.log(`  extracting ${feature.rework_history.length} anti-pattern(s) from rework history...`);
    for (const rework of feature.rework_history) {
      createRule({
        type: "anti_pattern" as RuleType,
        rule: rework.instructions,
        scope: repoCfg.name,
        source: feature.id,
        source_detail: `Rework instruction from feature ${feature.id}`,
        prevention: `Applied as rework on ${rework.timestamp}`,
      });
    }
  }

  // Update sync checkpoint
  const finalCount = countDocumentsByRepo(repoCfg.name);
  upsertRepoState(repoCfg.name, headCommit, finalCount);

  console.log(`  ✓ Knowledge synced — ${finalCount} total docs`);
}
