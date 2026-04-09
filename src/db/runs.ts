import { randomUUID } from "node:crypto";
import { getDb } from "./client.js";
import { RunContext, RunStatus, StepResult } from "../workflow/types.js";

interface RawRunRow {
  id: string;
  pipeline_name: string;
  status: RunStatus;
  inputs: string;
  steps: string;
  current_step: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

function rowToContext(row: RawRunRow | undefined): RunContext | null {
  if (!row) return null;
  return {
    run_id: row.id,
    pipeline_name: row.pipeline_name,
    status: row.status,
    inputs: JSON.parse(row.inputs) as Record<string, unknown>,
    steps: JSON.parse(row.steps) as Record<string, StepResult>,
    current_step: row.current_step ?? undefined,
    error: row.error ?? undefined,
    started_at: row.started_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at ?? undefined,
  };
}

export function createRun(
  pipelineName: string,
  inputs: Record<string, unknown>,
): RunContext {
  const db = getDb();
  const id = `run-${randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO workflow_runs (id, pipeline_name, status, inputs, steps)
     VALUES (?, ?, 'running', ?, '{}')`,
  ).run(id, pipelineName, JSON.stringify(inputs));
  return getRun(id)!;
}

export function getRun(id: string): RunContext | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
    | RawRunRow
    | undefined;
  return rowToContext(row);
}

export function listRuns(pipelineName?: string): RunContext[] {
  const db = getDb();
  const rows = (pipelineName
    ? db
        .prepare("SELECT * FROM workflow_runs WHERE pipeline_name = ? ORDER BY started_at DESC")
        .all(pipelineName)
    : db
        .prepare("SELECT * FROM workflow_runs ORDER BY started_at DESC")
        .all()) as RawRunRow[];
  return rows.map(rowToContext).filter((r): r is RunContext => r !== null);
}

/**
 * Persist the current state of a run. Called after every step executes
 * so crashes leave a recoverable state in the DB.
 */
export function persistRun(ctx: RunContext): void {
  const db = getDb();
  const finishedAt =
    ctx.status === "completed" || ctx.status === "failed"
      ? new Date().toISOString()
      : null;

  db.prepare(
    `UPDATE workflow_runs SET
       status       = ?,
       steps        = ?,
       current_step = ?,
       error        = ?,
       updated_at   = datetime('now'),
       finished_at  = ?
     WHERE id = ?`,
  ).run(
    ctx.status,
    JSON.stringify(ctx.steps),
    ctx.current_step ?? null,
    ctx.error ?? null,
    finishedAt,
    ctx.run_id,
  );
}

export function deleteRun(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM workflow_runs WHERE id = ?").run(id);
}
