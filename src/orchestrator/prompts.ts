import { FeatureContext } from "./feature-context.js";

export interface BuildPromptInput {
  featureId: string;
  title: string;
  description: string;
  context: FeatureContext;
  /** Optional pre-approved plan markdown — injected into the implementation prompt */
  plan?: string;
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
  const { featureId, title, description, context, plan } = input;
  const resultFile = `.agent/results/result-${featureId}.json`;

  const planSection = plan
    ? `

---

## APPROVED IMPLEMENTATION PLAN

The following plan has been reviewed and approved. Implement it faithfully. If you genuinely need to deviate from the plan (e.g. the plan is incorrect about an existing file), do so and note the deviation in the result's \`notes\` field.

${plan}`
    : "";

  return `You are an expert software engineer implementing a feature in an existing codebase.

You are working inside a git repository. Your job is to implement the feature described below, then write a result summary file that the calling tool will read.

## FEATURE

**ID**: ${featureId}
**Title**: ${title}

**Description**:
${description}

---

${context.markdown}${planSection}

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

/**
 * Planning prompt — asks Claude to write a markdown plan file only,
 * no implementation code. Used by the plan-first feature flow.
 *
 * The plan file is later injected into `buildImplementationPrompt`
 * via the `plan` field so the implementer has a pre-approved
 * blueprint to follow.
 */
export function buildPlanningPrompt(input: BuildPromptInput): string {
  const { featureId, title, description, context } = input;
  const planFile = `.agent/plans/plan-${featureId}.md`;
  const resultFile = `.agent/results/result-${featureId}.json`;

  return `You are an expert software engineer **planning** a feature implementation.

You are in PLANNING mode. **Do NOT write any implementation code.** Your only job is to investigate the codebase and write a plan that a separate implementation step will follow.

## FEATURE

**ID**: ${featureId}
**Title**: ${title}

**Description**:
${description}

---

${context.markdown}

---

## YOUR TASK

1. **Investigate the codebase** by reading the files that matter for this feature. Use the context above as a starting map; open any additional files you need.

2. **Write a plan** to \`${planFile}\` in the repo. Create the \`.agent/plans/\` directory if it doesn't exist. The plan must be a markdown file with these sections:

   - **Approach** — 2-3 paragraphs explaining the strategy. Mention specific files you'll touch and existing patterns you'll follow.
   - **Files to modify** — bulleted list of existing files with a 1-line reason for each
   - **Files to create** — bulleted list of new files with a 1-line purpose for each
   - **Tests** — what tests will you add? Or "none" if the repo has no test setup.
   - **Risks** — what might break, what requires extra attention, what edge cases you noticed
   - **Out of scope** — what you explicitly will NOT do (to prevent scope creep)

3. **Write a result file** to \`${resultFile}\` in the repo. The file must be a JSON object with this shape:

\`\`\`json
{
  "status": "completed" | "failed",
  "plan_file": "${planFile}",
  "summary": "one-sentence summary of the planned approach",
  "notes": "anything else worth knowing — or the error message if status is 'failed'"
}
\`\`\`

4. **Do not apologize, explain, or summarize** in your final response text. Just write the plan file and the result file, then stop.

## CONSTRAINTS

- **Do NOT write any code files**. Only the plan markdown and the result JSON.
- **Do NOT create a git branch or commit anything.**
- **Do NOT run the code or execute tests.**
- **Do NOT install dependencies.**
- If you can't plan this feature (e.g. the feature description is too unclear), write the result file with \`status: "failed"\` and explain in \`notes\`.

Begin.`;
}
