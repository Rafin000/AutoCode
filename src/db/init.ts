import Database from "better-sqlite3";
import { getDb } from "./client.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/**
 * Run the schema. Idempotent — safe to call on every startup.
 *
 * Uses CREATE TABLE IF NOT EXISTS so repeated invocations don't
 * clobber existing data. Also runs one-shot ALTER TABLE migrations
 * for columns added after the initial table creation.
 */
export function initDb(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  runMigrations(db);

  // Stamp the schema version into sync_state so later migrations
  // can detect old versions.
  db.prepare(
    `INSERT INTO sync_state (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(String(SCHEMA_VERSION));
}

/**
 * One-shot column-level migrations for existing databases.
 *
 * `CREATE TABLE IF NOT EXISTS` only creates tables when they don't
 * already exist — it doesn't add columns to pre-existing tables.
 * So any column added after the initial table creation needs a
 * defensive ALTER TABLE here.
 */
function runMigrations(db: Database.Database): void {
  // v3 → v4: add `implementation_plan` to features
  addColumnIfMissing(db, "features", "implementation_plan", "TEXT");
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.length === 0) return; // table doesn't exist yet — SCHEMA_SQL handles it
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
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
