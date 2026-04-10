import { registerStep } from "../registry.js";
import { StepExecutionContext, StepExecutionResult } from "../types.js";
import { loadSkill } from "../loader.js";
import { callLLM } from "../../agent/llm.js";

/**
 * Step: llm_generate
 *
 * Calls an LLM using a named skill (system prompt + model config)
 * and a user prompt assembled from previous step outputs.
 *
 * Config:
 *   skill:        string  — name of a skill in ~/.auto-coder/skills/ (required)
 *   user_prompt:  string  — the user message to send (required, supports templates)
 *   max_tokens:   number  — override skill's default (optional)
 *   temperature:  number  — override skill's default (optional)
 */
registerStep("llm_generate", async (ctx: StepExecutionContext): Promise<StepExecutionResult> => {
  const skillName = ctx.config.skill as string | undefined;
  if (!skillName) {
    return { status: "failed", output: {}, error: "llm_generate requires a 'skill' in config" };
  }

  const userPrompt = ctx.config.user_prompt as string | undefined;
  if (!userPrompt) {
    return { status: "failed", output: {}, error: "llm_generate requires a 'user_prompt' in config" };
  }

  let skill;
  try {
    skill = loadSkill(skillName);
  } catch (err) {
    return { status: "failed", output: {}, error: `Failed to load skill "${skillName}": ${(err as Error).message}` };
  }

  const maxTokens = (ctx.config.max_tokens as number | undefined) ?? skill.max_tokens ?? 2048;
  const temperature = (ctx.config.temperature as number | undefined) ?? skill.temperature ?? 0.3;

  try {
    const response = await callLLM(
      {
        system: skill.system_prompt,
        user: userPrompt,
        maxTokens,
        temperature,
      },
      { provider: skill.provider, model: skill.model },
    );

    return {
      status: "completed",
      output: {
        text: response.text,
        provider: response.provider,
        model: response.model,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
      },
    };
  } catch (err) {
    return { status: "failed", output: {}, error: (err as Error).message };
  }
});
