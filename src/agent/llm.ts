import { LLMConfig } from "../config/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a request timeout and a small retry on transient failures
 * (HTTP 429 / 5xx or network errors), using exponential backoff.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { timeoutMs = 60000, retries = 3 } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}


export interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  text: string;
  provider: "anthropic" | "openai";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Provider-agnostic LLM caller. Dispatches to the right HTTP API
 * based on `config.llm.provider`. Uses fetch directly — no SDK —
 * so we don't ship two more packages for a single endpoint each.
 *
 * Reads the API key from process.env:
 *   - provider: anthropic → ANTHROPIC_API_KEY
 *   - provider: openai    → OPENAI_API_KEY
 *
 * Throws a clear error message if the key is missing, so the user
 * knows exactly what to set.
 */
export async function callLLM(
  req: LLMRequest,
  config: LLMConfig,
): Promise<LLMResponse> {
  if (config.provider === "anthropic") {
    return callAnthropic(req, config);
  }
  if (config.provider === "openai") {
    return callOpenAI(req, config);
  }
  throw new Error(`Unknown LLM provider: ${config.provider}`);
}

/* ───── Anthropic ─────────────────────────────────────────────────── */

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  req: LLMRequest,
  config: LLMConfig,
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your shell:\n" +
        '  export ANTHROPIC_API_KEY="sk-ant-..."\n' +
        "Or prefix the command:\n" +
        '  ANTHROPIC_API_KEY="sk-ant-..." autocode ask "your question"',
    );
  }

  const body = {
    model: config.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.3,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  };

  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const textBlock = data.content.find((c) => c.type === "text");
  const text = textBlock?.text ?? "";

  return {
    text,
    provider: "anthropic",
    model: config.model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

/* ───── OpenAI ────────────────────────────────────────────────────── */

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function callOpenAI(
  req: LLMRequest,
  config: LLMConfig,
): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Export it in your shell:\n" +
        '  export OPENAI_API_KEY="sk-..."\n' +
        "Or prefix the command:\n" +
        '  OPENAI_API_KEY="sk-..." autocode ask "your question"',
    );
  }

  const body = {
    model: config.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature ?? 0.3,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };

  const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OpenAIResponse;
  const text = data.choices[0]?.message.content ?? "";

  return {
    text,
    provider: "openai",
    model: config.model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}
