import { loadConfig } from "../config/loader.js";
import { syncRepo, SyncOptions, SyncReport } from "../sync/processor.js";

export interface SyncCliOptions {
  all?: boolean;
  quiet?: boolean;
  full?: boolean;
}

export async function syncCommand(
  name: string | undefined,
  opts: SyncCliOptions,
): Promise<void> {
  const config = loadConfig();

  const syncOpts: SyncOptions = {
    quiet: opts.quiet,
    full: opts.full,
  };

  // --all overrides positional name
  if (opts.all) {
    if (config.repos.length === 0) {
      console.error("No repos registered. Use `auto-coder repo add <name> <path>` first.");
      process.exit(1);
    }
    console.log(`Syncing ${config.repos.length} repo(s)...\n`);
    const reports: SyncReport[] = [];
    for (const repo of config.repos) {
      try {
        const report = await syncRepo(config, repo, syncOpts);
        reports.push(report);
      } catch (err) {
        console.error(`✗ Failed to sync "${repo.name}": ${(err as Error).message}`);
      }
      console.log();
    }
    printSummary(reports);
    return;
  }

  if (!name) {
    console.error("Usage: auto-coder sync <name>  (or --all)");
    process.exit(1);
  }

  const repo = config.repos.find((r) => r.name === name);
  if (!repo) {
    console.error(`No repo named "${name}" is registered.`);
    console.error("Run `auto-coder repo list` to see registered repos.");
    process.exit(1);
  }

  try {
    const report = await syncRepo(config, repo, syncOpts);
    if (!opts.quiet) {
      console.log();
      printSummary([report]);
    }
  } catch (err) {
    console.error(`✗ Sync failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

function printSummary(reports: SyncReport[]): void {
  const totalDocs = reports.reduce((s, r) => s + r.documents_added, 0);
  const totalFiles = reports.reduce((s, r) => s + r.files_processed, 0);
  const totalMs = reports.reduce((s, r) => s + r.elapsed_ms, 0);

  console.log("──────── Summary ────────");
  for (const r of reports) {
    console.log(
      `  ${r.repo.padEnd(24)} ${r.mode.padEnd(12)}${r.documents_added.toString().padStart(5)} docs  ${(r.elapsed_ms / 1000).toFixed(1)}s`,
    );
  }
  console.log(`  ${"─".repeat(55)}`);
  console.log(
    `  ${"TOTAL".padEnd(24)} ${"".padEnd(12)}${totalDocs.toString().padStart(5)} docs  ${(totalMs / 1000).toFixed(1)}s  (${totalFiles} files)`,
  );
}
