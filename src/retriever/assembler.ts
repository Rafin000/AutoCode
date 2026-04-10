import { Config } from "../config/types.js";
import { GraphClient } from "../knowledge/graph.js";
import { VectorClient, SearchResult } from "../knowledge/vectors.js";
import { getRulesForScope, RuleRow } from "../db/rules.js";
import { listFeatures } from "../db/features.js";

export interface AssembledContext {
  markdown: string;
  sources: SearchResult[];
}

export interface AssembleOptions {
  repo?: string;
  topK?: number;
  /** Include rules in the context (default true for feature prompts) */
  includeRules?: boolean;
  /** Include active conflict warnings (default true for feature prompts) */
  includeConflicts?: boolean;
  /** Current feature ID — excluded from conflict warnings */
  excludeFeatureId?: string;
}

/**
 * Build the context block for a question or feature implementation.
 *
 * Queries run in parallel:
 *   1. Vector search — top-K semantically similar documents
 *   2. Graph query — repo + technology summary
 *   3. Graph query — cross-service edges (BREAKS_IF_CHANGED, CALLS)
 *   4. Rules — hard rules, soft rules, anti-patterns for scope
 *   5. Active features — conflict warnings for in-flight work
 */
export async function assembleContext(
  config: Config,
  question: string,
  opts: AssembleOptions = {},
): Promise<AssembledContext> {
  const topK = opts.topK ?? 8;
  const includeRules = opts.includeRules ?? true;
  const includeConflicts = opts.includeConflicts ?? false;

  const vectors = new VectorClient(config.knowledge.vectors, config.embedder);
  const graph = new GraphClient(config.knowledge.graph);

  try {
    const [vectorResults, repoRows, techRows, crossEdges] = await Promise.all([
      vectors.search(question, topK, opts.repo),
      graph.runCypher(
        opts.repo
          ? "MATCH (r:Repo { repo: $repo }) RETURN r.name AS name, r.path AS path"
          : "MATCH (r:Repo) RETURN r.name AS name, r.path AS path",
        opts.repo ? { repo: opts.repo } : {},
      ),
      graph.runCypher(
        opts.repo
          ? `MATCH (t:Technology { repo: $repo }) RETURN t.name AS name, t.ecosystem AS ecosystem ORDER BY t.name`
          : `MATCH (t:Technology) RETURN DISTINCT t.name AS name, t.ecosystem AS ecosystem ORDER BY t.name`,
        opts.repo ? { repo: opts.repo } : {},
      ),
      // Cross-service edges
      graph.runCypher(
        `MATCH (a)-[r:CALLS|BREAKS_IF_CHANGED|REFERENCES]->(b)
         WHERE a.repo <> b.repo
         RETURN a.repo AS from_repo, a.id AS from_id, type(r) AS rel, r.reason AS reason, b.repo AS to_repo, b.id AS to_id
         LIMIT 30`,
      ),
    ]);

    // Rules (sync, not graph — from SQLite)
    const rules = includeRules ? getRulesForScope(opts.repo ?? "all") : [];

    // Active conflict warnings
    const conflicts = includeConflicts
      ? listFeatures(opts.repo).filter(
          (f) =>
            f.id !== opts.excludeFeatureId &&
            ["planning", "plan_ready", "implementing"].includes(f.status),
        )
      : [];

    const markdown = formatContext({
      question,
      scopedRepo: opts.repo,
      repos: repoRows as Array<{ name: string; path: string }>,
      technologies: techRows as Array<{ name: string; ecosystem: string | null }>,
      vectorResults,
      crossEdges: crossEdges as Array<{
        from_repo: string; from_id: string; rel: string; reason: string | null;
        to_repo: string; to_id: string;
      }>,
      rules,
      conflicts,
    });

    return { markdown, sources: vectorResults };
  } finally {
    await graph.close();
  }
}

interface FormatInput {
  question: string;
  scopedRepo: string | undefined;
  repos: Array<{ name: string; path: string }>;
  technologies: Array<{ name: string; ecosystem: string | null }>;
  vectorResults: SearchResult[];
  crossEdges: Array<{
    from_repo: string; from_id: string; rel: string; reason: string | null;
    to_repo: string; to_id: string;
  }>;
  rules: RuleRow[];
  conflicts: Array<{ id: string; title: string; status: string }>;
}

function formatContext(input: FormatInput): string {
  const parts: string[] = [];

  parts.push("# Context from your indexed work");
  parts.push("");
  if (input.scopedRepo) {
    parts.push(`> Scoped to repo: **${input.scopedRepo}**`);
  } else {
    parts.push("> Searching across all registered repos.");
  }
  parts.push("");

  // Repos
  if (input.repos.length > 0) {
    parts.push("## Repositories in scope");
    for (const r of input.repos) {
      parts.push(`- **${r.name}** — \`${r.path}\``);
    }
    parts.push("");
  }

  // Hard rules
  const hardRules = input.rules.filter((r) => r.type === "hard_rule");
  if (hardRules.length > 0) {
    parts.push("## HARD RULES (must follow — violation = failure)");
    for (const r of hardRules) {
      parts.push(`- [${r.severity ?? "high"}] ${r.rule}`);
    }
    parts.push("");
  }

  // Soft rules / patterns
  const softRules = input.rules.filter((r) => r.type === "soft_rule");
  if (softRules.length > 0) {
    parts.push("## PATTERNS TO FOLLOW");
    for (const r of softRules) {
      parts.push(`- ${r.rule} (confidence: ${r.confidence?.toFixed(2) ?? "?"})`);
    }
    parts.push("");
  }

  // Anti-patterns
  const antiPatterns = input.rules.filter((r) => r.type === "anti_pattern");
  if (antiPatterns.length > 0) {
    parts.push("## ANTI-PATTERNS (do NOT do this)");
    for (const r of antiPatterns) {
      parts.push(`- ${r.rule}${r.prevention ? `\n  Prevention: ${r.prevention}` : ""}`);
    }
    parts.push("");
  }

  // Technologies
  if (input.technologies.length > 0) {
    const byEcosystem: Record<string, string[]> = {};
    for (const t of input.technologies) {
      const eco = t.ecosystem ?? "other";
      if (!byEcosystem[eco]) byEcosystem[eco] = [];
      byEcosystem[eco]!.push(t.name);
    }
    parts.push("## Technologies used");
    for (const [eco, names] of Object.entries(byEcosystem)) {
      parts.push(`- **${eco}**: ${names.join(", ")}`);
    }
    parts.push("");
  }

  // Cross-service impact warnings
  if (input.crossEdges.length > 0) {
    parts.push("## CROSS-SERVICE IMPACT WARNING");
    parts.push("Changes here may affect other repos:");
    for (const e of input.crossEdges) {
      parts.push(`- ${e.from_repo} → ${e.to_repo} [${e.rel}]${e.reason ? `: ${e.reason}` : ""}`);
    }
    parts.push("");
  }

  // Active conflict warnings
  if (input.conflicts.length > 0) {
    parts.push("## ACTIVE CONFLICT WARNING");
    parts.push("These features are currently in-flight on the same repo:");
    for (const f of input.conflicts) {
      parts.push(`- ${f.id} (${f.status}): "${f.title}"`);
    }
    parts.push("Be careful not to conflict with their changes.");
    parts.push("");
  }

  // Vector results
  parts.push("## Relevant code and documentation");
  parts.push("");
  if (input.vectorResults.length === 0) {
    parts.push("_No semantically matching documents found._");
  } else {
    input.vectorResults.forEach((hit, i) => {
      const p = hit.payload;
      const docId = `DOC-${i + 1}`;
      const filePath = String(p.file_path ?? "unknown");
      const docType = String(p.doc_type ?? "unknown");
      const anchor = String(p.anchor ?? "");
      const content = String(p.content ?? "").trim();

      parts.push(
        `### [${docId}] ${filePath} · ${docType}${anchor ? ` · \`${anchor}\`` : ""}`,
      );
      parts.push(`_Relevance score: ${hit.score.toFixed(3)}_`);
      parts.push("");
      parts.push("```");
      parts.push(content);
      parts.push("```");
      parts.push("");
    });
  }

  return parts.join("\n");
}
