import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "auto-coder" && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        // fall through and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate auto-coder package.json");
    }
    dir = parent;
  }
}

export async function versionCommand(): Promise<void> {
  console.log(getPackageVersion());
}
