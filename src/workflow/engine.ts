import {
  PipelineDefinition,
  RunContext,
  StepResult,
  StepExecutionContext,
} from "./types.js";
import { getStepExecutor, listStepTypes } from "./registry.js";
import { resolveTemplate } from "./templating.js";
import { createRun, persistRun, getRun } from "../db/runs.js";
import { loadPipeline } from "./loader.js";

/**
 * The workflow engine.
 *
 * Flow:
 *   1. Validate inputs against the pipeline's input spec
 *   2. Create a run row in SQLite (status: running)
 *   3. For each step in order:
 *      a. Template-resolve the step's `with` config
 *      b. Look up the executor in the registry
 *      c. Execute it with a fully-resolved context
 *      d. Record the result in the RunContext
 *      e. Persist to SQLite after every step (so crashes are recoverable)
 *      f. If the step failed → mark run failed, stop
 *      g. If the step paused → mark run paused, stop (caller can resume)
 *   4. If all steps completed → mark run completed
 */
export async function runPipeline(
  pipeline: PipelineDefinition,
  inputs: Record<string, unknown>,
  opts: { quiet?: boolean } = {},
): Promise<RunContext> {
  const log = opts.quiet ? () => {} : console.log;

  // Validate inputs up front
  validateInputs(pipeline, inputs);

  // Create the run in SQLite
  const ctx = createRun(pipeline.name, inputs);
  log(`• Pipeline: ${pipeline.name}`);
  log(`  Run ID: ${ctx.run_id}`);
  log(`  Steps: ${pipeline.steps.length}`);
  log();

  // Execute steps in order
  for (const stepDef of pipeline.steps) {
    ctx.current_step = stepDef.id;

    log(`→ [${stepDef.id}] ${stepDef.type}${stepDef.description ? ` — ${stepDef.description}` : ""}`);

    // Template-resolve the config using current run state
    const templateCtx = {
      inputs: ctx.inputs,
      steps: Object.fromEntries(
        Object.entries(ctx.steps).map(([k, v]) => [k, { output: v.output }]),
      ),
    };
    const resolvedConfig = resolveTemplate(stepDef.with ?? {}, templateCtx) as Record<string, unknown>;

    // Find the executor
    const executor = getStepExecutor(stepDef.type);
    if (!executor) {
      const startedAt = new Date().toISOString();
      ctx.steps[stepDef.id] = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: "failed",
        output: {},
        started_at: startedAt,
        finished_at: startedAt,
        error: `Unknown step type "${stepDef.type}". Registered types: ${listRegisteredHint()}`,
      };
      ctx.status = "failed";
      ctx.error = `Step "${stepDef.id}" uses unknown type "${stepDef.type}"`;
      persistRun(ctx);
      log(`  ✗ Unknown step type "${stepDef.type}"`);
      return ctx;
    }

    // Execute the step
    const startedAt = new Date().toISOString();
    let result: StepResult;
    try {
      const execCtx: StepExecutionContext = {
        run_id: ctx.run_id,
        step_id: stepDef.id,
        step_type: stepDef.type,
        config: resolvedConfig,
        inputs: ctx.inputs,
        previous_steps: ctx.steps,
      };
      const stepOut = await executor(execCtx);
      result = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: stepOut.status,
        output: stepOut.output,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: stepOut.error,
      };
    } catch (err) {
      result = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: "failed",
        output: {},
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: (err as Error).message,
      };
    }

    ctx.steps[stepDef.id] = result;

    if (result.status === "failed") {
      ctx.status = "failed";
      ctx.error = result.error ?? `Step "${stepDef.id}" failed`;
      persistRun(ctx);
      log(`  ✗ Failed: ${result.error}`);
      return ctx;
    }

    if (result.status === "paused") {
      ctx.status = "paused";
      persistRun(ctx);
      log(`  ⏸  Paused (resume with: auto-coder run resume ${ctx.run_id})`);
      return ctx;
    }

    log(`  ✓ Completed`);
    persistRun(ctx);
  }

  // All steps done
  ctx.status = "completed";
  ctx.current_step = undefined;
  persistRun(ctx);
  log();
  log(`✓ Pipeline "${pipeline.name}" completed (${ctx.run_id})`);
  return ctx;
}

/* ───── Helpers ───────────────────────────────────────────────────── */

function validateInputs(
  pipeline: PipelineDefinition,
  inputs: Record<string, unknown>,
): void {
  const spec = pipeline.inputs ?? {};
  for (const [name, info] of Object.entries(spec)) {
    if (info.required && (inputs[name] === undefined || inputs[name] === null)) {
      if (info.default === undefined) {
        throw new Error(
          `Pipeline "${pipeline.name}" requires input "${name}" (${info.type})`,
        );
      }
      inputs[name] = info.default;
    }
  }
}

/**
 * Resume a paused run from where it left off.
 *
 * Loads the pipeline definition, finds the paused step, re-enters it
 * with __resumed=true so the step executor knows it's a resumption,
 * then continues with remaining steps.
 */
export async function resumeRun(
  runId: string,
  opts: { quiet?: boolean; approvedContent?: string } = {},
): Promise<RunContext> {
  const log = opts.quiet ? () => {} : console.log;
  const ctx = getRun(runId);
  if (!ctx) throw new Error(`No run with id "${runId}"`);
  if (ctx.status !== "paused") {
    throw new Error(`Run is "${ctx.status}", not "paused" — cannot resume`);
  }
  if (!ctx.current_step) {
    throw new Error("Run is paused but has no current_step — inconsistent state");
  }

  const pipeline = loadPipeline(ctx.pipeline_name);
  const pausedStepIdx = pipeline.steps.findIndex((s) => s.id === ctx.current_step);
  if (pausedStepIdx < 0) {
    throw new Error(`Paused step "${ctx.current_step}" not found in pipeline "${ctx.pipeline_name}"`);
  }

  ctx.status = "running";
  persistRun(ctx);
  log(`• Resuming pipeline "${ctx.pipeline_name}" from step [${ctx.current_step}]`);
  log();

  // Re-enter the paused step with __resumed flag, then continue with the rest
  const stepsToRun = pipeline.steps.slice(pausedStepIdx);
  for (let i = 0; i < stepsToRun.length; i++) {
    const stepDef = stepsToRun[i]!;
    ctx.current_step = stepDef.id;

    log(`→ [${stepDef.id}] ${stepDef.type}${stepDef.description ? ` — ${stepDef.description}` : ""}`);

    const templateCtx = {
      inputs: ctx.inputs,
      steps: Object.fromEntries(
        Object.entries(ctx.steps).map(([k, v]) => [k, { output: v.output }]),
      ),
    };

    let resolvedConfig = resolveTemplate(stepDef.with ?? {}, templateCtx) as Record<string, unknown>;

    // First step in the resume = the paused step — add resume flag
    if (i === 0) {
      resolvedConfig = {
        ...resolvedConfig,
        __resumed: true,
        __approved_content: opts.approvedContent ?? "",
      };
    }

    const executor = getStepExecutor(stepDef.type);
    if (!executor) {
      ctx.steps[stepDef.id] = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: "failed",
        output: {},
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: `Unknown step type "${stepDef.type}"`,
      };
      ctx.status = "failed";
      ctx.error = `Step "${stepDef.id}" uses unknown type "${stepDef.type}"`;
      persistRun(ctx);
      log(`  ✗ Unknown step type "${stepDef.type}"`);
      return ctx;
    }

    const startedAt = new Date().toISOString();
    let result: StepResult;
    try {
      const execCtx: StepExecutionContext = {
        run_id: ctx.run_id,
        step_id: stepDef.id,
        step_type: stepDef.type,
        config: resolvedConfig,
        inputs: ctx.inputs,
        previous_steps: ctx.steps,
      };
      const stepOut = await executor(execCtx);
      result = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: stepOut.status,
        output: stepOut.output,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: stepOut.error,
      };
    } catch (err) {
      result = {
        step_id: stepDef.id,
        step_type: stepDef.type,
        status: "failed",
        output: {},
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: (err as Error).message,
      };
    }

    ctx.steps[stepDef.id] = result;

    if (result.status === "failed") {
      ctx.status = "failed";
      ctx.error = result.error ?? `Step "${stepDef.id}" failed`;
      persistRun(ctx);
      log(`  ✗ Failed: ${result.error}`);
      return ctx;
    }

    if (result.status === "paused") {
      ctx.status = "paused";
      persistRun(ctx);
      log(`  ⏸  Paused (resume with: auto-coder run resume ${ctx.run_id})`);
      return ctx;
    }

    log(`  ✓ Completed`);
    persistRun(ctx);
  }

  ctx.status = "completed";
  ctx.current_step = undefined;
  persistRun(ctx);
  log();
  log(`✓ Pipeline "${ctx.pipeline_name}" completed (${ctx.run_id})`);
  return ctx;
}

function listRegisteredHint(): string {
  const types = listStepTypes();
  return types.length > 0 ? types.join(", ") : "(none registered yet)";
}
