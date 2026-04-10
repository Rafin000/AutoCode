import { Publisher } from "./types.js";
import { BlueskyPublisher } from "./bluesky.js";
import { MockPublisher } from "./mock.js";

const publishers: Record<string, () => Publisher> = {
  bluesky: () => new BlueskyPublisher(),
  mock: () => new MockPublisher(),
};

export function getPublisher(channel: string): Publisher {
  const factory = publishers[channel];
  if (!factory) {
    const available = Object.keys(publishers).join(", ");
    throw new Error(`Unknown channel "${channel}". Available: ${available}`);
  }
  return factory();
}

export function listChannels(): string[] {
  return Object.keys(publishers);
}

export type { Publisher, PublishRequest, PublishResult } from "./types.js";
