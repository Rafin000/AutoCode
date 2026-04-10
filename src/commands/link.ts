import { loadConfig } from "../config/loader.js";
import { GraphClient } from "../knowledge/graph.js";

export interface LinkOptions {
  timeout?: string;
}

/**
 * Analyze two repos for cross-service dependencies and create
 * linking edges in the graph (CALLS, BREAKS_IF_CHANGED, REFERENCES).
 *
 * Strategy (v1 — heuristic, no LLM):
 *   1. Load all Function + Class nodes for both repos from Neo4j
 *   2. For each function in repo A that mentions a path or name
 *      matching something in repo B → create a REFERENCES edge
 *   3. For each Technology used by both repos → note shared dependency
 *
 * This is simpler than repo-agent's approach (which spawns Claude
 * to analyze cross-service calls). We can upgrade to LLM-based
 * linking later.
 */
export async function linkCommand(
  svc1: string,
  svc2: string,
  _opts: LinkOptions,
): Promise<void> {
  const config = loadConfig();

  const repo1 = config.repos.find((r) => r.name === svc1);
  const repo2 = config.repos.find((r) => r.name === svc2);
  if (!repo1) { console.error(`No repo named "${svc1}"`); process.exit(1); }
  if (!repo2) { console.error(`No repo named "${svc2}"`); process.exit(1); }

  const graph = new GraphClient(config.knowledge.graph);

  try {
    await graph.verifyConnectivity();
    console.log(`• Linking ${svc1} ↔ ${svc2}`);

    // Find shared technologies
    const techs1 = await graph.findByLabel("Technology", { key: "repo", value: svc1 });
    const techs2 = await graph.findByLabel("Technology", { key: "repo", value: svc2 });
    const techNames1 = new Set(techs1.map((t) => t.name as string));
    const sharedTechs = techs2.filter((t) => techNames1.has(t.name as string));

    if (sharedTechs.length > 0) {
      console.log(`  Shared technologies: ${sharedTechs.map((t) => t.name).join(", ")}`);
    }

    // Find functions in each repo
    const fns1 = await graph.findByLabel("Function", { key: "repo", value: svc1 });
    const fns2 = await graph.findByLabel("Function", { key: "repo", value: svc2 });

    // Heuristic cross-references: function names that appear in each other's file paths or anchors
    const names1 = new Map(fns1.map((f) => [String(f.anchor ?? f.id).toLowerCase(), f]));
    const names2 = new Map(fns2.map((f) => [String(f.anchor ?? f.id).toLowerCase(), f]));

    let edgesCreated = 0;

    // Check if any function in repo1 references something in repo2
    for (const fn of fns1) {
      const fnName = String(fn.anchor ?? "").toLowerCase();
      if (fnName && names2.has(fnName)) {
        const target = names2.get(fnName)!;
        await graph.upsertEdge(String(fn.id), String(target.id), "REFERENCES", {
          reason: `Shared function name "${fnName}" across repos`,
        });
        edgesCreated++;
      }
    }

    // Reverse direction
    for (const fn of fns2) {
      const fnName = String(fn.anchor ?? "").toLowerCase();
      if (fnName && names1.has(fnName)) {
        const target = names1.get(fnName)!;
        await graph.upsertEdge(String(fn.id), String(target.id), "REFERENCES", {
          reason: `Shared function name "${fnName}" across repos`,
        });
        edgesCreated++;
      }
    }

    // Create BREAKS_IF_CHANGED for shared technologies
    for (const tech of sharedTechs) {
      const tech1Match = techs1.find((t) => t.name === tech.name);
      if (tech1Match) {
        await graph.upsertEdge(String(tech1Match.id), String(tech.id), "BREAKS_IF_CHANGED", {
          reason: `Both repos depend on "${tech.name}"`,
        });
        edgesCreated++;
      }
    }

    console.log(`  ✓ Created ${edgesCreated} cross-service edges`);
    console.log(`  ${svc1}: ${fns1.length} functions, ${techs1.length} technologies`);
    console.log(`  ${svc2}: ${fns2.length} functions, ${techs2.length} technologies`);
  } catch (err) {
    console.error(`✗ Linking failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await graph.close();
  }
}
