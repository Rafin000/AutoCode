import { Hono } from "hono";
import type { Env } from "../types.js";

export const webhooksRoutes = new Hono<{ Bindings: Env }>();

/**
 * Verify GitHub webhook signature using HMAC-SHA256.
 */
async function verifySignature(
  secret: string,
  body: string,
  signature: string | undefined,
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  if (expected.length !== signature.length) return false;

  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events (pull_request_review, issue_comment).
 * Matches the event to a feature by PR number or branch name, and
 * stores the feedback for use by the rework command.
 */
webhooksRoutes.post("/github", async (c) => {
  const rawBody = await c.req.text();

  // Verify signature if secret is configured
  const secret = c.env.WEBHOOK_SECRET;
  if (secret) {
    const signature = c.req.header("X-Hub-Signature-256");
    const valid = await verifySignature(secret, rawBody, signature);
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  const event = c.req.header("X-GitHub-Event");
  const payload = JSON.parse(rawBody);

  if (event === "pull_request_review") {
    return handlePullRequestReview(c, payload);
  }

  if (event === "issue_comment") {
    return handleIssueComment(c, payload);
  }

  return c.json({ received: true, event, handled: false });
});

async function handlePullRequestReview(
  c: any,
  payload: any,
): Promise<Response> {
  const review = payload.review;
  const pr = payload.pull_request;
  const prNumber = pr?.number;
  const reviewBody = review?.body ?? "";
  const reviewState = review?.state ?? "";

  if (!prNumber) {
    return c.json({ received: true, skipped: "no PR number" });
  }

  // Find the feature by PR number
  const feature = await c.env.DB.prepare(
    "SELECT * FROM features WHERE pr_number = ?",
  )
    .bind(prNumber)
    .first();

  if (!feature) {
    return c.json({ received: true, skipped: "no matching feature" });
  }

  // If the review requests changes and has a body, append to rework history
  if (reviewState === "changes_requested" && reviewBody.trim()) {
    const history = JSON.parse(feature.rework_history || "[]");
    history.push({
      instructions: reviewBody,
      timestamp: new Date().toISOString(),
      source: "github_review",
    });

    await c.env.DB.prepare(
      `UPDATE features SET
         rework_history = ?,
         status = 'rework',
         updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(JSON.stringify(history), feature.id)
      .run();

    return c.json({
      received: true,
      feature_id: feature.id,
      action: "rework_queued",
      review_state: reviewState,
    });
  }

  return c.json({
    received: true,
    feature_id: feature.id,
    review_state: reviewState,
  });
}

async function handleIssueComment(c: any, payload: any): Promise<Response> {
  const comment = payload.comment;
  const issue = payload.issue;

  // Only handle comments on PRs, not regular issues
  if (!issue?.pull_request) {
    return c.json({ received: true, skipped: "not a PR comment" });
  }

  const prNumber = issue.number;
  const commentBody = comment?.body ?? "";

  const feature = await c.env.DB.prepare(
    "SELECT * FROM features WHERE pr_number = ?",
  )
    .bind(prNumber)
    .first();

  if (!feature) {
    return c.json({ received: true, skipped: "no matching feature" });
  }

  // Store the comment as potential rework instruction
  if (commentBody.trim()) {
    const history = JSON.parse(feature.rework_history || "[]");
    history.push({
      instructions: commentBody,
      timestamp: new Date().toISOString(),
      source: "github_comment",
    });

    await c.env.DB.prepare(
      "UPDATE features SET rework_history = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(JSON.stringify(history), feature.id)
      .run();
  }

  return c.json({
    received: true,
    feature_id: feature.id,
    action: "comment_stored",
  });
}
