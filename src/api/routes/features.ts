import { Hono } from "hono";
import { getFeature, listFeatures } from "../../db/features.js";

export const featuresRoutes = new Hono();

featuresRoutes.get("/", (c) => {
  const repo = c.req.query("repo");
  const features = listFeatures(repo);
  return c.json({ features });
});

featuresRoutes.get("/:id", (c) => {
  const feature = getFeature(c.req.param("id"));
  if (!feature) return c.json({ error: "Not found" }, 404);
  return c.json(feature);
});
