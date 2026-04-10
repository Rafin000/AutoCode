/**
 * Publisher interface. Every channel (Bluesky, Buffer, etc.) implements
 * this contract. The publish step executor dispatches to the right
 * publisher based on the `channel` config field.
 */

export interface PublishRequest {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  url: string;
  id: string;
  channel: string;
}

export interface Publisher {
  name: string;
  publish(req: PublishRequest): Promise<PublishResult>;
}
