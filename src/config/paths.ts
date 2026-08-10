import path from "node:path";
import os from "node:os";

export const CONFIG_DIR = path.join(os.homedir(), ".autocode");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
export const DB_FILE = path.join(CONFIG_DIR, "data.db");
