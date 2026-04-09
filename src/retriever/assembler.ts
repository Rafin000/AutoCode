import { Config } from "../config/types.js";
import { GraphClient } from "../knowledge/graph.js";
import { VectorClient, SearchResult } from "../knowledge/vectors.js";

export interface AssembledContext {
  /** The markdown block that will be sent as context to the LLM */
  markdown: string;
  /** Raw vector results so the command layer can print citations */
  sources: SearchResult[];
}

export interface AssembleOptions {
  /** Filter results to a single registered repo, or omit to search all */
  repo?: string;
  /** How many vector matches to include */
  topK?: number;
}

/**
 * Build the context block for a question.
 *
 * Strategy:
 *   1. Vector search — top-K semantically similar documents (the
 *      "substance" of the answer)
 *   2. Graph query — repo + technology summary for structural context
 *      (helps the LLM reason about "what's in scope")
 *
 * Both queries run in parallel. The result is a single markdown string
 * ready to be dropped into a prompt.
 */
export async function assembleContext(
  config: Config,
  question: string,
  opts: AssembleOptions = {},
): Promise<AssembledContext> {
  const topK = opts.topK ?? 8;

  const vectors = new VectorClient(config.knowledge.vectors, config.embedder);
  const graph = new GraphClient(config.knowledge.graph);

  try {
    // Run retrievals in parallel
    const [vectorResults, repoRows, techRows] = await Promise.all([
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
    ]);

    const markdown = formatContext({
      question,
      scopedRepo: opts.repo,
      repos: repoRows as Array<{ name: string; path: string }>,
      technologies: techRows as Array<{ name: string; ecosystem: string | null }>,
      vectorResults,
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
}

function formatContext(input: FormatInput): string {
  const parts: string[] = [];

  // Header
  parts.push("# Context from your indexed work");
  parts.push("");
  if (input.scopedRepo) {
    parts.push(`> Scoped to repo: **${input.scopedRepo}**`);
  } else {
    parts.push("> Searching across all registered repos.");
  }
  parts.push("");

  // Repos section
  if (input.repos.length > 0) {
    parts.push("## Repositories in scope");
    for (const r of input.repos) {
      parts.push(`- **${r.name}** — \`${r.path}\``);
    }
    parts.push("");
  }

  // Technologies section
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

  // Vector results — the main substance
  parts.push("## Relevant code and documentation");
  parts.push("");
  if (input.vectorResults.length === 0) {
    parts.push(
      "_No semantically matching documents found. The answer will rely on " +
        "general knowledge or the structural context above._",
    );
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
