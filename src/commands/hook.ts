import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/loader.js";

/**
 * Git hook installer.
 *
 * Writes a post-commit hook into .git/hooks that runs
 * `autocode sync <name> --quiet` in the background after every commit.
 *
 * The hook uses a marker comment so we can safely detect + remove
 * our own hook without clobbering any user-authored hooks that
 * might already be there.
 */

const HOOK_MARKER = "# AUTO-CODER-HOOK-V1";

function buildHookScript(repoName: string, binaryPath: string): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by autocode. Syncs this repo's knowledge base after
# each commit. The trailing & runs sync in the background so your
# commit isn't blocked.
#
# To remove this hook: autocode hook uninstall ${repoName}

"${binaryPath}" sync ${repoName} --quiet > /dev/null 2>&1 &
`;
}

/**
 * Resolve the absolute path to the autocode binary so the hook
 * works regardless of the user's PATH at commit time.
 */
function resolveBinaryPath(): string {
  // process.argv[1] is typically the script path Node was invoked with
  // — either ./bin/autocode or the global symlink target.
  const argv = process.argv[1];
  if (argv && fs.existsSync(argv)) {
    return path.resolve(argv);
  }
  // Fallback — assume it's on PATH
  return "autocode";
}

export async function hookInstallCommand(name: string): Promise<void> {
  const config = loadConfig();
  const repo = config.repos.find((r) => r.name === name);
  if (!repo) {
    console.error(`No repo named "${name}" is registered.`);
    console.error("Run `autocode repo list` to see registered repos.");
    process.exit(1);
  }

  const hooksDir = path.join(repo.path, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    console.error(`Not a git repo (no .git/hooks): ${repo.path}`);
    process.exit(1);
  }

  const hookPath = path.join(hooksDir, "post-commit");

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8");
    if (existing.includes(HOOK_MARKER)) {
      console.log(`• Hook already installed at ${hookPath}`);
      console.log("  (nothing to do — re-run with `hook uninstall` first if you want to refresh)");
      return;
    }
    console.error(`✗ post-commit hook already exists at ${hookPath}`);
    console.error("  It was not installed by autocode, so I won't overwrite it.");
    console.error("  Remove it manually or append our sync line yourself:");
    console.error();
    console.error(`  "${resolveBinaryPath()}" sync ${name} --quiet > /dev/null 2>&1 &`);
    process.exit(1);
  }

  const binaryPath = resolveBinaryPath();
  const script = buildHookScript(name, binaryPath);
  fs.writeFileSync(hookPath, script, "utf-8");
  fs.chmodSync(hookPath, 0o755);

  console.log(`✓ Installed post-commit hook at ${hookPath}`);
  console.log(`  Every commit in ${repo.path} will trigger:`);
  console.log(`    autocode sync ${name} --quiet`);
  console.log();
  console.log("To remove: autocode hook uninstall " + name);
}

export async function hookUninstallCommand(name: string): Promise<void> {
  const config = loadConfig();
  const repo = config.repos.find((r) => r.name === name);
  if (!repo) {
    console.error(`No repo named "${name}" is registered.`);
    process.exit(1);
  }

  const hookPath = path.join(repo.path, ".git", "hooks", "post-commit");
  if (!fs.existsSync(hookPath)) {
    console.log(`No post-commit hook at ${hookPath} — nothing to remove.`);
    return;
  }

  const existing = fs.readFileSync(hookPath, "utf-8");
  if (!existing.includes(HOOK_MARKER)) {
    console.error(`✗ post-commit hook at ${hookPath} was not installed by autocode.`);
    console.error("  Refusing to delete a hook I don't own. Remove it manually if needed.");
    process.exit(1);
  }

  fs.unlinkSync(hookPath);
  console.log(`✓ Removed autocode hook from ${hookPath}`);
}

export async function hookListCommand(): Promise<void> {
  const config = loadConfig();
  if (config.repos.length === 0) {
    console.log("No repos registered.");
    return;
  }

  console.log("Hook status for registered repos:\n");
  const nameWidth = Math.max(...config.repos.map((r) => r.name.length), 10);

  for (const repo of config.repos) {
    const hookPath = path.join(repo.path, ".git", "hooks", "post-commit");
    let status: string;

    if (!fs.existsSync(hookPath)) {
      status = "not installed";
    } else {
      const content = fs.readFileSync(hookPath, "utf-8");
      status = content.includes(HOOK_MARKER) ? "✓ installed" : "⚠ foreign hook";
    }

    console.log(`  ${repo.name.padEnd(nameWidth + 2)}${status}`);
  }
}
