import { Hono } from "hono";
import type { Env } from "../types.js";

export const knowledgeRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/knowledge/vectors/upsert
 *
 * Accepts vectors + content from the CLI's sync pipeline.
 * Embeds content via Workers AI, upserts to Vectorize, stores
 * raw content in D1's vector_content table.
 */
knowledgeRoutes.post("/vectors/upsert", async (c) => {
  const { vectors, contents } = await c.req.json() as {
    vectors: Array<{
      id: string;
      content: string;
      content_type: string;
      service: string;
      file_path?: string;
      identifier?: string;
    }>;
    contents?: Array<{
      vector_id: string;
      content: string;
      content_type: string;
      service: string;
      file_path?: string;
      identifier?: string;
    }>;
  };

  if (!vectors || vectors.length === 0) {
    return c.json({ error: "No vectors provided" }, 400);
  }

  // Embed all texts via Workers AI
  const texts = vectors.map((v) => v.content);
  const embedResult = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: texts,
  });
  const embeddings = embedResult.data as number[][];

  // Upsert to Vectorize
  const vectorizeEntries = vectors.map((v, i) => ({
    id: v.id,
    values: embeddings[i]!,
    metadata: {
      service: v.service,
      content_type: v.content_type,
      file_path: v.file_path ?? "",
      identifier: v.identifier ?? "",
    },
  }));
  await c.env.VECTORIZE.upsert(vectorizeEntries);

  // Store raw content in D1
  const contentRows = contents ?? vectors;
  for (const row of contentRows) {
    await c.env.DB.prepare(
      `INSERT INTO vector_content (vector_id, content, content_type, service, file_path, identifier, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(vector_id) DO UPDATE SET
         content = excluded.content,
         content_type = excluded.content_type,
         service = excluded.service,
         file_path = excluded.file_path,
         identifier = excluded.identifier,
         updated_at = datetime('now')`,
    )
      .bind(
        row.vector_id ?? row.id,
        row.content,
        row.content_type,
        row.service,
        row.file_path ?? null,
        row.identifier ?? null,
      )
      .run();
  }

  return c.json({ upserted: vectors.length });
});

/**
 * POST /api/knowledge/vectors/query
 *
 * Embeds a query string via Workers AI, searches Vectorize, and
 * returns results enriched with raw content from D1.
 */
knowledgeRoutes.post("/vectors/query", async (c) => {
  const { text, top_k, filter } = await c.req.json() as {
    text: string;
    top_k?: number;
    filter?: { service?: string };
  };

  if (!text) return c.json({ error: "No text provided" }, 400);

  // Embed the query
  const embedResult = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });
  const queryVector = (embedResult.data as number[][])[0]!;

  // Search Vectorize
  const vectorFilter = filter?.service
    ? { service: filter.service }
    : undefined;

  const matches = await c.env.VECTORIZE.query(queryVector, {
    topK: top_k ?? 5,
    filter: vectorFilter,
    returnMetadata: "all",
  });

  // Enrich with raw content from D1
  const results = [];
  for (const match of matches.matches) {
    const content = await c.env.DB.prepare(
      "SELECT * FROM vector_content WHERE vector_id = ?",
    )
      .bind(match.id)
      .first();

    results.push({
      id: match.id,
      score: match.score,
      metadata: match.metadata,
      content: content?.content ?? null,
      content_type: content?.content_type ?? null,
      service: content?.service ?? null,
      file_path: content?.file_path ?? null,
      identifier: content?.identifier ?? null,
    });
  }

  return c.json(results);
});

/**
 * POST /api/knowledge/vectors/delete
 *
 * Deletes vectors by ID from both Vectorize and D1.
 */
knowledgeRoutes.post("/vectors/delete", async (c) => {
  const { ids } = await c.req.json() as { ids: string[] };

  if (!ids || ids.length === 0) {
    return c.json({ error: "No ids provided" }, 400);
  }

  await c.env.VECTORIZE.deleteByIds(ids);

  for (const id of ids) {
    await c.env.DB.prepare("DELETE FROM vector_content WHERE vector_id = ?")
      .bind(id)
      .run();
  }

  return c.json({ deleted: ids.length });
});
