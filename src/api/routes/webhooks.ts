import { Hono } from "hono";

export const webhooksRoutes = new Hono();

/**
 * GitHub webhook receiver.
 *
 * Handles `pull_request_review` events — when a reviewer leaves
 * comments on a feature's PR, this endpoint captures the feedback
 * and can trigger rework.
 *
 * For v1: logs the event and stores it. Full rework triggering
 * is wired up in P5.2.
 */
webhooksRoutes.post("/github", async (c) => {
  const event = c.req.header("X-GitHub-Event");
  const body = await c.req.json();

  console.log(`[webhook] GitHub event: ${event}`);

  if (event === "pull_request_review") {
    const action = body.action as string;
    const review = body.review as { body?: string; state?: string } | undefined;
    const pr = body.pull_request as { number?: number; title?: string } | undefined;

    console.log(`  PR #${pr?.number}: ${pr?.title}`);
    console.log(`  Review: ${action} — ${review?.state}`);
    if (review?.body) {
      console.log(`  Comment: ${review.body.slice(0, 200)}`);
    }

    // TODO P5.2: match PR to feature by branch name or PR number,
    // store the review comment, and optionally auto-trigger rework
    return c.json({ received: true, event, action });
  }

  if (event === "issue_comment") {
    const action = body.action as string;
    const comment = body.comment as { body?: string } | undefined;
    const issue = body.issue as { number?: number; pull_request?: unknown } | undefined;

    // Only care about comments on PRs (not issues)
    if (!issue?.pull_request) {
      return c.json({ received: true, event, skipped: "not a PR comment" });
    }

    console.log(`  PR #${issue.number}: comment ${action}`);
    if (comment?.body) {
      console.log(`  ${comment.body.slice(0, 200)}`);
    }

    return c.json({ received: true, event, action });
  }

  return c.json({ received: true, event, handled: false });
});
