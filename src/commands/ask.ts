import { loadPipeline, ensureWorkflowDirs } from "../workflow/loader.js";
import { runPipeline } from "../workflow/engine.js";

export interface AskOptions {
  repo?: string;
  topK?: string;
}

/**
 * `auto-coder ask` is now a thin wrapper around the `qa` pipeline.
 * This maintains backward compatibility while routing everything
 * through the workflow engine.
 */
export async function askCommand(
  question: string,
  opts: AskOptions,
): Promise<void> {
  ensureWorkflowDirs();

  let pipeline;
  try {
    pipeline = loadPipeline("qa");
  } catch {
    console.error("qa pipeline not found. Run `auto-coder init` to seed default pipelines.");
    process.exit(1);
  }

  const inputs: Record<string, unknown> = { question };
  if (opts.repo) inputs.repo = opts.repo;

  const ctx = await runPipeline(pipeline, inputs);

  if (ctx.status === "completed") {
    const answerStep = ctx.steps["answer"];
    if (answerStep?.output?.text) {
      console.log();
      console.log("━".repeat(70));
      console.log(String(answerStep.output.text).trim());
      console.log("━".repeat(70));
    }

    // Show sources from the context step
    const contextStep = ctx.steps["context"];
    const sources = contextStep?.output?.sources as Array<{
      score: number;
      payload: Record<string, unknown>;
    }> | undefined;
    if (sources && sources.length > 0) {
      console.log();
      console.log("Sources:");
      sources.forEach((s, i) => {
        const p = s.payload;
        console.log(
          `  [DOC-${i + 1}] ${String(p.file_path ?? "")} · ${String(p.doc_type ?? "")}${p.anchor ? ` · ${String(p.anchor)}` : ""}  (score ${s.score.toFixed(3)})`,
        );
      });
    }

    // Token usage
    const answerOut = answerStep?.output;
    if (answerOut?.input_tokens || answerOut?.output_tokens) {
      console.log();
      console.log(`Tokens: ${answerOut.input_tokens ?? "?"} in · ${answerOut.output_tokens ?? "?"} out`);
    }
  } else {
    process.exit(1);
  }
}
