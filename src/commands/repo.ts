import path from "node:path";
import fs from "node:fs";
import { loadConfig, saveConfig } from "../config/loader.js";

export async function repoAddCommand(name: string, repoPath: string): Promise<void> {
  const absPath = path.resolve(repoPath);

  if (!fs.existsSync(absPath)) {
    console.error(`Path does not exist: ${absPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(absPath, ".git"))) {
    console.error(`Not a git repo (no .git/ found): ${absPath}`);
    process.exit(1);
  }

  const config = loadConfig();
  const existing = config.repos.find((r) => r.name === name);
  if (existing) {
    console.error(`Repo "${name}" already registered at ${existing.path}`);
    console.error(`Run \`autocode repo remove ${name}\` first if you want to change the path.`);
    process.exit(1);
  }

  config.repos.push({ name, path: absPath });
  saveConfig(config);
  console.log(`✓ Registered "${name}" → ${absPath}`);
}

export async function repoListCommand(): Promise<void> {
  const config = loadConfig();
  if (config.repos.length === 0) {
    console.log("No repos registered yet.");
    console.log("Use `autocode repo add <name> <path>` to add one.");
    return;
  }

  console.log(`${config.repos.length} repo(s) registered:\n`);
  const nameWidth = Math.max(...config.repos.map((r) => r.name.length), 10);
  for (const repo of config.repos) {
    console.log(`  ${repo.name.padEnd(nameWidth + 2)}${repo.path}`);
  }
}

export async function repoRemoveCommand(name: string): Promise<void> {
  const config = loadConfig();
  const before = config.repos.length;
  config.repos = config.repos.filter((r) => r.name !== name);

  if (config.repos.length === before) {
    console.error(`No repo named "${name}" is registered.`);
    process.exit(1);
  }

  saveConfig(config);
  console.log(`✓ Removed "${name}"`);
}
