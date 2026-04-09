import { configExists, createDefaultConfig } from "../config/loader.js";
import { CONFIG_DIR, CONFIG_FILE } from "../config/paths.js";

export async function initCommand(): Promise<void> {
  if (configExists()) {
    console.log(`Config already exists at ${CONFIG_FILE}`);
    console.log("Run `auto-coder config` to view it.");
    return;
  }

  createDefaultConfig();

  console.log(`✓ Created ${CONFIG_DIR}`);
  console.log(`✓ Wrote default config to ${CONFIG_FILE}`);
  console.log();
  console.log("Next steps:");
  console.log("  auto-coder repo add <name> <path>    # register a repo");
  console.log("  auto-coder sync <name>               # index it");
  console.log('  auto-coder ask "<question>"          # ask questions');
}
