import { loadConfig } from "../config/loader.js";
import { GraphClient } from "../knowledge/graph.js";
import { VectorClient, VectorPoint } from "../knowledge/vectors.js";
import { getDbStats } from "../db/init.js";

/**
 * Smoke-test the Neo4j connection end-to-end:
 * 1. Verify connectivity
 * 2. Upsert a throwaway node
 * 3. Query it back
 * 4. Delete it
 */
export async function knowledgeTestGraphCommand(): Promise<void> {
  const config = loadConfig();
  const graph = new GraphClient(config.knowledge.graph);

  try {
    console.log(`• Connecting to ${config.knowledge.graph.url}...`);
    await graph.verifyConnectivity();
    console.log("  ✓ Connected");

    const testRepo = "__autocode-smoke-test__";
    const testNodeId = `repo:${testRepo}`;

    console.log("• Upserting a test Repo node...");
    await graph.upsertNode("Repo", testNodeId, {
      name: testRepo,
      repo: testRepo,
      path: "/tmp/nowhere",
      smoke_test: true,
    });
    console.log("  ✓ Upserted");

    console.log("• Querying it back by label...");
    const found = await graph.findByLabel("Repo", { key: "repo", value: testRepo });
    if (found.length !== 1) {
      throw new Error(`Expected 1 test node, got ${found.length}`);
    }
    console.log(`  ✓ Found 1 node`);

    console.log("• Cleaning up test node...");
    const deleted = await graph.deleteByRepo(testRepo);
    console.log(`  ✓ Deleted ${deleted} node(s)`);

    console.log();
    console.log("Neo4j is wired up correctly ✨");
  } catch (err) {
    console.error();
    console.error("✗ Graph smoke test failed:");
    console.error("  ", (err as Error).message);
    console.error();
    console.error("Common causes:");
    console.error("  - Neo4j not running: `docker ps` should show a neo4j container");
    console.error("  - Wrong password: check `knowledge.graph.password` in your config");
    console.error("  - Wrong URL: default is bolt://localhost:7687");
    process.exit(1);
  } finally {
    await graph.close();
  }
}

/**
 * Smoke-test the Qdrant connection end-to-end:
 * 1. Verify connectivity
 * 2. Ensure collection exists
 * 3. Upsert two test documents (triggers embedding model download on first run)
 * 4. Run a semantic search and confirm the best match is the right one
 * 5. Delete test points
 */
export async function knowledgeTestVectorsCommand(): Promise<void> {
  const config = loadConfig();
  const vectors = new VectorClient(config.knowledge.vectors, config.embedder);

  try {
    console.log(`• Connecting to ${config.knowledge.vectors.url}...`);
    await vectors.verifyConnectivity();
    console.log("  ✓ Connected");

    console.log(`• Ensuring collection "${config.knowledge.vectors.collection}" exists...`);
    await vectors.ensureCollection();
    console.log("  ✓ Ready");

    const testRepo = "__autocode-smoke-test__";
    const testDocs: VectorPoint[] = [
      {
        id: `${testRepo}:retry`,
        content: "Implement exponential backoff retry when the API returns 5xx errors",
        payload: {
          repo: testRepo,
          doc_type: "function",
          file_path: "src/retry.ts",
        },
      },
      {
        id: `${testRepo}:kittens`,
        content: "Kittens are small fluffy animals that love to chase string",
        payload: {
          repo: testRepo,
          doc_type: "function",
          file_path: "src/cat.ts",
        },
      },
    ];

    console.log("• Embedding + upserting 2 test documents");
    console.log("  (first run downloads ~90MB embedding model — one-time)...");
    await vectors.upsert(testDocs);
    console.log("  ✓ Upserted");

    const query = "how to retry failed API calls";
    console.log(`• Semantic search: "${query}"`);
    const results = await vectors.search(query, 2, testRepo);
    if (results.length === 0) {
      throw new Error("No search results returned");
    }
    console.log(`  ✓ Got ${results.length} results`);
    results.forEach((r, i) => {
      const content = String(r.payload?.content ?? "").slice(0, 60);
      console.log(`    ${i + 1}. [${r.score.toFixed(3)}] ${content}`);
    });
    // Sanity check: retry doc should score higher than kittens
    const topPayload = results[0]?.payload;
    const topContent = String(topPayload?.content ?? "");
    if (!topContent.toLowerCase().includes("retry")) {
      throw new Error(`Top match was not the retry doc: ${topContent}`);
    }

    console.log("• Cleaning up test points...");
    await vectors.deleteByRepo(testRepo);
    console.log("  ✓ Deleted");

    console.log();
    console.log("Qdrant + embedder are wired up correctly ✨");
  } catch (err) {
    console.error();
    console.error("✗ Vector smoke test failed:");
    console.error("  ", (err as Error).message);
    console.error();
    console.error("Common causes:");
    console.error("  - Qdrant not running: `docker ps` should show a qdrant container");
    console.error("  - Wrong URL: default is http://localhost:6333");
    console.error("  - First-run model download blocked by network");
    process.exit(1);
  }
}

/**
 * Print a summary of what's currently indexed across all three stores.
 */
export async function knowledgeStatsCommand(): Promise<void> {
  const config = loadConfig();

  // SQLite side
  const dbStats = getDbStats();
  console.log("# SQLite (local state)");
  console.log(`  schema version: ${dbStats.schema_version}`);
  console.log(`  repo_state rows: ${dbStats.repo_count}`);
  console.log(`  documents: ${dbStats.document_count}`);
  console.log();

  // Neo4j side
  console.log("# Neo4j (graph)");
  const graph = new GraphClient(config.knowledge.graph);
  try {
    await graph.verifyConnectivity();
    const rows = (await graph.runCypher(
      "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count",
    )) as Array<{ label: string; count: number }>;
    if (rows.length === 0) {
      console.log("  (empty)");
    } else {
      for (const row of rows) {
        console.log(`  ${String(row.label ?? "(unlabeled)").padEnd(16)}${row.count}`);
      }
    }
  } catch (err) {
    console.log(`  (unreachable — ${(err as Error).message})`);
  } finally {
    await graph.close();
  }
  console.log();

  // Qdrant side
  console.log(`# Qdrant (vectors · collection "${config.knowledge.vectors.collection}")`);
  const vectors = new VectorClient(config.knowledge.vectors, config.embedder);
  try {
    await vectors.verifyConnectivity();
    const count = await vectors.count();
    console.log(`  points: ${count}`);
  } catch (err) {
    console.log(`  (unreachable — ${(err as Error).message})`);
  }
}
