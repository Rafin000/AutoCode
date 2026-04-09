import { spawn, ChildProcess } from "node:child_process";

/**
 * Thin wrapper around spawning the local `claude` CLI as a subprocess.
 *
 * Design:
 *   - Spawns `claude` with `--output-format stream-json` so we get one
 *     JSON event per line as things happen (tool uses, thinking, etc.)
 *   - Pipes the full prompt to stdin and closes it immediately
 *   - Parses each stdout line as a JSON event and dispatches to
 *     `onEvent` — the caller decides what to print
 *   - Captures stderr separately for error reporting
 *   - Resolves with an ExitResult when the process exits
 *
 * Why spawn instead of using the Anthropic API directly?
 *   - The `claude` CLI already has file tools (Read/Write/Edit),
 *     bash execution, and git awareness built in. Rebuilding that
 *     from the raw API is weeks of work.
 *   - Auth is handled by the user's existing `claude login` — no
 *     API key management.
 *   - Every feature implementation runs in a separate child process,
 *     so a crash in one doesn't affect anything else.
 */

export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

export interface SpawnOptions {
  prompt: string;
  workingDir: string;
  env?: Record<string, string>;
  /** 0 or undefined means no timeout */
  maxTimeoutMs?: number;
  /** Called for every parsed JSONL event from Claude CLI's stdout */
  onEvent?: (event: ClaudeEvent) => void;
  /** Called with stderr chunks (unparsed) */
  onStderr?: (chunk: string) => void;
}

export interface SpawnResult {
  exitCode: number;
  /** Number of events received over the lifetime of the run */
  eventCount: number;
  /** Full stderr captured from the child */
  stderr: string;
  /** Wall-clock time of the run in ms */
  elapsedMs: number;
}

export async function spawnClaudeCli(opts: SpawnOptions): Promise<SpawnResult> {
  const startedAt = Date.now();

  const mergedEnv = { ...process.env, ...(opts.env ?? {}) };

  const child: ChildProcess = spawn(
    "claude",
    ["--output-format", "stream-json", "--verbose", "--print"],
    {
      cwd: opts.workingDir,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  // Feed the prompt via stdin and close it so Claude knows no more input is coming
  child.stdin?.write(opts.prompt);
  child.stdin?.end();

  let stderr = "";
  let eventCount = 0;
  let stdoutBuffer = "";

  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;

    // Split on newlines, process every complete line, keep the tail
    let newlineIdx: number;
    while ((newlineIdx = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newlineIdx).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const event = JSON.parse(line) as ClaudeEvent;
        eventCount += 1;
        opts.onEvent?.(event);
      } catch {
        // Non-JSON line — ignore (Claude CLI sometimes emits plain text too)
      }
    }
  });

  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    opts.onStderr?.(chunk);
  });

  // Optional wall-clock timeout
  let timeoutHandle: NodeJS.Timeout | null = null;
  if (opts.maxTimeoutMs && opts.maxTimeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.maxTimeoutMs);
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Flush any trailing buffered line
      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer.trim()) as ClaudeEvent;
          eventCount += 1;
          opts.onEvent?.(event);
        } catch {
          // ignore
        }
      }

      resolve({
        exitCode: code ?? 0,
        eventCount,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Default event printer. Translates common Claude CLI events into
 * friendly terminal output. Callers can replace with their own
 * handler for custom UX.
 */
export function defaultEventPrinter(event: ClaudeEvent): void {
  // The event schema varies slightly by CLI version. We handle the
  // common shapes and ignore anything we don't recognize.
  const t = event.type;

  if (t === "assistant" || t === "message") {
    const content = event.message as { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } | undefined;
    if (!content?.content) return;

    for (const block of content.content) {
      if (block.type === "text" && block.text) {
        // Truncate long text blocks for terminal display
        const text = block.text.trim();
        if (text.length > 0) {
          console.log(`  ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
        }
      } else if (block.type === "tool_use") {
        const name = block.name ?? "tool";
        const input = (block.input ?? {}) as Record<string, unknown>;
        printToolUse(name, input);
      }
    }
  } else if (t === "result") {
    // Final result event — let the caller summarize
  }
}

function printToolUse(name: string, input: Record<string, unknown>): void {
  const fileArg = (input.file_path as string) ?? (input.path as string);
  const cmdArg = input.command as string;
  const patternArg = input.pattern as string;

  switch (name) {
    case "Read":
      console.log(`  → Read ${fileArg ?? "?"}`);
      break;
    case "Write":
      console.log(`  ✎ Write ${fileArg ?? "?"}`);
      break;
    case "Edit":
      console.log(`  ✎ Edit ${fileArg ?? "?"}`);
      break;
    case "Bash":
      console.log(`  $ ${cmdArg ? cmdArg.slice(0, 100) : "(bash)"}`);
      break;
    case "Glob":
      console.log(`  ? Glob ${patternArg ?? "?"}`);
      break;
    case "Grep":
      console.log(`  ? Grep ${patternArg ?? "?"}`);
      break;
    default:
      console.log(`  · ${name}`);
  }
}
