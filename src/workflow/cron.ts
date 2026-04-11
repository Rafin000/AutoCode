import { loadPipeline, listPipelines } from "./loader.js";
import { runPipeline } from "./engine.js";

/**
 * Cron runner — checks all pipelines for a `trigger: cron` field
 * with a matching schedule, and runs them.
 *
 * Pipeline YAML format:
 *   trigger: cron
 *   schedule: "0 9 * * MON"   # standard cron expression
 *
 * For v1 we don't do real cron matching — we just run every pipeline
 * that has trigger: cron. The user invokes this from their system
 * crontab at the desired interval:
 *
 *   0 9 * * MON /path/to/auto-coder cron
 *
 * This keeps it simple — no daemon, no cron parser dependency.
 */
export async function runCronPipelines(opts: { quiet?: boolean }): Promise<void> {
  const log = opts.quiet ? () => {} : console.log;
  const allPipelines = listPipelines();

  const cronPipelines = allPipelines.filter(
    (p) => (p as any).trigger === "cron",
  );

  if (cronPipelines.length === 0) {
    log("No pipelines with trigger: cron found.");
    log('Add `trigger: cron` to a pipeline YAML to enable scheduled runs.');
    return;
  }

  log(`Found ${cronPipelines.length} cron pipeline(s)`);
  log();

  for (const pipeline of cronPipelines) {
    log(`• Running: ${pipeline.name}`);
    try {
      // Use default inputs from the pipeline's input spec
      const inputs: Record<string, unknown> = {};
      if (pipeline.inputs) {
        for (const [key, spec] of Object.entries(pipeline.inputs)) {
          if (spec.default !== undefined) {
            inputs[key] = spec.default;
          }
        }
      }

      const ctx = await runPipeline(pipeline, inputs, { quiet: opts.quiet });

      if (ctx.status === "completed") {
        log(`  ✓ Completed`);
      } else if (ctx.status === "paused") {
        log(`  ⏸ Paused (has a review gate — resume manually)`);
      } else {
        log(`  ✗ ${ctx.status}: ${ctx.error ?? "unknown error"}`);
      }
    } catch (err) {
      log(`  ✗ Failed: ${(err as Error).message}`);
    }
    log();
  }
}
