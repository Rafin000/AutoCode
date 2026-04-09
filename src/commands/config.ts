import fs from "node:fs";
import { configExists } from "../config/loader.js";
import { CONFIG_FILE } from "../config/paths.js";

export async function configCommand(): Promise<void> {
  if (!configExists()) {
    console.error(`No config found at ${CONFIG_FILE}`);
    console.error("Run `auto-coder init` first.");
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  console.log(`# Path: ${CONFIG_FILE}`);
  console.log();
  console.log(raw);
}
