import { configExists, createDefaultConfig } from "../config/loader.js";
import { CONFIG_DIR, CONFIG_FILE, DB_FILE } from "../config/paths.js";
import { initDb } from "../db/init.js";
import { dbExists } from "../db/client.js";
import { seedDefaults } from "../skills/defaults.js";

export async function initCommand(): Promise<void> {
  const hadConfig = configExists();
  const hadDb = dbExists();

  if (!hadConfig) {
    createDefaultConfig();
    console.log(`✓ Created ${CONFIG_DIR}`);
    console.log(`✓ Wrote default config to ${CONFIG_FILE}`);
  } else {
    console.log(`• Config already exists at ${CONFIG_FILE}`);
  }

  // Always run initDb — it's idempotent, uses CREATE TABLE IF NOT EXISTS.
  initDb();
  if (!hadDb) {
    console.log(`✓ Created SQLite DB at ${DB_FILE}`);
  } else {
    console.log(`• DB already exists at ${DB_FILE}`);
  }

  // Seed default skills + pipelines (idempotent — skips existing files)
  seedDefaults();

  if (hadConfig && hadDb) {
    console.log("Nothing to do — run `auto-coder config` to view current setup.");
    return;
  }

  console.log();
  console.log("Next steps:");
  console.log("  auto-coder repo add <name> <path>    # register a repo");
  console.log("  auto-coder sync <name>               # index it");
  console.log('  auto-coder ask "<question>"          # ask questions');
}
