import { loadConfig } from "../config/loader.js";
import { GraphClient } from "../knowledge/graph.js";
import { getDbStats } from "../db/init.js";

/**
 * Smoke-test the Neo4j connection end-to-end:
 * 1. Verify connectivity
 * 2. Upsert a throwaway node
 * 3. Query it back
 * 4. Delete it
 *
 * Use this after `init` to confirm the graph is wired up before running
 * any real sync.
 */
export async function knowledgeTestGraphCommand(): Promise<void> {
  const config = loadConfig();
  const graph = new GraphClient(config.knowledge.graph);

  try {
    console.log(`• Connecting to ${config.knowledge.graph.url}...`);
    await graph.verifyConnectivity();
    console.log("  ✓ Connected");

    const testRepo = "__auto-coder-smoke-test__";
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
    console.log(`  ✓ Found 1 node: ${JSON.stringify(found[0])}`);

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
}
