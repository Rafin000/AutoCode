import { loadConfig } from "../config/loader.js";
import { assembleContext } from "../retriever/assembler.js";
import { callLLM } from "../agent/llm.js";

const INTERVIEW_SYSTEM_PROMPT = `You are helping the user prepare answers for technical job interviews. You have access to their real projects and code via retrieved context.

Your job is to answer recruiter/interviewer questions **in the user's voice**, using ONLY the projects and technologies they actually have in the context. The goal is an answer they could deliver verbatim in an interview.

Answer structure — STAR format:
  **Situation**: set the scene using a real project from the context (mention the project by name)
  **Task**: what they needed to do
  **Action**: what they actually built, with specific technologies and file names where helpful
  **Result**: the outcome, lesson learned, or skill demonstrated

Rules:
- ONLY use projects, technologies, and code that appear in the provided context
- NEVER invent projects, metrics ("reduced latency by 40%"), or team sizes
- If the context doesn't contain a relevant experience, say so honestly and suggest a pivot (e.g. "I don't have direct production experience with X, but here's a related project that shows the underlying skill")
- Use "I" consistently (first person) — this is the user speaking
- Cite source docs inline as [DOC-N] where relevant so the user can verify
- 3-5 paragraphs, conversational but specific
- End with one sentence summarizing the key takeaway or skill demonstrated`;

export interface InterviewOptions {
  repo?: string;
  topK?: string;
}

export async function interviewCommand(
  question: string,
  opts: InterviewOptions,
): Promise<void> {
  const config = loadConfig();

  console.log("• Retrieving relevant experience...");
  const context = await assembleContext(config, question, {
    repo: opts.repo,
    topK: opts.topK ? parseInt(opts.topK, 10) : 10,
  });
  console.log(`  ✓ Got ${context.sources.length} relevant documents`);

  console.log(`• Drafting answer with ${config.llm.provider} (${config.llm.model})...`);
  const userPrompt = `${context.markdown}\n\n---\n\n## Interview question\n${question}\n\nDraft my answer in STAR format, using ONLY what's in the context above.`;

  try {
    const response = await callLLM(
      {
        system: INTERVIEW_SYSTEM_PROMPT,
        user: userPrompt,
        temperature: 0.5, // slightly higher for more natural phrasing
      },
      config.llm,
    );

    console.log();
    console.log("━".repeat(70));
    console.log(response.text.trim());
    console.log("━".repeat(70));
    console.log();

    if (context.sources.length > 0) {
      console.log("Grounded in:");
      context.sources.forEach((s, i) => {
        const p = s.payload;
        console.log(
          `  [DOC-${i + 1}] ${String(p.file_path ?? "")} · ${String(p.doc_type ?? "")}${p.anchor ? ` · ${String(p.anchor)}` : ""}`,
        );
      });
    }

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
