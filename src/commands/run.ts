import { loadPipeline, listPipelines, ensureWorkflowDirs } from "../workflow/loader.js";
import { runPipeline, resumeRun } from "../workflow/engine.js";
import { listRuns, getRun, deleteRun } from "../db/runs.js";

/* ───── parse --input flags ───────────────────────────────────────── */

/**
 * Parses repeatable `-i key=value` flags into a record.
 * Values are kept as strings — the pipeline input spec can coerce.
 */
export function parseInputs(rawInputs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of rawInputs) {
    const eqIdx = raw.indexOf("=");
    if (eqIdx < 0) {
      throw new Error(`Bad input "${raw}" — expected key=value`);
    }
    const key = raw.slice(0, eqIdx).trim();
    const value = raw.slice(eqIdx + 1);
    if (!key) throw new Error(`Bad input "${raw}" — empty key`);
    out[key] = value;
  }
  return out;
}

/* ───── run <pipeline> ────────────────────────────────────────────── */

export async function runExecuteCommand(
  pipelineName: string,
  opts: { input?: string[] },
): Promise<void> {
  ensureWorkflowDirs();
  let pipeline;
  try {
    pipeline = loadPipeline(pipelineName);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  let inputs: Record<string, unknown>;
  try {
    inputs = parseInputs(opts.input ?? []);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  try {
    const ctx = await runPipeline(pipeline, inputs);
    if (ctx.status === "failed") {
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}

/* ───── run list ──────────────────────────────────────────────────── */

export async function runListCommand(opts: { pipeline?: string }): Promise<void> {
  const runs = listRuns(opts.pipeline);
  if (runs.length === 0) {
    console.log("No runs yet. Trigger one with: autocode run <pipeline-name>");
    return;
  }

  const idWidth = 18;
  const pipelineWidth = 22;
  const statusWidth = 12;

  console.log(
    `${"ID".padEnd(idWidth)}${"PIPELINE".padEnd(pipelineWidth)}${"STATUS".padEnd(statusWidth)}STARTED`,
  );
  console.log("─".repeat(idWidth + pipelineWidth + statusWidth + 22));
  for (const r of runs) {
    console.log(
      `${r.run_id.padEnd(idWidth)}${r.pipeline_name.padEnd(pipelineWidth)}${r.status.padEnd(statusWidth)}${r.started_at}`,
    );
  }
}

/* ───── run show <id> ─────────────────────────────────────────────── */

export async function runShowCommand(id: string): Promise<void> {
  const ctx = getRun(id);
  if (!ctx) {
    console.error(`No run with id "${id}"`);
    process.exit(1);
  }

  console.log(`# Run ${ctx.run_id}`);
  console.log();
  console.log(`Pipeline:   ${ctx.pipeline_name}`);
  console.log(`Status:     ${ctx.status}`);
  console.log(`Started:    ${ctx.started_at}`);
  console.log(`Updated:    ${ctx.updated_at}`);
  if (ctx.finished_at) console.log(`Finished:   ${ctx.finished_at}`);
  if (ctx.current_step) console.log(`At step:    ${ctx.current_step}`);
  if (ctx.error) console.log(`Error:      ${ctx.error}`);
  console.log();

  console.log(`## Inputs`);
  for (const [k, v] of Object.entries(ctx.inputs)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }

  const stepIds = Object.keys(ctx.steps);
  if (stepIds.length === 0) {
    console.log();
    console.log(`## Steps`);
    console.log("  (no steps executed yet)");
    return;
  }

  console.log();
  console.log(`## Steps`);
  for (const step of Object.values(ctx.steps)) {
    const badge =
      step.status === "completed" ? "✓" : step.status === "paused" ? "⏸" : "✗";
    console.log();
    console.log(`### ${badge} [${step.step_id}] ${step.step_type}`);
    console.log(`  status: ${step.status}`);
    console.log(`  started: ${step.started_at}`);
    console.log(`  finished: ${step.finished_at}`);
    if (step.error) console.log(`  error: ${step.error}`);
    if (Object.keys(step.output).length > 0) {
      const out = JSON.stringify(step.output, null, 2);
      const truncated = out.length > 800 ? out.slice(0, 800) + "..." : out;
      console.log(`  output: ${truncated}`);
    }
  }
}

/* ───── run resume ────────────────────────────────────────────────── */

export async function runResumeCommand(
  id: string,
  opts: { content?: string },
): Promise<void> {
  try {
    const ctx = await resumeRun(id, { approvedContent: opts.content ?? "" });
    if (ctx.status === "failed") {
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}

/* ───── run cancel ────────────────────────────────────────────────── */

export async function runCancelCommand(id: string): Promise<void> {
  const run = getRun(id);
  if (!run) {
    console.error(`No run with id "${id}"`);
    process.exit(1);
  }
  if (run.status === "completed" || run.status === "failed") {
    console.log(`Run is already "${run.status}" — nothing to cancel.`);
    return;
  }
  deleteRun(id);
  console.log(`✓ Run ${id} cancelled and deleted.`);
}

/* ───── run pipelines ─────────────────────────────────────────────── */

export async function runPipelinesCommand(): Promise<void> {
  const pipelines = listPipelines();
  if (pipelines.length === 0) {
    console.log("No pipelines defined.");
    console.log(`Drop YAML files into ~/.autocode/pipelines/ to get started.`);
    return;
  }
  console.log(`${pipelines.length} pipeline(s) defined:\n`);
  for (const p of pipelines) {
    const steps = p.steps.length;
    console.log(`  ${p.name.padEnd(24)}${steps} step(s)    ${p.description ?? ""}`);
  }
}
