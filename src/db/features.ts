import { randomUUID } from "node:crypto";
import { getDb } from "./client.js";

export type FeatureStatus =
  | "pending"
  | "planning"
  | "plan_ready"
  | "implementing"
  | "ready_for_review"
  | "approved"
  | "failed";

export interface FeatureRow {
  id: string;
  repo: string;
  title: string;
  description: string;
  status: FeatureStatus;
  implementation_plan: string | null;
  branch_name: string | null;
  files_modified: string[] | null;
  files_created: string[] | null;
  pr_url: string | null;
  pr_number: number | null;
  impact_report: string | null;
  test_results: string | null;
  error_message: string | null;
  tokens_used: { input?: number; output?: number } | null;
  created_at: string;
  updated_at: string;
}

interface RawFeatureRow {
  id: string;
  repo: string;
  title: string;
  description: string;
  status: FeatureStatus;
  implementation_plan: string | null;
  branch_name: string | null;
  files_modified: string | null;
  files_created: string | null;
  pr_url: string | null;
  pr_number: number | null;
  impact_report: string | null;
  test_results: string | null;
  error_message: string | null;
  tokens_used: string | null;
  created_at: string;
  updated_at: string;
}

function parseRow(raw: RawFeatureRow | undefined): FeatureRow | null {
  if (!raw) return null;
  return {
    ...raw,
    files_modified: raw.files_modified ? (JSON.parse(raw.files_modified) as string[]) : null,
    files_created: raw.files_created ? (JSON.parse(raw.files_created) as string[]) : null,
    tokens_used: raw.tokens_used
      ? (JSON.parse(raw.tokens_used) as { input?: number; output?: number })
      : null,
  };
}

/**
 * Create a new feature row in "pending" state and return its generated ID.
 */
export function createFeature(
  repo: string,
  title: string,
  description: string,
): FeatureRow {
  const db = getDb();
  const id = `feat-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO features (id, repo, title, description, status)
     VALUES (?, ?, ?, ?, 'pending')`,
  ).run(id, repo, title, description);
  return getFeature(id)!;
}

export function getFeature(id: string): FeatureRow | null {
  const db = getDb();
  const raw = db.prepare("SELECT * FROM features WHERE id = ?").get(id) as
    | RawFeatureRow
    | undefined;
  return parseRow(raw);
}

export function listFeatures(repo?: string): FeatureRow[] {
  const db = getDb();
  const rows = (repo
    ? db
        .prepare("SELECT * FROM features WHERE repo = ? ORDER BY created_at DESC")
        .all(repo)
    : db
        .prepare("SELECT * FROM features ORDER BY created_at DESC")
        .all()) as RawFeatureRow[];
  return rows.map(parseRow).filter((r): r is FeatureRow => r !== null);
}

export interface FeatureUpdate {
  status?: FeatureStatus;
  implementation_plan?: string | null;
  branch_name?: string | null;
  files_modified?: string[] | null;
  files_created?: string[] | null;
  pr_url?: string | null;
  pr_number?: number | null;
  impact_report?: string | null;
  test_results?: string | null;
  error_message?: string | null;
  tokens_used?: { input?: number; output?: number } | null;
}

/**
 * Partial update — only fields present in `fields` are updated.
 * Also bumps `updated_at`.
 */
export function updateFeature(id: string, fields: FeatureUpdate): void {
  const db = getDb();
  const columns: string[] = [];
  const values: unknown[] = [];

  const set = (col: string, val: unknown): void => {
    columns.push(`${col} = ?`);
    values.push(val);
  };

  if (fields.status !== undefined) set("status", fields.status);
  if (fields.implementation_plan !== undefined) set("implementation_plan", fields.implementation_plan);
  if (fields.branch_name !== undefined) set("branch_name", fields.branch_name);
  if (fields.files_modified !== undefined)
    set("files_modified", fields.files_modified ? JSON.stringify(fields.files_modified) : null);
  if (fields.files_created !== undefined)
    set("files_created", fields.files_created ? JSON.stringify(fields.files_created) : null);
  if (fields.pr_url !== undefined) set("pr_url", fields.pr_url);
  if (fields.pr_number !== undefined) set("pr_number", fields.pr_number);
  if (fields.impact_report !== undefined) set("impact_report", fields.impact_report);
  if (fields.test_results !== undefined) set("test_results", fields.test_results);
  if (fields.error_message !== undefined) set("error_message", fields.error_message);
  if (fields.tokens_used !== undefined)
    set("tokens_used", fields.tokens_used ? JSON.stringify(fields.tokens_used) : null);

  if (columns.length === 0) return;

  columns.push("updated_at = datetime('now')");
  const sql = `UPDATE features SET ${columns.join(", ")} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(...values);
}

export function deleteFeature(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM features WHERE id = ?").run(id);
}
