import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/loader.js";
import { GraphClient } from "../knowledge/graph.js";
import { spawnClaudeCli, defaultEventPrinter } from "../orchestrator/spawner.js";

export interface LinkOptions {
  skipScan?: boolean;
  timeout?: string;
}

/**
 * Analyze two repos for cross-service dependencies using Claude CLI.
 *
 * Flow (matches repo-agent's link command):
 *   1. Fetch all code nodes for both repos from Neo4j
 *   2. Build a prompt with both repos' nodes
 *   3. Spawn Claude CLI to analyze relationships
 *   4. Claude writes .agent-link.json with edges
 *   5. Validate edges (must be cross-service, valid types)
 *   6. Create edges in Neo4j
 */
export async function linkCommand(
  svc1: string,
  svc2: string,
  opts: LinkOptions,
): Promise<void> {
  const config = loadConfig();

  const repo1 = config.repos.find((r) => r.name === svc1);
  const repo2 = config.repos.find((r) => r.name === svc2);
  if (!repo1) { console.error(`No repo named "${svc1}"`); process.exit(1); }
  if (!repo2) { console.error(`No repo named "${svc2}"`); process.exit(1); }

  const graph = new GraphClient(config.knowledge.graph);

  try {
    await graph.verifyConnectivity();
    console.log(`• Analyzing cross-service dependencies: ${svc1} ↔ ${svc2}`);

    // Step 1: Fetch code nodes for both repos
    console.log("  Fetching nodes from graph...");
    const nodes1 = await graph.runCypher(
      `MATCH (n) WHERE n.repo = $repo AND NOT n:HardRule AND NOT n:SoftRule AND NOT n:AntiPattern
       RETURN n.id AS id, labels(n)[0] AS label, n.anchor AS anchor, n.file_path AS file_path, n.doc_type AS doc_type`,
      { repo: svc1 },
    );
    const nodes2 = await graph.runCypher(
      `MATCH (n) WHERE n.repo = $repo AND NOT n:HardRule AND NOT n:SoftRule AND NOT n:AntiPattern
       RETURN n.id AS id, labels(n)[0] AS label, n.anchor AS anchor, n.file_path AS file_path, n.doc_type AS doc_type`,
      { repo: svc2 },
    );

    console.log(`  ${svc1}: ${nodes1.length} nodes`);
    console.log(`  ${svc2}: ${nodes2.length} nodes`);

    if (nodes1.length === 0 || nodes2.length === 0) {
      console.error("  ✗ One or both repos have no indexed nodes. Run `auto-coder sync` first.");
      process.exit(1);
    }

    // Step 2: Check for existing link result file
    const linkFile = path.join(repo1.path, ".agent-link.json");
    let linkResult: LinkResult | null = null;

    if (opts.skipScan && fs.existsSync(linkFile)) {
      console.log("  --skip-scan: reusing existing .agent-link.json");
      linkResult = JSON.parse(fs.readFileSync(linkFile, "utf-8")) as LinkResult;
    } else {
      // Step 3: Build prompt and spawn Claude
      const prompt = buildLinkPrompt(svc1, svc2, nodes1, nodes2);

      console.log("  Spawning Claude CLI to analyze cross-service dependencies...");
      console.log();
      const result = await spawnClaudeCli({
        prompt,
        workingDir: repo1.path,
        onEvent: defaultEventPrinter,
        maxTimeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : 0,
      });
      console.log();

      if (result.exitCode !== 0) {
        throw new Error(`Claude CLI exited with code ${result.exitCode}`);
      }

      // Step 4: Read the link result
      if (!fs.existsSync(linkFile)) {
        throw new Error("Claude did not write .agent-link.json");
      }
      linkResult = JSON.parse(fs.readFileSync(linkFile, "utf-8")) as LinkResult;
    }

    if (!linkResult || !linkResult.edges || linkResult.edges.length === 0) {
      console.log("  No cross-service dependencies found.");
      return;
    }

    // Step 5: Validate and create edges
    console.log(`  Found ${linkResult.edges.length} cross-service edges`);
    const validTypes = new Set(["CALLS", "BREAKS_IF_CHANGED", "REFERENCES"]);
    let created = 0;

    for (const edge of linkResult.edges) {
      // Validate: must be cross-service and a valid type
      if (!validTypes.has(edge.type)) {
        console.warn(`  ⚠ Skipping invalid edge type "${edge.type}"`);
        continue;
      }

      // Verify both nodes exist
      const fromNode = [...nodes1, ...nodes2].find((n) => n.id === edge.from);
      const toNode = [...nodes1, ...nodes2].find((n) => n.id === edge.to);

      if (!fromNode || !toNode) {
        console.warn(`  ⚠ Skipping edge with unknown node: ${edge.from} → ${edge.to}`);
        continue;
      }

      // Must be cross-service (different repos)
      const fromRepo = String(edge.from).split(":")[0];
      const toRepo = String(edge.to).split(":")[0];
      if (fromRepo === toRepo) {
        continue; // silently skip same-repo edges
      }

      await graph.upsertEdge(String(edge.from), String(edge.to), edge.type as any, {
        reason: edge.reason ?? "",
        source: "link-analysis",
      });
      created++;
    }

    console.log(`  ✓ Created ${created} cross-service edges in Neo4j`);

    // Cleanup
    try { fs.unlinkSync(linkFile); } catch { /* fine */ }

  } catch (err) {
    console.error(`✗ Linking failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await graph.close();
  }
}

interface LinkResult {
  edges: Array<{
    from: string;
    to: string;
    type: string;
    reason?: string;
  }>;
}

function buildLinkPrompt(
  svc1: string,
  svc2: string,
  nodes1: Record<string, unknown>[],
  nodes2: Record<string, unknown>[],
): string {
  const formatNodes = (nodes: Record<string, unknown>[]) =>
    nodes
      .map((n) => `  - [${n.label}] ${n.id} — ${n.anchor ?? ""} (${n.file_path ?? ""})`)
      .join("\n");

  return `You are an expert software architect analyzing cross-service dependencies between two codebases.

## SERVICE 1: ${svc1}

Nodes in the knowledge graph:
${formatNodes(nodes1)}

## SERVICE 2: ${svc2}

Nodes in the knowledge graph:
${formatNodes(nodes2)}

## YOUR TASK

Analyze these two services and identify cross-service dependencies. Look for:

1. **CALLS** — a function in one service that calls an endpoint or function in the other
   (e.g. service A's HTTP client calls service B's API endpoint)
2. **BREAKS_IF_CHANGED** — if you change something in one service, it would break the other
   (e.g. shared data schemas, event payloads, API contracts)
3. **REFERENCES** — code in one service that references or imports from the other
   (e.g. shared types, constants, utilities)

Write your analysis to a file called \`.agent-link.json\` in the current directory. The file must be a JSON object:

\`\`\`json
{
  "edges": [
    {
      "from": "node-id-from-service-1-or-2",
      "to": "node-id-from-service-1-or-2",
      "type": "CALLS" | "BREAKS_IF_CHANGED" | "REFERENCES",
      "reason": "brief explanation of why this dependency exists"
    }
  ]
}
\`\`\`

Rules:
- Every edge MUST connect a node from service 1 to a node in service 2 (or vice versa)
- Use the EXACT node IDs from the lists above
- Only include edges you're confident about — quality over quantity
- If there are no real cross-service dependencies, write \`{ "edges": [] }\`
- Do not invent node IDs that aren't in the lists

Write the file and stop.`;
}
