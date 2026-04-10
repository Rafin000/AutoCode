import { randomUUID } from "node:crypto";
import { registerStep } from "../registry.js";
import { StepExecutionContext, StepExecutionResult } from "../types.js";
import { getDb } from "../../db/client.js";

/**
 * Step: save_draft
 *
 * Persists generated content to a `drafts` table in SQLite so it
 * can be reviewed, approved, or published later. Used by marketing
 * and content pipelines as the bridge between generation and
 * publishing.
 *
 * Config:
 *   content:  string  — the text to save (required, usually from llm_generate)
 *   kind:     string  — category label (e.g. "bluesky_post", "linkedin_post")
 *   topic:    string  — what the draft is about (optional, for listing)
 *   metadata: object  — arbitrary JSON stored alongside (optional)
 */
registerStep("save_draft", async (ctx: StepExecutionContext): Promise<StepExecutionResult> => {
  const content = ctx.config.content as string | undefined;
  if (!content) {
    return { status: "failed", output: {}, error: "save_draft requires 'content' in config" };
  }

  const kind = (ctx.config.kind as string) ?? "draft";
  const topic = (ctx.config.topic as string) ?? "";
  const metadata = ctx.config.metadata as Record<string, unknown> | undefined;

  const db = getDb();

  // Ensure drafts table exists (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id         TEXT PRIMARY KEY,
      run_id     TEXT,
      kind       TEXT NOT NULL,
      topic      TEXT,
      content    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'draft',
      metadata   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const draftId = `draft-${randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO drafts (id, run_id, kind, topic, content, status, metadata)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
  ).run(
    draftId,
    ctx.run_id,
    kind,
    topic,
    content,
    metadata ? JSON.stringify(metadata) : null,
  );

  return {
    status: "completed",
    output: {
      draft_id: draftId,
      kind,
      topic,
      content_length: content.length,
    },
  };
});
