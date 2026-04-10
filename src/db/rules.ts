import { randomUUID } from "node:crypto";
import { getDb } from "./client.js";

export type RuleType = "hard_rule" | "soft_rule" | "anti_pattern";

export interface RuleRow {
  id: string;
  type: RuleType;
  rule: string;
  scope: string;
  severity: string | null;
  confidence: number | null;
  source: string | null;
  source_detail: string | null;
  times_applied: number;
  times_violated: number;
  check_pattern: string | null;
  prevention: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface RawRuleRow {
  id: string;
  type: RuleType;
  rule: string;
  scope: string;
  severity: string | null;
  confidence: number | null;
  source: string | null;
  source_detail: string | null;
  times_applied: number;
  times_violated: number;
  check_pattern: string | null;
  prevention: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseRow(raw: RawRuleRow | undefined): RuleRow | null {
  if (!raw) return null;
  return { ...raw, active: raw.active === 1 };
}

export interface CreateRuleInput {
  type: RuleType;
  rule: string;
  scope: string;
  severity?: string;
  confidence?: number;
  source?: string;
  source_detail?: string;
  check_pattern?: string;
  prevention?: string;
}

export function createRule(input: CreateRuleInput): RuleRow {
  const db = getDb();
  const id = `rule-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO rules (id, type, rule, scope, severity, confidence, source, source_detail, check_pattern, prevention)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.rule,
    input.scope,
    input.severity ?? null,
    input.confidence ?? null,
    input.source ?? "manual",
    input.source_detail ?? null,
    input.check_pattern ?? null,
    input.prevention ?? null,
  );
  return getRule(id)!;
}

export function getRule(id: string): RuleRow | null {
  const db = getDb();
  return parseRow(db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as RawRuleRow | undefined);
}

export function listRules(opts?: {
  type?: RuleType;
  scope?: string;
  active?: boolean;
}): RuleRow[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts?.type) { clauses.push("type = ?"); params.push(opts.type); }
  if (opts?.scope) { clauses.push("(scope = 'all' OR scope = ?)"); params.push(opts.scope); }
  if (opts?.active !== undefined) { clauses.push("active = ?"); params.push(opts.active ? 1 : 0); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM rules ${where} ORDER BY created_at DESC`).all(...params) as RawRuleRow[];
  return rows.map(parseRow).filter((r): r is RuleRow => r !== null);
}

export function getRulesForScope(scope: string): RuleRow[] {
  return listRules({ scope, active: true });
}

export function updateRule(id: string, fields: Partial<CreateRuleInput> & { active?: boolean }): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, val: unknown) => { sets.push(`${col} = ?`); vals.push(val); };

  if (fields.type !== undefined) set("type", fields.type);
  if (fields.rule !== undefined) set("rule", fields.rule);
  if (fields.scope !== undefined) set("scope", fields.scope);
  if (fields.severity !== undefined) set("severity", fields.severity);
  if (fields.confidence !== undefined) set("confidence", fields.confidence);
  if (fields.check_pattern !== undefined) set("check_pattern", fields.check_pattern);
  if (fields.prevention !== undefined) set("prevention", fields.prevention);
  if (fields.active !== undefined) set("active", fields.active ? 1 : 0);

  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function reinforceRule(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE rules SET
       confidence = MIN(1.0, COALESCE(confidence, 0.5) + 0.02),
       times_applied = times_applied + 1,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(id);
}

export function deleteRule(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
}
