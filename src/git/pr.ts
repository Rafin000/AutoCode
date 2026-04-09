import { execSync, spawnSync } from "node:child_process";

/**
 * Thin git + gh wrappers for the feature command.
 *
 * These are deliberately synchronous and use child_process directly
 * instead of a library. The operations are simple one-shot git
 * commands and failure modes (non-zero exit) surface as thrown
 * errors with the stderr attached for debugging.
 */

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function runGh(args: string[], cwd: string): string {
  const result = spawnSync("gh", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

export function getDefaultBranch(cwd: string): string {
  try {
    const ref = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback — guess main, then master
    for (const branch of ["main", "master"]) {
      try {
        runGit(["rev-parse", "--verify", branch], cwd);
        return branch;
      } catch {
        // try next
      }
    }
    throw new Error("Could not determine default branch (no main or master)");
  }
}

export function currentBranch(cwd: string): string {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export function hasUncommittedChanges(cwd: string): boolean {
  const out = runGit(["status", "--porcelain"], cwd);
  return out.length > 0;
}

export function createAndCheckoutBranch(
  cwd: string,
  branchName: string,
  fromBranch: string,
): void {
  runGit(["checkout", "-b", branchName, fromBranch], cwd);
}

export function stageAll(cwd: string): void {
  runGit(["add", "-A"], cwd);
}

export function commitAll(cwd: string, message: string): void {
  // Use -m to avoid opening an editor. Multi-line messages work
  // because spawnSync doesn't invoke a shell.
  runGit(["commit", "-m", message], cwd);
}

export function pushBranch(cwd: string, branchName: string): void {
  runGit(["push", "-u", "origin", branchName], cwd);
}

export interface CreatedPR {
  url: string;
  number: number;
}

/**
 * Create a pull request via `gh pr create`.
 * Returns the URL printed by gh and parses the PR number from it.
 */
export function createPullRequest(
  cwd: string,
  title: string,
  body: string,
  baseBranch: string,
): CreatedPR {
  const url = runGh(
    ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    cwd,
  );
  // URL format: https://github.com/owner/repo/pull/123
  const match = /\/pull\/(\d+)(?:\b|$)/.exec(url);
  const number = match && match[1] ? parseInt(match[1], 10) : 0;
  return { url, number };
}

export function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
