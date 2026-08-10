import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { CONFIG_DIR } from "../config/paths.js";
import { PipelineDefinition, SkillDefinition } from "./types.js";

/* ───── Paths ─────────────────────────────────────────────────────── */

export const PIPELINES_DIR = path.join(CONFIG_DIR, "pipelines");
export const SKILLS_DIR = path.join(CONFIG_DIR, "skills");

export function ensureWorkflowDirs(): void {
  if (!fs.existsSync(PIPELINES_DIR)) {
    fs.mkdirSync(PIPELINES_DIR, { recursive: true });
  }
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

/* ───── Pipelines ─────────────────────────────────────────────────── */

export function pipelinePath(name: string): string {
  return path.join(PIPELINES_DIR, `${name}.yaml`);
}

export function loadPipeline(name: string): PipelineDefinition {
  const file = pipelinePath(name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Pipeline "${name}" not found at ${file}. ` +
        `Run \`autocode pipeline list\` to see what's available.`,
    );
  }
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = yaml.parse(raw) as PipelineDefinition | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Pipeline "${name}" is not a valid YAML object`);
  }
  validatePipeline(parsed, file);
  return parsed;
}

export function listPipelines(): PipelineDefinition[] {
  ensureWorkflowDirs();
  const files = fs.readdirSync(PIPELINES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const out: PipelineDefinition[] = [];
  for (const file of files) {
    try {
      const name = path.basename(file, path.extname(file));
      out.push(loadPipeline(name));
    } catch (err) {
      console.warn(`  (skipping ${file}: ${(err as Error).message})`);
    }
  }
  return out;
}

function validatePipeline(pipeline: PipelineDefinition, file: string): void {
  if (typeof pipeline.name !== "string" || pipeline.name.length === 0) {
    throw new Error(`${file}: missing or empty \`name\``);
  }
  if (!Array.isArray(pipeline.steps)) {
    throw new Error(`${file}: \`steps\` must be an array`);
  }
  const seenIds = new Set<string>();
  for (const step of pipeline.steps) {
    if (typeof step.id !== "string" || step.id.length === 0) {
      throw new Error(`${file}: every step needs a string \`id\``);
    }
    if (seenIds.has(step.id)) {
      throw new Error(`${file}: duplicate step id "${step.id}"`);
    }
    seenIds.add(step.id);
    if (typeof step.type !== "string" || step.type.length === 0) {
      throw new Error(`${file}: step "${step.id}" missing \`type\``);
    }
  }
}

/* ───── Skills ────────────────────────────────────────────────────── */

export function skillPath(name: string): string {
  return path.join(SKILLS_DIR, `${name}.yaml`);
}

export function loadSkill(name: string): SkillDefinition {
  const file = skillPath(name);
  if (!fs.existsSync(file)) {
    throw new Error(`Skill "${name}" not found at ${file}`);
  }
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = yaml.parse(raw) as SkillDefinition | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Skill "${name}" is not a valid YAML object`);
  }
  validateSkill(parsed, file);
  return parsed;
}

export function listSkills(): SkillDefinition[] {
  ensureWorkflowDirs();
  const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const out: SkillDefinition[] = [];
  for (const file of files) {
    try {
      const name = path.basename(file, path.extname(file));
      out.push(loadSkill(name));
    } catch (err) {
      console.warn(`  (skipping ${file}: ${(err as Error).message})`);
    }
  }
  return out;
}

function validateSkill(skill: SkillDefinition, file: string): void {
  if (typeof skill.name !== "string") throw new Error(`${file}: missing \`name\``);
  if (skill.provider !== "anthropic" && skill.provider !== "openai") {
    throw new Error(`${file}: \`provider\` must be "anthropic" or "openai"`);
  }
  if (typeof skill.model !== "string") throw new Error(`${file}: missing \`model\``);
  if (typeof skill.system_prompt !== "string") throw new Error(`${file}: missing \`system_prompt\``);
}
