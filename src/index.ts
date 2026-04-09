#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import {
  repoAddCommand,
  repoListCommand,
  repoRemoveCommand,
} from "./commands/repo.js";
import {
  knowledgeTestGraphCommand,
  knowledgeTestVectorsCommand,
  knowledgeStatsCommand,
} from "./commands/knowledge.js";
import { syncCommand } from "./commands/sync.js";
import {
  hookInstallCommand,
  hookUninstallCommand,
  hookListCommand,
} from "./commands/hook.js";
import { askCommand } from "./commands/ask.js";
import { interviewCommand } from "./commands/interview.js";
import {
  featureCreateCommand,
  featureListCommand,
  featureStatusCommand,
  featureApproveCommand,
} from "./commands/feature.js";
import { getPackageVersion, versionCommand } from "./commands/version.js";
import {
  runExecuteCommand,
  runListCommand,
  runShowCommand,
  runPipelinesCommand,
} from "./commands/run.js";

const program = new Command();

program
  .name("auto-coder")
  .description("Personal AI that knows your code and answers questions grounded in your real work.")
  .version(getPackageVersion());

program
  .command("version")
  .description("Print the auto-coder version and exit")
  .action(versionCommand);

// ─── Setup ──────────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Create ~/.auto-coder/ directory and default config")
  .action(initCommand);

program
  .command("config")
  .description("Show the current config")
  .action(configCommand);

// ─── Repos ──────────────────────────────────────────────────────────────────
const repo = program.command("repo").description("Manage registered repos");

repo
  .command("add <name> <path>")
  .description("Register a repo to be indexed")
  .action(repoAddCommand);

repo
  .command("list")
  .description("List all registered repos")
  .action(repoListCommand);

repo
  .command("remove <name>")
  .description("Remove a repo from the registry")
  .action(repoRemoveCommand);

// ─── Knowledge base diagnostics ─────────────────────────────────────────────
const knowledge = program
  .command("knowledge")
  .description("Inspect and test the knowledge base");

knowledge
  .command("test-graph")
  .description("Smoke-test the Neo4j connection")
  .action(knowledgeTestGraphCommand);

knowledge
  .command("test-vectors")
  .description("Smoke-test Qdrant + the local embedder")
  .action(knowledgeTestVectorsCommand);

knowledge
  .command("stats")
  .description("Show counts across SQLite, Neo4j, and Qdrant")
  .action(knowledgeStatsCommand);

// ─── Sync ───────────────────────────────────────────────────────────────────
program
  .command("sync [name]")
  .description("Sync one repo (or all with --all)")
  .option("--all", "Sync every registered repo")
  .option("--quiet", "Suppress output (used by git hooks)")
  .option("--full", "Force a full re-scan (skip incremental diff)")
  .action(syncCommand);

// ─── Git hooks ──────────────────────────────────────────────────────────────
const hook = program.command("hook").description("Manage git hooks for auto-sync");

hook
  .command("install <name>")
  .description("Install a post-commit hook in the repo")
  .action(hookInstallCommand);

hook
  .command("uninstall <name>")
  .description("Remove the post-commit hook from the repo")
  .action(hookUninstallCommand);

hook
  .command("list")
  .description("Show hook status for every registered repo")
  .action(hookListCommand);

// ─── Workflow engine (pipelines + runs) ─────────────────────────────────────
const run = program
  .command("run")
  .description("Run user-defined pipelines from ~/.auto-coder/pipelines/");

run
  .arguments("[pipeline]")
  .option(
    "-i, --input <kv>",
    "Input as key=value (repeatable)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .action(async (pipeline: string | undefined, opts: { input: string[] }) => {
    if (!pipeline) {
      console.error("Usage: auto-coder run <pipeline> [-i key=value ...]");
      console.error("       auto-coder run list       — show past runs");
      console.error("       auto-coder run pipelines  — show available pipelines");
      process.exit(1);
    }
    await runExecuteCommand(pipeline, opts);
  });

run
  .command("list")
  .description("List past workflow runs")
  .option("-p, --pipeline <name>", "Filter by pipeline name")
  .action(runListCommand);

run
  .command("show <id>")
  .description("Show full details for a single run")
  .action(runShowCommand);

run
  .command("pipelines")
  .description("List every pipeline defined in ~/.auto-coder/pipelines/")
  .action(runPipelinesCommand);

// ─── Feature lifecycle ──────────────────────────────────────────────────────
const feature = program
  .command("feature")
  .description("Create and manage AI-implemented features");

feature
  .command("create")
  .description("Spawn Claude CLI to implement a new feature on a branch + open a PR")
  .requiredOption("-t, --title <title>", "Feature title (short)")
  .requiredOption("-d, --description <desc>", "Feature description (full)")
  .option("-r, --repo <name>", "Target repo (default: first registered repo)")
  .option("--no-pr", "Skip PR creation (just commit and push the branch)")
  .action(featureCreateCommand);

feature
  .command("list")
  .description("List every feature and its status")
  .option("-r, --repo <name>", "Filter by repo")
  .action(featureListCommand);

feature
  .command("status <id>")
  .description("Show full details for a single feature")
  .action(featureStatusCommand);

feature
  .command("approve <id>")
  .description("Mark a merged feature as approved")
  .action(featureApproveCommand);

// ─── Ask / Interview ────────────────────────────────────────────────────────
program
  .command("ask <question>")
  .description("Ask a question about your work")
  .option("-r, --repo <name>", "Limit search to a single registered repo")
  .option("-k, --top-k <n>", "Number of documents to retrieve", "8")
  .action(askCommand);

program
  .command("interview <question>")
  .description("Answer a question in interview format with concrete examples")
  .option("-r, --repo <name>", "Limit to a single registered repo")
  .option("-k, --top-k <n>", "Number of documents to retrieve", "10")
  .action(interviewCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
