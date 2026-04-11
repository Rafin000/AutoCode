import { Publisher, PublishRequest, PublishResult } from "./types.js";

/**
 * Buffer publisher — fans out to LinkedIn, X, Facebook, Instagram,
 * TikTok, Pinterest, Bluesky, Threads, Mastodon via a single API call.
 *
 * Auth: uses a Buffer access token.
 *   BUFFER_ACCESS_TOKEN — get from https://buffer.com/developers/api
 *   BUFFER_PROFILE_IDS  — comma-separated profile IDs to post to
 *
 * Buffer free tier: 3 channels, 10 scheduled posts/channel.
 * Buffer paid ($6/mo): unlimited channels + scheduling.
 */

const BUFFER_API = "https://api.bufferapp.com/1";

export class BufferPublisher implements Publisher {
  name = "buffer";

  private token: string;
  private profileIds: string[];

  constructor() {
    const token = process.env.BUFFER_ACCESS_TOKEN;
    const profiles = process.env.BUFFER_PROFILE_IDS;

    if (!token) {
      throw new Error(
        "BUFFER_ACCESS_TOKEN is not set. Get one from https://buffer.com/developers/api\n" +
          '  export BUFFER_ACCESS_TOKEN="..."',
      );
    }
    if (!profiles) {
      throw new Error(
        "BUFFER_PROFILE_IDS is not set. Comma-separated list of Buffer profile IDs.\n" +
          '  export BUFFER_PROFILE_IDS="id1,id2,id3"\n' +
          "  Find your profile IDs at: https://buffer.com/developers/api/profiles",
      );
    }

    this.token = token;
    this.profileIds = profiles.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const body = {
      text: req.content,
      profile_ids: this.profileIds,
      now: true, // post immediately (use `scheduled_at` for scheduling)
    };

    const res = await fetch(`${BUFFER_API}/updates/create.json?access_token=${this.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Buffer API error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      success: boolean;
      updates?: Array<{ id: string; service?: { username?: string } }>;
      message?: string;
    };

    if (!data.success) {
      throw new Error(`Buffer rejected the post: ${data.message ?? "unknown error"}`);
    }

    const firstUpdate = data.updates?.[0];
    const updateId = firstUpdate?.id ?? "unknown";

    return {
      url: `https://buffer.com/publish/queue`,
      id: updateId,
      channel: `buffer (${this.profileIds.length} profile(s))`,
    };
  }
}
