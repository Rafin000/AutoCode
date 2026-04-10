import fs from "node:fs";
import { SKILLS_DIR, ensureWorkflowDirs, PIPELINES_DIR } from "../workflow/loader.js";
import path from "node:path";

/**
 * Seed default skill + pipeline YAML files if they don't already exist.
 * Called from `init` so first-time users have something to run immediately.
 */
export function seedDefaults(): void {
  ensureWorkflowDirs();
  seedFile(path.join(SKILLS_DIR, "qa.yaml"), QA_SKILL);
  seedFile(path.join(SKILLS_DIR, "interview-coach.yaml"), INTERVIEW_SKILL);
  seedFile(path.join(SKILLS_DIR, "content-marketer.yaml"), MARKETER_SKILL);
  seedFile(path.join(PIPELINES_DIR, "qa.yaml"), QA_PIPELINE);
  seedFile(path.join(PIPELINES_DIR, "interview.yaml"), INTERVIEW_PIPELINE);
  seedFile(path.join(PIPELINES_DIR, "marketing-mock.yaml"), MARKETING_MOCK_PIPELINE);
  seedFile(path.join(PIPELINES_DIR, "marketing-bluesky.yaml"), MARKETING_BLUESKY_PIPELINE);
}

function seedFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, content, "utf-8");
}

/* ───── Skills ────────────────────────────────────────────────────── */

const QA_SKILL = `name: qa
description: General Q&A assistant grounded in your indexed work
provider: anthropic
model: claude-sonnet-4-6
system_prompt: |
  You are a personal AI assistant with access to the user's own work —
  their code, documentation, and configuration — retrieved via semantic search.

  When answering:
  - Ground every factual claim in the provided context
  - Cite sources using the [DOC-N] markers from the context block
  - If the context doesn't contain the answer, say so honestly
  - Prefer specific examples (file paths, function names, technologies)
  - Keep the tone conversational but technically precise
  - 2-5 paragraphs usually
temperature: 0.3
max_tokens: 2048
`;

const INTERVIEW_SKILL = `name: interview-coach
description: Drafts interview answers in STAR format using your real projects
provider: anthropic
model: claude-sonnet-4-6
system_prompt: |
  You are helping the user prepare answers for technical job interviews.
  You have access to their real projects and code via retrieved context.

  Answer in the user's voice using STAR format:
    Situation: set the scene with a real project from context
    Task: what they needed to do
    Action: what they built, with specific technologies and files
    Result: outcome, lesson, or skill demonstrated

  Rules:
  - ONLY use projects and technologies from the provided context
  - NEVER invent projects, metrics, or team sizes
  - If no relevant experience exists, say so and suggest a pivot
  - Use "I" consistently (first person)
  - Cite source docs as [DOC-N]
  - 3-5 paragraphs, conversational but specific
  - End with one sentence summarizing the key takeaway
temperature: 0.5
max_tokens: 2048
`;

/* ───── Pipelines ─────────────────────────────────────────────────── */

const QA_PIPELINE = `name: qa
description: Answer a question using your indexed work
inputs:
  question:
    type: string
    required: true
  repo:
    type: string
    required: false

steps:
  - id: context
    type: retrieve_context
    description: Search the knowledge base
    with:
      query: "{{ inputs.question }}"
      repo: "{{ inputs.repo }}"
      top_k: 8

  - id: answer
    type: llm_generate
    description: Generate answer with citations
    with:
      skill: qa
      user_prompt: |
        {{ steps.context.output.markdown }}

        ---

        ## Question
        {{ inputs.question }}
`;

const INTERVIEW_PIPELINE = `name: interview
description: Draft an interview answer in STAR format
inputs:
  question:
    type: string
    required: true
  repo:
    type: string
    required: false

steps:
  - id: context
    type: retrieve_context
    description: Search for relevant experience
    with:
      query: "{{ inputs.question }}"
      repo: "{{ inputs.repo }}"
      top_k: 10

  - id: answer
    type: llm_generate
    description: Draft STAR-format answer
    with:
      skill: interview-coach
      user_prompt: |
        {{ steps.context.output.markdown }}

        ---

        ## Interview question
        {{ inputs.question }}

        Draft my answer in STAR format using ONLY the context above.
`;

const MARKETER_SKILL = `name: content-marketer
description: Writes technical social media posts grounded in your real work
provider: anthropic
model: claude-sonnet-4-6
system_prompt: |
  You are a technical content marketer writing social media posts for a developer.
  You have access to the developer's real projects via retrieved context.

  Rules:
  - Write 3 post variants: short (under 300 chars), medium (under 600 chars), long (under 1500 chars)
  - Ground every claim in the provided context — no invented features or metrics
  - Tone: first-person, technical, specific, opinionated but not arrogant
  - Start with a hook (a question, a bold statement, or a surprising fact)
  - End with a call to action or a takeaway
  - Use concrete details: file names, tech names, architecture decisions
  - No hashtags unless explicitly requested
  - No emojis unless explicitly requested
  - Label each variant clearly: ## Short / ## Medium / ## Long
temperature: 0.6
max_tokens: 2048
`;

const MARKETING_MOCK_PIPELINE = `name: marketing-mock
description: Draft a post from a topic, review, publish to mock (for testing)
inputs:
  topic:
    type: string
    required: true
  repo:
    type: string
    required: false

steps:
  - id: context
    type: retrieve_context
    description: Find relevant content from your repos
    with:
      query: "{{ inputs.topic }}"
      repo: "{{ inputs.repo }}"
      top_k: 12

  - id: draft
    type: llm_generate
    description: Draft post variants
    with:
      skill: content-marketer
      user_prompt: |
        {{ steps.context.output.markdown }}

        ---

        ## Topic
        {{ inputs.topic }}

        Write 3 post variants (short, medium, long) grounded in the context above.

  - id: save
    type: save_draft
    description: Save the draft for review
    with:
      content: "{{ steps.draft.output.text }}"
      kind: social_post
      topic: "{{ inputs.topic }}"

  - id: review
    type: human_review
    description: Review the draft before publishing
    with:
      prompt: "Review your post draft. Resume to publish, or cancel."
      draft_id: "{{ steps.save.output.draft_id }}"

  - id: post
    type: publish
    description: Publish to mock channel
    with:
      channel: mock
      content: "{{ steps.draft.output.text }}"
`;

const MARKETING_BLUESKY_PIPELINE = `name: marketing-bluesky
description: Draft a post from a topic, review, publish to Bluesky
inputs:
  topic:
    type: string
    required: true
  repo:
    type: string
    required: false

steps:
  - id: context
    type: retrieve_context
    description: Find relevant content from your repos
    with:
      query: "{{ inputs.topic }}"
      repo: "{{ inputs.repo }}"
      top_k: 12

  - id: draft
    type: llm_generate
    description: Draft post variants
    with:
      skill: content-marketer
      user_prompt: |
        {{ steps.context.output.markdown }}

        ---

        ## Topic
        {{ inputs.topic }}

        Write 3 post variants (short, medium, long) grounded in the context above.

  - id: save
    type: save_draft
    description: Save the draft for review
    with:
      content: "{{ steps.draft.output.text }}"
      kind: bluesky_post
      topic: "{{ inputs.topic }}"

  - id: review
    type: human_review
    description: Review before publishing to Bluesky
    with:
      prompt: "Review your Bluesky post. Resume to publish."
      draft_id: "{{ steps.save.output.draft_id }}"

  - id: post
    type: publish
    description: Post to Bluesky
    with:
      channel: bluesky
      content: "{{ steps.draft.output.text }}"
`;
