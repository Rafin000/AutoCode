/**
 * SQLite schema for auto-coder.
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
`;

export const SCHEMA_VERSION = 1;
