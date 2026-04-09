import { getDb } from "./client.js";

/* ───── repo_state ────────────────────────────────────────────────── */

export interface RepoStateRow {
  name: string;
  last_synced_commit: string | null;
  last_synced_at: string | null;
  document_count: number;
  created_at: string;
}

export function getRepoState(name: string): RepoStateRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM repo_state WHERE name = ?").get(name);
  return (row as RepoStateRow | undefined) ?? null;
}

export function upsertRepoState(
  name: string,
  commit: string,
  documentCount: number,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO repo_state (name, last_synced_commit, last_synced_at, document_count)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(name) DO UPDATE SET
       last_synced_commit = excluded.last_synced_commit,
       last_synced_at = excluded.last_synced_at,
       document_count = excluded.document_count`,
  ).run(name, commit, documentCount);
}

export function deleteRepoState(name: string): void {
  const db = getDb();
  db.prepare("DELETE FROM repo_state WHERE name = ?").run(name);
}

/* ───── documents ─────────────────────────────────────────────────── */

export interface DocumentRow {
  id: string;
  repo: string;
  file_path: string;
  doc_type: string;
  anchor: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
}

export interface DocumentInput {
  id: string;
  repo: string;
  file_path: string;
  doc_type: string;
  anchor?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Bulk upsert documents. Runs inside a transaction for speed.
 */
export function upsertDocuments(docs: DocumentInput[]): void {
  if (docs.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO documents (id, repo, file_path, doc_type, anchor, content, metadata, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       repo = excluded.repo,
       file_path = excluded.file_path,
       doc_type = excluded.doc_type,
       anchor = excluded.anchor,
       content = excluded.content,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
  );
  const tx = db.transaction((rows: DocumentInput[]) => {
    for (const d of rows) {
      stmt.run(
        d.id,
        d.repo,
        d.file_path,
        d.doc_type,
        d.anchor ?? null,
        d.content,
        d.metadata ? JSON.stringify(d.metadata) : null,
      );
    }
  });
  tx(docs);
}

export function deleteDocumentsByRepo(repo: string): number {
  const db = getDb();
  const res = db.prepare("DELETE FROM documents WHERE repo = ?").run(repo);
  return res.changes;
}

export function deleteDocumentsByIds(ids: string[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const res = db
    .prepare(`DELETE FROM documents WHERE id IN (${placeholders})`)
    .run(...ids);
  return res.changes;
}

/**
 * Find every document ID belonging to a specific file path in a repo.
 * Used by the sync processor to figure out which docs to delete when a
 * file is removed or fully re-extracted.
 */
export function getDocumentIdsByFile(repo: string, filePath: string): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM documents WHERE repo = ? AND file_path = ?")
    .all(repo, filePath) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function countDocumentsByRepo(repo: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as n FROM documents WHERE repo = ?")
    .get(repo) as { n: number };
  return row.n;
}
