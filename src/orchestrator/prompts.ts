import { FeatureContext } from "./feature-context.js";

export interface BuildPromptInput {
  featureId: string;
  title: string;
  description: string;
  context: FeatureContext;
}

/**
 * Build the full prompt that gets piped to Claude CLI for feature
 * implementation.
 *
 * The prompt has four parts:
 *
 *   1. Role + overall objective
 *   2. Feature spec (title + description)
 *   3. Retrieved context from the knowledge base
 *   4. Concrete task list, including the result JSON file Claude
 *      must write at the end so the CLI can parse the outcome
 *
 * Claude is expected to work in the repo at `cwd` (the CLI
 * spawns it with workingDir = repo path).
 */
export function buildImplementationPrompt(input: BuildPromptInput): string {
  const { featureId, title, description, context } = input;
  const resultFile = `.agent/results/result-${featureId}.json`;

  return `You are an expert software engineer implementing a feature in an existing codebase.

You are working inside a git repository. Your job is to implement the feature described below, then write a result summary file that the calling tool will read.

## FEATURE

**ID**: ${featureId}
**Title**: ${title}

**Description**:
${description}

---

${context.markdown}

---

## YOUR TASK

1. **Understand the codebase** by reading the relevant files. Use the context above as a starting map, but feel free to open any file you need.

2. **Implement the feature**:
   - Follow the existing code patterns and conventions you see in the repo
   - Don't add speculative features or premature abstractions
   - Write tests when the repo already has a test setup
   - Keep the change focused on what the description asks for

3. **Do NOT** commit anything yourself. Do NOT create a git branch. The calling tool handles git + PR creation.

4. **Write a result file** to \`${resultFile}\` in the repo when you finish. Create the \`.agent/results/\` directory if it doesn't exist. The file must be a JSON object with this exact shape:

\`\`\`json
{
  "status": "completed" | "failed",
  "summary": "1-3 sentences describing what you built",
  "files_modified": ["src/foo.ts", "src/bar.ts"],
  "files_created": ["src/baz.ts"],
  "tests_run": "pass" | "fail" | "none",
  "impact_report": "Longer paragraph explaining what changed and why, what might break, and any follow-ups needed",
  "notes": "Anything else worth knowing — or the error message if status is 'failed'"
}
\`\`\`

5. **Do not apologize, explain, or summarize** in your final response text. Just write the files you need to write and the result JSON, then stop. The calling tool only reads the result file.

## CONSTRAINTS

- Do not run \`git commit\`, \`git push\`, or any branching commands
- Do not install new dependencies unless absolutely necessary
- Do not touch files outside the repository
- If you can't complete the feature for any reason, write the result file with \`status: "failed"\` and a clear \`notes\` field explaining why

Begin.`;
}
