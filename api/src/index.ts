import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import { featuresRoutes } from "./routes/features.js";
import { rulesRoutes } from "./routes/rules.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { webhooksRoutes } from "./routes/webhooks.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "autocode-api",
    version: "0.1.0",
    runtime: "cloudflare-workers",
    endpoints: [
      "/api/features",
      "/api/rules",
      "/api/knowledge/vectors",
      "/api/webhooks/github",
    ],
  }),
);

app.route("/api/features", featuresRoutes);
app.route("/api/rules", rulesRoutes);
app.route("/api/knowledge", knowledgeRoutes);
app.route("/api/webhooks", webhooksRoutes);

export default app;
