import { Hono } from "hono";
import { getDbStats } from "../../db/init.js";

export const knowledgeRoutes = new Hono();

knowledgeRoutes.get("/stats", (c) => {
  const stats = getDbStats();
  return c.json(stats);
});
