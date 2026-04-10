import { registerStep } from "../registry.js";
import { StepExecutionContext, StepExecutionResult } from "../types.js";
import { getPublisher } from "../../publishers/index.js";

/**
 * Step: publish
 *
 * Sends content to an external channel via a publisher.
 *
 * Config:
 *   channel:  string  — publisher name (e.g. "bluesky", "mock") (required)
 *   content:  string  — the text to publish (required, usually from a prior step)
 */
registerStep("publish", async (ctx: StepExecutionContext): Promise<StepExecutionResult> => {
  const channel = ctx.config.channel as string | undefined;
  if (!channel) {
    return { status: "failed", output: {}, error: "publish requires a 'channel' in config" };
  }

  const content = ctx.config.content as string | undefined;
  if (!content) {
    return { status: "failed", output: {}, error: "publish requires 'content' in config" };
  }

  try {
    const publisher = getPublisher(channel);
    const result = await publisher.publish({ content });

    return {
      status: "completed",
      output: {
        url: result.url,
        id: result.id,
        channel: result.channel,
      },
    };
  } catch (err) {
    return { status: "failed", output: {}, error: (err as Error).message };
  }
});
