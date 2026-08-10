/**
 * Core types for the workflow engine.
 *
 * Everything in autocode that isn't a fixed capability is built
 * on these types. A pipeline is a YAML file describing a sequence of
 * steps. A skill is a YAML file describing a reusable LLM persona.
 * Runs are execution records persisted in SQLite.
 */

/* ───── YAML shapes (loaded from ~/.autocode/) ──────────────────── */

export interface InputSpec {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface StepDefinition {
  /** Unique within the pipeline — referenced by `steps.<id>.output` */
  id: string;
  /** Registered executor type, e.g. "retrieve_context" */
  type: string;
  /** Human-readable description (optional) */
  description?: string;
  /** Step-specific configuration. Template expressions resolved at runtime. */
  with?: Record<string, unknown>;
}

export interface PipelineDefinition {
  name: string;
  description?: string;
  inputs?: Record<string, InputSpec>;
  steps: StepDefinition[];
}

export interface SkillDefinition {
  name: string;
  description?: string;
  provider: "anthropic" | "openai";
  model: string;
  system_prompt: string;
  temperature?: number;
  max_tokens?: number;
}

/* ───── Runtime state ─────────────────────────────────────────────── */

export type RunStatus = "running" | "paused" | "completed" | "failed";

export type StepStatus = "completed" | "paused" | "failed";

export interface StepResult {
  step_id: string;
  step_type: string;
  status: StepStatus;
  output: Record<string, unknown>;
  started_at: string;
  finished_at: string;
  error?: string;
}

export interface RunContext {
  run_id: string;
  pipeline_name: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  /** Map of step id → result. Populated as steps execute. */
  steps: Record<string, StepResult>;
  /** Set when status is paused or failed — points at the problem step */
  current_step?: string;
  error?: string;
  started_at: string;
  updated_at: string;
  finished_at?: string;
}

/* ───── Executor contract ─────────────────────────────────────────── */

/**
 * Context passed to every step executor.
 *
 * `config` is already template-resolved — all {{ inputs.x }} and
 * {{ steps.y.output.z }} have been substituted with real values.
 */
export interface StepExecutionContext {
  run_id: string;
  step_id: string;
  step_type: string;
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  previous_steps: Record<string, StepResult>;
}

export interface StepExecutionResult {
  status: StepStatus;
  output: Record<string, unknown>;
  error?: string;
}

/**
 * A step executor is a function that takes a context and returns a result.
 * Executors register themselves into the global registry on import.
 */
export type StepExecutor = (
  ctx: StepExecutionContext,
) => Promise<StepExecutionResult>;
