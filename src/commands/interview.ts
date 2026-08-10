import { loadPipeline, ensureWorkflowDirs } from "../workflow/loader.js";
import { runPipeline } from "../workflow/engine.js";

export interface InterviewOptions {
  repo?: string;
  topK?: string;
}

/**
 * `autocode interview` is now a thin wrapper around the `interview` pipeline.
 */
export async function interviewCommand(
  question: string,
  opts: InterviewOptions,
): Promise<void> {
  ensureWorkflowDirs();

  let pipeline;
  try {
    pipeline = loadPipeline("interview");
  } catch {
    console.error("interview pipeline not found. Run `autocode init` to seed defaults.");
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

    const contextStep = ctx.steps["context"];
    const sources = contextStep?.output?.sources as Array<{
      score: number;
      payload: Record<string, unknown>;
    }> | undefined;
    if (sources && sources.length > 0) {
      console.log();
      console.log("Grounded in:");
      sources.forEach((s, i) => {
        const p = s.payload;
        console.log(
          `  [DOC-${i + 1}] ${String(p.file_path ?? "")} · ${String(p.doc_type ?? "")}${p.anchor ? ` · ${String(p.anchor)}` : ""}`,
        );
      });
    }

    if (answerStep?.output?.input_tokens || answerStep?.output?.output_tokens) {
      console.log();
      console.log(
        `Tokens: ${answerStep.output.input_tokens ?? "?"} in · ${answerStep.output.output_tokens ?? "?"} out`,
      );
    }
  } else {
    process.exit(1);
  }
}
