import { Hono } from "hono";
import type { Env } from "../types.js";

export const rulesRoutes = new Hono<{ Bindings: Env }>();

// POST /api/rules — create
rulesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const id = `rule-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO rules (id, type, rule, scope, severity, confidence, source, source_detail, check_pattern, prevention, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.type,
      body.rule,
      body.scope,
      body.severity ?? null,
      body.confidence ?? null,
      body.source ?? "manual",
      body.source_detail ?? null,
      body.check_pattern ?? null,
      body.prevention ?? null,
      now,
      now,
    )
    .run();

  const rule = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
  return c.json(rule, 201);
});

// GET /api/rules — list with filters
rulesRoutes.get("/", async (c) => {
  const type = c.req.query("type");
  const scope = c.req.query("scope");
  const active = c.req.query("active");

  let sql = "SELECT * FROM rules WHERE 1=1";
  const params: unknown[] = [];

  if (type) { sql += " AND type = ?"; params.push(type); }
  if (scope) { sql += " AND (scope = 'all' OR scope = ?)"; params.push(scope); }
  if (active === "true") { sql += " AND active = 1"; }
  if (active === "false") { sql += " AND active = 0"; }

  sql += " ORDER BY created_at DESC";

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ rules: result.results });
});

// GET /api/rules/for-scope/:scope — rules matching a scope
rulesRoutes.get("/for-scope/:scope", async (c) => {
  const scope = c.req.param("scope");
  const result = await c.env.DB.prepare(
    "SELECT * FROM rules WHERE (scope = 'all' OR scope = ?) AND active = 1 ORDER BY type, created_at",
  )
    .bind(scope)
    .all();
  return c.json({ rules: result.results });
});

// GET /api/rules/:id
rulesRoutes.get("/:id", async (c) => {
  const rule = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!rule) return c.json({ error: "Not found" }, 404);
  return c.json(rule);
});

// PATCH /api/rules/:id
rulesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const fields = Object.entries(body).filter(([k]) => k !== "id");
  if (fields.length === 0) {
    const existing = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
    return c.json(existing);
  }

  const sets = fields.map(([k]) => `${k} = ?`).join(", ");
  const vals = fields.map(([, v]) => v);

  await c.env.DB.prepare(
    `UPDATE rules SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(...vals, id)
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
  return c.json(updated);
});

// DELETE /api/rules/:id
rulesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(id).run();
  return c.json({ deleted: true });
});
