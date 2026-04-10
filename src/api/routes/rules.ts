import { Hono } from "hono";
import { listRules, getRule, createRule, updateRule, deleteRule, getRulesForScope, RuleType } from "../../db/rules.js";

export const rulesRoutes = new Hono();

rulesRoutes.get("/", (c) => {
  const type = c.req.query("type") as RuleType | undefined;
  const scope = c.req.query("scope");
  const active = c.req.query("active");
  const rules = listRules({
    type,
    scope,
    active: active === "true" ? true : active === "false" ? false : undefined,
  });
  return c.json({ rules });
});

rulesRoutes.get("/for-scope/:scope", (c) => {
  const rules = getRulesForScope(c.req.param("scope"));
  return c.json({ rules });
});

rulesRoutes.get("/:id", (c) => {
  const rule = getRule(c.req.param("id"));
  if (!rule) return c.json({ error: "Not found" }, 404);
  return c.json(rule);
});

rulesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const rule = createRule(body);
  return c.json(rule, 201);
});

rulesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const rule = getRule(id);
  if (!rule) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json();
  updateRule(id, body);
  return c.json(getRule(id));
});

rulesRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const rule = getRule(id);
  if (!rule) return c.json({ error: "Not found" }, 404);
  deleteRule(id);
  return c.json({ deleted: true });
});
