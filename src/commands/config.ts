import fs from "node:fs";
import { configExists } from "../config/loader.js";
import { CONFIG_FILE, DB_FILE } from "../config/paths.js";
import { dbExists } from "../db/client.js";
import { getDbStats, initDb } from "../db/init.js";

export async function configCommand(): Promise<void> {
  if (!configExists()) {
    console.error(`No config found at ${CONFIG_FILE}`);
    console.error("Run `auto-coder init` first.");
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  console.log(`# Config: ${CONFIG_FILE}`);
  console.log();
  console.log(raw.trimEnd());
  console.log();

  // DB stats summary
  console.log(`# Database: ${DB_FILE}`);
  if (!dbExists()) {
    console.log("  (not created yet — run `auto-coder init`)");
    return;
  }
  initDb(); // idempotent; makes sure schema is current
  const stats = getDbStats();
  console.log(`  schema version:  ${stats.schema_version}`);
  console.log(`  synced repos:    ${stats.repo_count}`);
  console.log(`  documents:       ${stats.document_count}`);
}
