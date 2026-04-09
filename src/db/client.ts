import Database from "better-sqlite3";
import fs from "node:fs";
import { CONFIG_DIR, DB_FILE } from "../config/paths.js";

let _db: Database.Database | null = null;

/**
 * Open (or return) the singleton SQLite connection.
 *
 * Creates the config dir if it doesn't exist so `init` and `sync` can
 * both call this freely.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  _db = new Database(DB_FILE);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("synchronous = NORMAL");

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function dbExists(): boolean {
  return fs.existsSync(DB_FILE);
}
