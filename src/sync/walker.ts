import fs from "node:fs";
import path from "node:path";
import simpleGit, { SimpleGit } from "simple-git";

export type FileCategory =
  | "readme"
  | "markdown"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "package_manifest"
  | "cargo_manifest"
  | "python_manifest"
  | "config"
  | "test"
  | "other";

export interface WalkedFile {
  /** Path relative to the repo root */
  relativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  category: FileCategory;
  bytes: number;
}

const MAX_FILE_BYTES = 1 * 1024 * 1024; // skip files larger than 1MB

/**
 * Classify a file by its path + extension.
 * Used to pick an extraction strategy in the next stage.
 */
export function classifyFile(relativePath: string): FileCategory {
  const base = path.basename(relativePath).toLowerCase();
  const ext = path.extname(relativePath).toLowerCase();
  const parts = relativePath.toLowerCase().split(path.sep);

  if (base === "readme.md" || base === "readme" || base === "readme.txt") return "readme";
  if (base === "package.json") return "package_manifest";
  if (base === "cargo.toml") return "cargo_manifest";
  if (base === "pyproject.toml" || base === "setup.py") return "python_manifest";

  // Tests go into their own bucket so we can index them with lower weight later
  if (parts.some((p) => p === "test" || p === "tests" || p === "__tests__")) return "test";
  if (base.endsWith(".test.ts") || base.endsWith(".test.js") || base.endsWith(".spec.ts")) return "test";

  if (ext === ".md" || ext === ".mdx") return "markdown";
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "typescript";
  if (ext === ".py") return "python";
  if (ext === ".rs") return "rust";
  if (ext === ".go") return "go";

  if ([".yaml", ".yml", ".toml", ".json"].includes(ext)) return "config";

  return "other";
}

/**
 * List every tracked file in the repo, using `git ls-files` so we
 * automatically respect `.gitignore` without re-implementing its parser.
 *
 * Filters out:
 *  - binary files (crude heuristic)
 *  - files larger than MAX_FILE_BYTES
 *  - `other` category files (we can't index them)
 */
export async function walkRepo(repoPath: string): Promise<WalkedFile[]> {
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(`Not a git repo: ${repoPath}`);
  }

  const git: SimpleGit = simpleGit(repoPath);
  const raw = await git.raw(["ls-files"]);
  const relativePaths = raw
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: WalkedFile[] = [];

  for (const rel of relativePaths) {
    const abs = path.join(repoPath, rel);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue; // file listed by git but not on disk (rare)
    }

    if (!stat.isFile()) continue;
    if (stat.size > MAX_FILE_BYTES) continue;

    const category = classifyFile(rel);
    if (category === "other") continue;

    out.push({
      relativePath: rel,
      absolutePath: abs,
      category,
      bytes: stat.size,
    });
  }

  return out;
}

/**
 * Get the current HEAD commit hash of a repo.
 */
export async function getHeadCommit(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Get files changed between two commits (diff-based sync).
 * Returns { added, modified, deleted, renamed } — all paths relative to
 * the repo root.
 */
export interface ChangedFiles {
  added: string[];
  modified: string[];
  deleted: string[];
  /** [old, new] pairs for renames */
  renamed: Array<[string, string]>;
}

export async function getChangedFiles(
  repoPath: string,
  fromCommit: string,
  toCommit: string = "HEAD",
): Promise<ChangedFiles> {
  const git = simpleGit(repoPath);
  const raw = await git.raw([
    "diff",
    "--name-status",
    "-M", // detect renames
    fromCommit,
    toCommit,
  ]);

  const result: ChangedFiles = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    if (!status) continue;

    if (status === "A") {
      if (parts[1]) result.added.push(parts[1]);
    } else if (status === "M") {
      if (parts[1]) result.modified.push(parts[1]);
    } else if (status === "D") {
      if (parts[1]) result.deleted.push(parts[1]);
    } else if (status.startsWith("R") && parts[1] && parts[2]) {
      result.renamed.push([parts[1], parts[2]]);
    }
  }

  return result;
}
