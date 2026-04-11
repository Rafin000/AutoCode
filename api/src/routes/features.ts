import { Hono } from "hono";
import type { Env } from "../types.js";

export const featuresRoutes = new Hono<{ Bindings: Env }>();

// POST /api/features — create a new feature
featuresRoutes.post("/", async (c) => {
  const { title, description, repo } = await c.req.json();
  const id = `feat-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO features (id, repo, title, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, repo ?? "default", title, description, now, now)
    .run();

  const feature = await c.env.DB.prepare("SELECT * FROM features WHERE id = ?")
    .bind(id)
    .first();
  return c.json(feature);
});

// GET /api/features — list all features
featuresRoutes.get("/", async (c) => {
  const repo = c.req.query("repo");
  const result = repo
    ? await c.env.DB.prepare("SELECT * FROM features WHERE repo = ? ORDER BY created_at DESC")
        .bind(repo)
        .all()
    : await c.env.DB.prepare("SELECT * FROM features ORDER BY created_at DESC").all();
  return c.json({ features: result.results });
});

// GET /api/features/:id — get one feature
featuresRoutes.get("/:id", async (c) => {
  const feature = await c.env.DB.prepare("SELECT * FROM features WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!feature) return c.json({ error: "Not found" }, 404);
  return c.json(feature);
});

// PATCH /api/features/:id — partial update
featuresRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const existing = await c.env.DB.prepare("SELECT * FROM features WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const fields = Object.entries(body).filter(([k]) => k !== "id");
  if (fields.length === 0) return c.json(existing);

  const sets = fields.map(([k]) => `${k} = ?`).join(", ");
  const vals = fields.map(([, v]) => (typeof v === "object" ? JSON.stringify(v) : v));

  await c.env.DB.prepare(
    `UPDATE features SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(...vals, id)
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM features WHERE id = ?")
    .bind(id)
    .first();
  return c.json(updated);
});

// POST /api/features/:id/approve — approve a feature
featuresRoutes.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE features SET status = 'approved', updated_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run();
  return c.json({ approved: true });
});

// POST /api/features/:id/rework — submit rework instructions
featuresRoutes.post("/:id/rework", async (c) => {
  const id = c.req.param("id");
  const { instructions } = await c.req.json();

  const feature = await c.env.DB.prepare("SELECT * FROM features WHERE id = ?")
    .bind(id)
    .first();
  if (!feature) return c.json({ error: "Not found" }, 404);

  const history = JSON.parse((feature.rework_history as string) || "[]");
  history.push({ instructions, timestamp: new Date().toISOString() });

  await c.env.DB.prepare(
    "UPDATE features SET rework_history = ?, status = 'rework', updated_at = datetime('now') WHERE id = ?",
  )
    .bind(JSON.stringify(history), id)
    .run();

  return c.json({ reworked: true, history_length: history.length });
});
