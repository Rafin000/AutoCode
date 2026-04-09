import { getDb } from "./client.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/**
 * Run the schema. Idempotent — safe to call on every startup.
 *
 * Uses CREATE TABLE IF NOT EXISTS so repeated invocations don't
 * clobber existing data.
 */
export function initDb(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);

  // Stamp the schema version into sync_state so later migrations
  // can detect old versions.
  db.prepare(
    `INSERT INTO sync_state (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(String(SCHEMA_VERSION));
}

export interface DbStats {
  repo_count: number;
  document_count: number;
  schema_version: number;
}

export function getDbStats(): DbStats {
  const db = getDb();
  const repos = db.prepare("SELECT COUNT(*) as n FROM repo_state").get() as { n: number };
  const docs = db.prepare("SELECT COUNT(*) as n FROM documents").get() as { n: number };
  const version = db
    .prepare("SELECT value FROM sync_state WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;

  return {
    repo_count: repos.n,
    document_count: docs.n,
    schema_version: version ? parseInt(version.value, 10) : 0,
  };
}
