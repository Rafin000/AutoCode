import { Publisher, PublishRequest, PublishResult } from "./types.js";
import { randomUUID } from "node:crypto";

/**
 * Mock publisher for testing. Instead of posting to a real service,
 * logs the content to the console and returns a fake URL.
 */
export class MockPublisher implements Publisher {
  name = "mock";

  async publish(req: PublishRequest): Promise<PublishResult> {
    const id = `mock-${randomUUID().slice(0, 8)}`;
    console.log(`  [mock] Would publish (${req.content.length} chars):`);
    console.log(`  ${req.content.slice(0, 200)}${req.content.length > 200 ? "..." : ""}`);
    return {
      url: `https://mock.local/posts/${id}`,
      id,
      channel: "mock",
    };
  }
}
