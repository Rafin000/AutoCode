import { listSkills, loadSkill, skillPath, ensureWorkflowDirs } from "../workflow/loader.js";
import fs from "node:fs";

export async function skillListCommand(): Promise<void> {
  const skills = listSkills();
  if (skills.length === 0) {
    console.log("No skills defined.");
    console.log("Drop YAML files into ~/.auto-coder/skills/ to get started.");
    return;
  }
  const nameWidth = Math.max(...skills.map((s) => s.name.length), 10) + 2;
  console.log(`${skills.length} skill(s) defined:\n`);
  console.log(`${"NAME".padEnd(nameWidth)}${"PROVIDER".padEnd(12)}${"MODEL".padEnd(24)}DESCRIPTION`);
  console.log("─".repeat(nameWidth + 12 + 24 + 30));
  for (const s of skills) {
    console.log(
      `${s.name.padEnd(nameWidth)}${s.provider.padEnd(12)}${s.model.padEnd(24)}${s.description ?? ""}`,
    );
  }
}

export async function skillShowCommand(name: string): Promise<void> {
  let skill;
  try {
    skill = loadSkill(name);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`# Skill: ${skill.name}`);
  console.log();
  if (skill.description) console.log(`Description: ${skill.description}`);
  console.log(`Provider:    ${skill.provider}`);
  console.log(`Model:       ${skill.model}`);
  console.log(`Temperature: ${skill.temperature ?? 0.3}`);
  console.log(`Max tokens:  ${skill.max_tokens ?? 2048}`);
  console.log(`File:        ${skillPath(name)}`);
  console.log();
  console.log("## System prompt");
  console.log();
  console.log(skill.system_prompt.trim());
}

export async function skillValidateCommand(): Promise<void> {
  ensureWorkflowDirs();
  const skills = listSkills();
  if (skills.length === 0) {
    console.log("No skills to validate.");
    return;
  }
  let errors = 0;
  for (const s of skills) {
    const issues: string[] = [];
    if (!s.system_prompt || s.system_prompt.trim().length < 20) {
      issues.push("system_prompt is too short (min 20 chars)");
    }
    if (s.temperature !== undefined && (s.temperature < 0 || s.temperature > 2)) {
      issues.push("temperature out of range (0-2)");
    }
    if (issues.length > 0) {
      console.log(`✗ ${s.name}:`);
      for (const issue of issues) console.log(`    - ${issue}`);
      errors++;
    } else {
      console.log(`✓ ${s.name}`);
    }
  }
  if (errors > 0) {
    console.log(`\n${errors} skill(s) have issues.`);
    process.exit(1);
  }
  console.log(`\nAll ${skills.length} skill(s) are valid.`);
}
