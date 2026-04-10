import { registerStep } from "../registry.js";
import { StepExecutionContext, StepExecutionResult } from "../types.js";
import { assembleContext } from "../../retriever/assembler.js";
import { loadConfig } from "../../config/loader.js";

/**
 * Step: retrieve_context
 *
 * Queries the knowledge base (graph + vectors) for documents
 * matching a query string. Output includes the formatted markdown
 * block and the raw source list.
 *
 * Config:
 *   query:  string  — the search query (required)
 *   repo:   string  — limit to a single repo (optional)
 *   top_k:  number  — how many docs to retrieve (default: 8)
 */
registerStep("retrieve_context", async (ctx: StepExecutionContext): Promise<StepExecutionResult> => {
  const query = ctx.config.query as string | undefined;
  if (!query) {
    return { status: "failed", output: {}, error: "retrieve_context requires a 'query' in config" };
  }

  const repo = ctx.config.repo as string | undefined;
  const topK = (ctx.config.top_k as number | undefined) ?? 8;
  const config = loadConfig();

  const result = await assembleContext(config, query, { repo, topK });

  return {
    status: "completed",
    output: {
      markdown: result.markdown,
      sources: result.sources,
      source_count: result.sources.length,
    },
  };
});
