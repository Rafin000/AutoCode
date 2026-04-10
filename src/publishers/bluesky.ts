import { Publisher, PublishRequest, PublishResult } from "./types.js";

/**
 * Bluesky publisher using the AT Protocol HTTP API.
 *
 * Auth: uses app password (not OAuth) for simplicity.
 * Set these in your shell:
 *   BLUESKY_HANDLE=your.handle.bsky.social
 *   BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *
 * To create an app password:
 *   Settings → Privacy and Security → App Passwords → Add App Password
 *
 * Posts are limited to 300 graphemes (roughly 300 chars for ASCII).
 */

const BLUESKY_API = "https://bsky.social/xrpc";

interface SessionResponse {
  did: string;
  handle: string;
  accessJwt: string;
}

export class BlueskyPublisher implements Publisher {
  name = "bluesky";

  private handle: string;
  private appPassword: string;

  constructor() {
    const handle = process.env.BLUESKY_HANDLE;
    const password = process.env.BLUESKY_APP_PASSWORD;

    if (!handle || !password) {
      throw new Error(
        "Bluesky credentials not set. Export in your shell:\n" +
          '  export BLUESKY_HANDLE="your.handle.bsky.social"\n' +
          '  export BLUESKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"\n' +
          "\nCreate an app password at: Settings → Privacy and Security → App Passwords",
      );
    }

    this.handle = handle;
    this.appPassword = password;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    // Step 1: create session (login)
    const session = await this.createSession();

    // Step 2: create post
    const now = new Date().toISOString();
    const postBody = {
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: req.content,
        createdAt: now,
      },
    };

    const postRes = await fetch(`${BLUESKY_API}/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(postBody),
    });

    if (!postRes.ok) {
      const text = await postRes.text();
      throw new Error(`Bluesky post failed (${postRes.status}): ${text}`);
    }

    const postData = (await postRes.json()) as { uri: string; cid: string };

    // Build the web URL from the URI
    // URI format: at://did:plc:xxx/app.bsky.feed.post/rkey
    const rkey = postData.uri.split("/").pop() ?? "";
    const webUrl = `https://bsky.app/profile/${this.handle}/post/${rkey}`;

    return {
      url: webUrl,
      id: postData.uri,
      channel: "bluesky",
    };
  }

  private async createSession(): Promise<SessionResponse> {
    const res = await fetch(`${BLUESKY_API}/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: this.handle,
        password: this.appPassword,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bluesky login failed (${res.status}): ${text}`);
    }

    return (await res.json()) as SessionResponse;
  }
}
