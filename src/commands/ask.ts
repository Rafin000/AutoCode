import { loadConfig } from "../config/loader.js";
import { assembleContext } from "../retriever/assembler.js";
import { callLLM } from "../agent/llm.js";

const ASK_SYSTEM_PROMPT = `You are a personal AI assistant with access to the user's own work — their code, documentation, and configuration — retrieved via semantic search.

When answering:
- Ground every factual claim in the provided context
- Cite sources using the [DOC-N] markers from the context block
- If the context doesn't contain the answer, say so honestly — don't invent details
- Prefer specific examples (file paths, function names, technologies) over vague summaries
- Keep the tone conversational but technically precise
- 2-5 paragraphs usually; go longer only if the question genuinely needs it`;

export interface AskOptions {
  repo?: string;
  topK?: string;
}

export async function askCommand(
  question: string,
  opts: AskOptions,
): Promise<void> {
  const config = loadConfig();

  console.log("• Retrieving relevant context...");
  const context = await assembleContext(config, question, {
    repo: opts.repo,
    topK: opts.topK ? parseInt(opts.topK, 10) : undefined,
  });

  if (context.sources.length === 0 && !opts.repo) {
    console.log(
      "  (no matching documents found — make sure you've run `auto-coder sync <name>`)",
    );
  } else {
    console.log(`  ✓ Got ${context.sources.length} relevant documents`);
  }

  console.log(`• Asking ${config.llm.provider} (${config.llm.model})...`);
  const userPrompt = `${context.markdown}\n\n---\n\n## Question\n${question}`;

  try {
    const response = await callLLM(
      { system: ASK_SYSTEM_PROMPT, user: userPrompt },
      config.llm,
    );

    console.log();
    console.log("━".repeat(70));
    console.log(response.text.trim());
    console.log("━".repeat(70));
    console.log();

    // Print sources so the user can verify
    if (context.sources.length > 0) {
      console.log("Sources:");
      context.sources.forEach((s, i) => {
        const p = s.payload;
        console.log(
          `  [DOC-${i + 1}] ${String(p.file_path ?? "")} · ${String(p.doc_type ?? "")}${p.anchor ? ` · ${String(p.anchor)}` : ""}  (score ${s.score.toFixed(3)})`,
        );
      });
    }

    // Usage info
    if (response.inputTokens || response.outputTokens) {
      console.log();
      console.log(
        `Tokens: ${response.inputTokens ?? "?"} in · ${response.outputTokens ?? "?"} out`,
      );
    }
  } catch (err) {
    console.error();
    console.error("✗ LLM call failed:");
    console.error("  ", (err as Error).message);
    process.exit(1);
  }
}
