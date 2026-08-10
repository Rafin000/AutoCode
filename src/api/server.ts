import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { featuresRoutes } from "./routes/features.js";
import { rulesRoutes } from "./routes/rules.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { webhooksRoutes } from "./routes/webhooks.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/", (c) =>
    c.json({
      name: "autocode",
      version: "0.1.0",
      endpoints: [
        "/api/features",
        "/api/rules",
        "/api/knowledge/stats",
        "/api/webhooks/github",
      ],
    }),
  );

  app.route("/api/features", featuresRoutes);
  app.route("/api/rules", rulesRoutes);
  app.route("/api/knowledge", knowledgeRoutes);
  app.route("/api/webhooks", webhooksRoutes);

  return app;
}

export function startServer(port: number): void {
  const app = createApp();

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`autocode API running on http://localhost:${info.port}`);
    console.log();
    console.log("Endpoints:");
    console.log("  GET    /");
    console.log("  GET    /api/features");
    console.log("  GET    /api/features/:id");
    console.log("  GET    /api/rules");
    console.log("  GET    /api/rules/for-scope/:scope");
    console.log("  POST   /api/rules");
    console.log("  GET    /api/knowledge/stats");
    console.log("  POST   /api/webhooks/github");
    console.log();
    console.log("Press Ctrl+C to stop.");
  });
}
