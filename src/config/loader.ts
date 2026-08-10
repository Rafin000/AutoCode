import fs from "node:fs";
import yaml from "yaml";
import { Config, DEFAULT_CONFIG } from "./types.js";
import { CONFIG_DIR, CONFIG_FILE } from "./paths.js";

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function validateConfig(c: Config): void {
  const errs: string[] = [];
  if (!c || typeof c !== "object") errs.push("config is empty or not an object");
  if (!c?.llm?.provider) errs.push("llm.provider is required (anthropic | openai)");
  if (!c?.llm?.model) errs.push("llm.model is required");
  if (!c?.knowledge?.graph?.url) errs.push("knowledge.graph.url is required");
  if (!c?.knowledge?.vectors?.url) errs.push("knowledge.vectors.url is required");
  if (!c?.embedder?.model) errs.push("embedder.model is required");
  if (errs.length) {
    throw new Error(
      `Invalid config at ${CONFIG_FILE}:\n  - ${errs.join("\n  - ")}\n` +
        "Fix it, or run `autocode init` to regenerate defaults.",
    );
  }
}

export function loadConfig(): Config {
  if (!configExists()) {
    throw new Error(
      `No config found at ${CONFIG_FILE}. Run \`autocode init\` first.`,
    );
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = yaml.parse(raw) as Config;
  validateConfig(parsed);
  return parsed;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const header = "# autocode config — edit manually or via `autocode` commands\n\n";
  const yamlStr = header + yaml.stringify(config);
  fs.writeFileSync(CONFIG_FILE, yamlStr, "utf-8");
}

export function createDefaultConfig(): Config {
  ensureConfigDir();
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
