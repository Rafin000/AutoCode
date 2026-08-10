/**
 * SQLite schema for autocode.
 *
 * Three tables:
 *
 * - repo_state: per-repo sync checkpoints. Keyed by `name` (matches
 *   config.yaml). Stores the last synced commit hash so M6's sync
 *   processor can do diff-based updates.
 *
 * - documents: raw text snippets indexed from repos. This is the
 *   "source of truth" for grounding LLM answers — the vector DB only
 *   stores embeddings, but we keep the actual text here so we can
 *   cite sources in answers.
 *
 * - sync_state: general-purpose key/value bag for anything else that
 *   needs persistence (schema versions, feature flags, etc).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repo_state (
  name                TEXT PRIMARY KEY,
  last_synced_commit  TEXT,
  last_synced_at      TEXT,
  document_count      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  repo        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  anchor      TEXT,
  content     TEXT NOT NULL,
  metadata    TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_repo      ON documents(repo);
CREATE INDEX IF NOT EXISTS idx_documents_repo_file ON documents(repo, file_path);
CREATE INDEX IF NOT EXISTS idx_documents_type      ON documents(doc_type);

CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feature lifecycle table (added in schema v2, extended in v4).
-- States: pending → planning → plan_ready → implementing → ready_for_review → approved | failed
-- The plan phase (v4) is optional: "feature create --no-plan" skips it.
CREATE TABLE IF NOT EXISTS features (
  id                    TEXT PRIMARY KEY,
  repo                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  implementation_plan   TEXT,            -- markdown Claude wrote during the plan phase
  branch_name           TEXT,
  files_modified        TEXT,           -- JSON array of relative paths
  files_created         TEXT,           -- JSON array of relative paths
  pr_url                TEXT,
  pr_number             INTEGER,
  impact_report         TEXT,
  test_results          TEXT,
  error_message         TEXT,
  tokens_used           TEXT,           -- JSON: { input, output }
  rework_history        TEXT DEFAULT '[]',  -- JSON array of { instructions, timestamp }
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_features_repo   ON features(repo);
CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);

-- Workflow runs — one row per execution of a pipeline (added in schema v3).
-- States: running → (completed | paused | failed)
-- Paused runs can be resumed via "run resume <id>".
CREATE TABLE IF NOT EXISTS workflow_runs (
  id              TEXT PRIMARY KEY,
  pipeline_name   TEXT NOT NULL,
  status          TEXT NOT NULL,
  inputs          TEXT NOT NULL,   -- JSON
  steps           TEXT NOT NULL,   -- JSON map of stepId → StepResult
  current_step    TEXT,             -- id of the step we stopped at (paused or failed)
  error           TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON workflow_runs(pipeline_name);
CREATE INDEX IF NOT EXISTS idx_runs_status   ON workflow_runs(status);

-- Rules engine (added in schema v5).
-- Types: hard_rule (must follow), soft_rule (pattern with confidence), anti_pattern (what NOT to do)
CREATE TABLE IF NOT EXISTS rules (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,        -- hard_rule | soft_rule | anti_pattern
  rule            TEXT NOT NULL,        -- the rule text
  scope           TEXT NOT NULL,        -- "all" or a specific repo name
  severity        TEXT,                 -- critical | high | medium | low
  confidence      REAL,                 -- 0.0-1.0 (soft_rule only)
  source          TEXT,                 -- "manual" | "bootstrap" | feature_id
  source_detail   TEXT,
  times_applied   INTEGER DEFAULT 0,
  times_violated  INTEGER DEFAULT 0,
  check_pattern   TEXT,                 -- regex or keyword to check for violations
  prevention      TEXT,                 -- how to avoid violating (anti_pattern)
  active          INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_type   ON rules(type);
CREATE INDEX IF NOT EXISTS idx_rules_scope  ON rules(scope);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(active);
`;

export const SCHEMA_VERSION = 5;
