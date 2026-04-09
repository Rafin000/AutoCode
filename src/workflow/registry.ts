import { StepExecutor } from "./types.js";

/**
 * Global registry of step executors.
 *
 * Executor modules (e.g. `steps/retrieve_context.ts`) import this
 * and call `registerStep(type, fn)` at module load time. The engine
 * looks up executors here when running a pipeline.
 *
 * Keeping this as a module-level Map means adding a new step type is
 * just: create a new file under `steps/`, import it once from
 * `register-all-steps.ts` or similar, and the engine picks it up.
 */

const executors = new Map<string, StepExecutor>();

export function registerStep(type: string, executor: StepExecutor): void {
  if (executors.has(type)) {
    throw new Error(`Step type "${type}" is already registered`);
  }
  executors.set(type, executor);
}

export function getStepExecutor(type: string): StepExecutor | undefined {
  return executors.get(type);
}

export function listStepTypes(): string[] {
  return Array.from(executors.keys()).sort();
}

/** Test helper — wipes the registry so tests can start fresh. */
export function _clearRegistry(): void {
  executors.clear();
}
