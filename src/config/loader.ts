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

export function loadConfig(): Config {
  if (!configExists()) {
    throw new Error(
      `No config found at ${CONFIG_FILE}. Run \`auto-coder init\` first.`,
    );
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = yaml.parse(raw) as Config;
  return parsed;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const header = "# auto-coder config — edit manually or via `auto-coder` commands\n\n";
  const yamlStr = header + yaml.stringify(config);
  fs.writeFileSync(CONFIG_FILE, yamlStr, "utf-8");
}

export function createDefaultConfig(): Config {
  ensureConfigDir();
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
