import { loadConfig } from "../config/loader.js";
import { syncRepo } from "../sync/processor.js";
import { getRepoState } from "../db/queries.js";
import { getHeadCommit } from "../sync/walker.js";

export interface WatchOptions {
  interval?: string;
  repo?: string;
}

/**
 * Periodically checks registered repos for new commits and
 * triggers incremental sync when changes are detected.
 *
 * This is the "poor man's file watcher" — instead of using
 * fswatch or inotify (which are noisy and platform-specific),
 * we just poll `git rev-parse HEAD` on an interval and compare
 * against `last_synced_commit` in SQLite.
 *
 * Designed to run in a terminal tab and be left alone:
 *   autocode watch --interval 30
 *
 * The git post-commit hook (P1.7) is instant but only fires on
 * local commits. Watch catches pulls, merges, rebases, and
 * anything else that moves HEAD.
 */
export async function watchCommand(opts: WatchOptions): Promise<void> {
  const intervalSec = parseInt(opts.interval ?? "60", 10);
  if (isNaN(intervalSec) || intervalSec < 5) {
    console.error("Interval must be a number >= 5 (seconds)");
    process.exit(1);
  }

  const config = loadConfig();
  const repos = opts.repo
    ? config.repos.filter((r) => r.name === opts.repo)
    : config.repos;

  if (repos.length === 0) {
    console.error("No repos to watch.");
    console.error(
      opts.repo
        ? `No repo named "${opts.repo}" is registered.`
        : "Run `autocode repo add <name> <path>` first.",
    );
    process.exit(1);
  }

  console.log(`Watching ${repos.length} repo(s) every ${intervalSec}s`);
  for (const r of repos) {
    console.log(`  • ${r.name} → ${r.path}`);
  }
  console.log();
  console.log("Press Ctrl+C to stop.\n");

  // Initial check immediately
  await checkAll(config, repos);

  // Then poll on interval
  const timer = setInterval(async () => {
    await checkAll(config, repos);
  }, intervalSec * 1000);

  // Keep the process alive until Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nWatch stopped.");
    process.exit(0);
  });

  // Prevent Node from exiting while the interval is alive
  await new Promise(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function
}

async function checkAll(
  config: ReturnType<typeof loadConfig>,
  repos: Array<{ name: string; path: string }>,
): Promise<void> {
  for (const repo of repos) {
    try {
      const head = await getHeadCommit(repo.path);
      const state = getRepoState(repo.name);
      const lastCommit = state?.last_synced_commit;

      if (lastCommit === head) continue; // up to date

      const shortOld = lastCommit ? lastCommit.slice(0, 8) : "(never)";
      const shortNew = head.slice(0, 8);
      console.log(
        `[${new Date().toLocaleTimeString()}] ${repo.name}: HEAD moved (${shortOld} → ${shortNew}), syncing...`,
      );

      const repoCfg = config.repos.find((r) => r.name === repo.name);
      if (!repoCfg) continue;

      await syncRepo(config, repoCfg, { quiet: false });
      console.log();
    } catch (err) {
      console.error(
        `[${new Date().toLocaleTimeString()}] ${repo.name}: check failed — ${(err as Error).message}`,
      );
    }
  }
}
