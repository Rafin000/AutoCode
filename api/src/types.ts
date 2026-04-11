/**
 * Cloudflare Worker environment bindings.
 *
 * These are the resources this Worker has access to, configured
 * in wrangler.toml. The Hono app uses `Env` as a generic parameter
 * so route handlers get typed access to `c.env.DB`, `c.env.VECTORIZE`, etc.
 */
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  WEBHOOK_SECRET?: string;
}
