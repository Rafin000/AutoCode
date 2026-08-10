import { registerStep } from "../registry.js";
import { StepExecutionContext, StepExecutionResult } from "../types.js";

/**
 * Step: human_review
 *
 * Pauses the pipeline and returns status "paused". The engine writes
 * the run state to SQLite and exits. The user reviews the content
 * (typically the output of a previous llm_generate or save_draft step),
 * then resumes with `autocode run resume <run-id>`.
 *
 * On resume, this step completes immediately with the approved content
 * passed through. (The resume logic in engine.ts will skip already-
 * completed steps and re-enter this one with a "resume" flag.)
 *
 * Config:
 *   prompt:     string  — message shown to the user when pausing (optional)
 *   draft_id:   string  — reference to a saved draft for review (optional)
 */
registerStep("human_review", async (ctx: StepExecutionContext): Promise<StepExecutionResult> => {
  const prompt = (ctx.config.prompt as string) ?? "Review required. Resume when ready.";
  const draftId = ctx.config.draft_id as string | undefined;

  // Check if we're being resumed (the engine passes a __resumed flag)
  if (ctx.config.__resumed) {
    const approvedContent = (ctx.config.__approved_content as string) ?? "";
    return {
      status: "completed",
      output: {
        approved: true,
        approved_content: approvedContent,
      },
    };
  }

  // First time through — pause the pipeline
  console.log();
  console.log(`  ⏸  ${prompt}`);
  if (draftId) {
    console.log(`     Draft ID: ${draftId}`);
    console.log(`     View: autocode draft show ${draftId}`);
  }
  console.log(`     Resume: autocode run resume <run-id>`);

  return {
    status: "paused",
    output: {
      prompt,
      draft_id: draftId ?? null,
      paused_at: new Date().toISOString(),
    },
  };
});
