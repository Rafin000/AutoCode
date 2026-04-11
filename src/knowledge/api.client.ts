/**
 * HTTP client for talking to the auto-coder Cloudflare Worker API.
 *
 * When `api.url` is set in config, the CLI uses this client instead
 * of local SQLite/Qdrant for features, rules, and vector operations.
 * This matches repo-agent's architecture: the CLI is local, the data
 * layer is on Cloudflare.
 *
 * When `api.url` is NOT set, the CLI uses local stores directly
 * (better-sqlite3, Qdrant client, @xenova/transformers). Both paths
 * are supported — the choice is purely config-driven.
 */

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /* ───── Features ──────────────────────────────────────────────── */

  async createFeature(title: string, description: string, repo?: string) {
    return this.post("/api/features", { title, description, repo });
  }

  async getFeature(id: string) {
    return this.get(`/api/features/${id}`);
  }

  async listFeatures(repo?: string) {
    const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";
    const res = await this.get(`/api/features${qs}`);
    return res.features;
  }

  async updateFeature(id: string, fields: Record<string, unknown>) {
    return this.patch(`/api/features/${id}`, fields);
  }

  async approveFeature(id: string) {
    return this.post(`/api/features/${id}/approve`, {});
  }

  async reworkFeature(id: string, instructions: string) {
    return this.post(`/api/features/${id}/rework`, { instructions });
  }

  /* ───── Rules ─────────────────────────────────────────────────── */

  async createRule(body: Record<string, unknown>) {
    return this.post("/api/rules", body);
  }

  async listRules(opts?: { type?: string; scope?: string; active?: string }) {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (opts?.scope) params.set("scope", opts.scope);
    if (opts?.active) params.set("active", opts.active);
    const qs = params.toString() ? `?${params}` : "";
    const res = await this.get(`/api/rules${qs}`);
    return res.rules;
  }

  async getRulesForScope(scope: string) {
    const res = await this.get(`/api/rules/for-scope/${encodeURIComponent(scope)}`);
    return res.rules;
  }

  async getRule(id: string) {
    return this.get(`/api/rules/${id}`);
  }

  async updateRule(id: string, fields: Record<string, unknown>) {
    return this.patch(`/api/rules/${id}`, fields);
  }

  async deleteRule(id: string) {
    return this.del(`/api/rules/${id}`);
  }

  /* ───── Vectors / Knowledge ───────────────────────────────────── */

  async vectorUpsert(
    vectors: Array<{
      id: string;
      content: string;
      content_type: string;
      service: string;
      file_path?: string;
      identifier?: string;
    }>,
  ) {
    return this.post("/api/knowledge/vectors/upsert", { vectors });
  }

  async vectorQuery(text: string, topK?: number, filter?: { service?: string }) {
    return this.post("/api/knowledge/vectors/query", { text, top_k: topK, filter });
  }

  async vectorDelete(ids: string[]) {
    return this.post("/api/knowledge/vectors/delete", { ids });
  }

  /* ───── Stats ─────────────────────────────────────────────────── */

  async getStats() {
    return this.get("/api/knowledge/stats");
  }

  /* ───── HTTP helpers ──────────────────────────────────────────── */

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  private async patch(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  private async del(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }
}

/**
 * Factory. Returns null if no API URL is configured (local mode).
 */
export function createApiClient(apiUrl: string | undefined): ApiClient | null {
  if (!apiUrl) return null;
  return new ApiClient(apiUrl);
}
