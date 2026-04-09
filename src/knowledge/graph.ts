import neo4j, { Driver, Session } from "neo4j-driver";
import { GraphConfig } from "../config/types.js";
import {
  NodeLabel,
  EdgeType,
  assertValidLabel,
  assertValidEdge,
} from "./graph-schema.js";

/**
 * Thin Neo4j wrapper used by the sync processor and retriever.
 *
 * Design notes:
 * - Single driver, managed sessions. Call close() when the process exits.
 * - Every node/edge goes through assertValidLabel/assertValidEdge before
 *   any Cypher is run, so untrusted input can't inject new labels.
 * - Every auto-coder node carries a `repo` property so we can query per
 *   registered repo and delete cleanly on `repo remove`.
 */
export class GraphClient {
  private driver: Driver;

  constructor(config: GraphConfig) {
    this.driver = neo4j.driver(
      config.url,
      neo4j.auth.basic(config.username, config.password),
      { disableLosslessIntegers: true },
    );
  }

  async verifyConnectivity(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private session(): Session {
    return this.driver.session();
  }

  /**
   * Upsert a node by (label, id). Node properties are merged on conflict.
   *
   * Uses MERGE ... ON CREATE SET ... ON MATCH SET ... so repeated
   * syncs of the same entity don't create duplicates.
   */
  async upsertNode(
    label: NodeLabel,
    id: string,
    props: Record<string, unknown>,
  ): Promise<void> {
    assertValidLabel(label);
    const session = this.session();
    try {
      await session.run(
        `MERGE (n:${label} { id: $id })
         ON CREATE SET n += $props, n.created_at = datetime()
         ON MATCH SET n += $props, n.updated_at = datetime()`,
        { id, props: { ...props, id } },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Batch upsert a list of nodes of the same label.
   * Uses UNWIND for efficiency on large writes (sync processor).
   */
  async upsertNodes(
    label: NodeLabel,
    nodes: Array<{ id: string; props: Record<string, unknown> }>,
  ): Promise<void> {
    if (nodes.length === 0) return;
    assertValidLabel(label);
    const session = this.session();
    try {
      await session.run(
        `UNWIND $nodes AS n
         MERGE (x:${label} { id: n.id })
         ON CREATE SET x += n.props, x.created_at = datetime()
         ON MATCH SET x += n.props, x.updated_at = datetime()`,
        {
          nodes: nodes.map((n) => ({
            id: n.id,
            props: { ...n.props, id: n.id },
          })),
        },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Upsert an edge between two existing nodes.
   * If either node doesn't exist, this is a no-op (MATCH fails silently).
   */
  async upsertEdge(
    fromId: string,
    toId: string,
    type: EdgeType,
    props: Record<string, unknown> = {},
  ): Promise<void> {
    assertValidEdge(type);
    const session = this.session();
    try {
      await session.run(
        `MATCH (a { id: $fromId })
         MATCH (b { id: $toId })
         MERGE (a)-[r:${type}]->(b)
         ON CREATE SET r += $props, r.created_at = datetime()
         ON MATCH SET r += $props, r.updated_at = datetime()`,
        { fromId, toId, props },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Find nodes by label, optionally filtered by a single property.
   */
  async findByLabel(
    label: NodeLabel,
    where?: { key: string; value: unknown },
  ): Promise<Record<string, unknown>[]> {
    assertValidLabel(label);
    const session = this.session();
    try {
      const cypher = where
        ? `MATCH (n:${label}) WHERE n.${where.key} = $val RETURN n`
        : `MATCH (n:${label}) RETURN n`;
      const result = await session.run(cypher, where ? { val: where.value } : {});
      return result.records.map((r) => r.get("n").properties);
    } finally {
      await session.close();
    }
  }

  /**
   * Find neighbors of a node, optionally filtered by edge type and direction.
   */
  async findRelated(
    nodeId: string,
    edgeType?: EdgeType,
    direction: "out" | "in" | "both" = "out",
  ): Promise<Record<string, unknown>[]> {
    if (edgeType) assertValidEdge(edgeType);
    const pattern =
      direction === "out"
        ? `-[r${edgeType ? `:${edgeType}` : ""}]->`
        : direction === "in"
          ? `<-[r${edgeType ? `:${edgeType}` : ""}]-`
          : `-[r${edgeType ? `:${edgeType}` : ""}]-`;
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (a { id: $id }) ${pattern} (b) RETURN b`,
        { id: nodeId },
      );
      return result.records.map((r) => r.get("b").properties);
    } finally {
      await session.close();
    }
  }

  /**
   * Delete every node (and its edges) tagged with this repo.
   * Called when the user runs `repo remove` or re-bootstraps.
   */
  async deleteByRepo(repoName: string): Promise<number> {
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (n) WHERE n.repo = $repo
         DETACH DELETE n
         RETURN count(n) AS deleted`,
        { repo: repoName },
      );
      const deleted = result.records[0]?.get("deleted");
      return typeof deleted === "number" ? deleted : 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Count nodes per label for a given repo — useful for smoke tests.
   */
  async countByRepo(repoName: string): Promise<Record<string, number>> {
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (n) WHERE n.repo = $repo
         RETURN labels(n)[0] AS label, count(n) AS count`,
        { repo: repoName },
      );
      const out: Record<string, number> = {};
      for (const record of result.records) {
        const label = record.get("label") as string;
        const count = record.get("count");
        out[label] = typeof count === "number" ? count : 0;
      }
      return out;
    } finally {
      await session.close();
    }
  }

  /**
   * Escape hatch for raw Cypher. Use sparingly.
   */
  async runCypher(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const session = this.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }
}
