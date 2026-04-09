import { QdrantClient } from "@qdrant/js-client-rest";
import { createHash } from "node:crypto";
import { VectorConfig, EmbedderConfig } from "../config/types.js";
import { embedText } from "./embedder.js";

export interface VectorPoint {
  /** Stable string identifier — `{repo}:{file_path}:{anchor}` */
  id: string;
  /** Raw text that will be embedded */
  content: string;
  /** Arbitrary metadata stored alongside the vector */
  payload: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Qdrant requires point IDs to be unsigned integers or UUIDs. We want
 * stable string IDs like `repo:path:anchor`, so we hash them into
 * deterministic UUIDs. The original string ID is kept in the payload
 * so we can round-trip it.
 */
function stringToUuid(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Wrapper around Qdrant that handles embedding, upserting, and
 * repo-scoped cleanup.
 *
 * Every point stored carries a `repo` field in its payload so we can
 * filter searches and cascade deletes when a repo is removed.
 */
export class VectorClient {
  private client: QdrantClient;
  private collection: string;
  private dims: number;
  private modelName: string;

  constructor(vectorCfg: VectorConfig, embedderCfg: EmbedderConfig) {
    this.client = new QdrantClient({ url: vectorCfg.url });
    this.collection = vectorCfg.collection;
    this.dims = embedderCfg.dimensions;
    this.modelName = embedderCfg.model;
  }

  async verifyConnectivity(): Promise<void> {
    await this.client.getCollections();
  }

  async ensureCollection(): Promise<void> {
    const { collections } = await this.client.getCollections();
    const exists = collections.some((c) => c.name === this.collection);
    if (exists) return;

    await this.client.createCollection(this.collection, {
      vectors: { size: this.dims, distance: "Cosine" },
    });
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.ensureCollection();

    const qdrantPoints = [];
    for (const p of points) {
      const vector = await embedText(p.content, this.modelName);
      qdrantPoints.push({
        id: stringToUuid(p.id),
        vector,
        payload: {
          ...p.payload,
          original_id: p.id,
          content: p.content,
        },
      });
    }

    await this.client.upsert(this.collection, { points: qdrantPoints });
  }

  async search(
    query: string,
    topK: number = 5,
    filterRepo?: string,
  ): Promise<SearchResult[]> {
    await this.ensureCollection();
    const vector = await embedText(query, this.modelName);

    const filter = filterRepo
      ? { must: [{ key: "repo", match: { value: filterRepo } }] }
      : undefined;

    const result = await this.client.search(this.collection, {
      vector,
      limit: topK,
      with_payload: true,
      filter,
    });

    return result.map((hit) => ({
      id: String(hit.payload?.original_id ?? hit.id),
      score: hit.score,
      payload: (hit.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async deleteByRepo(repoName: string): Promise<void> {
    try {
      await this.client.delete(this.collection, {
        filter: {
          must: [{ key: "repo", match: { value: repoName } }],
        },
      });
    } catch (err) {
      // Collection may not exist yet — that's fine for cleanup
      const msg = String(err);
      if (!msg.includes("not found") && !msg.includes("404")) throw err;
    }
  }

  async count(): Promise<number> {
    try {
      const info = await this.client.count(this.collection, { exact: true });
      return info.count;
    } catch {
      return 0;
    }
  }
}
