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

const program = new Command();

program
  .name("auto-coder")
  .description("Personal AI that knows your code and answers questions grounded in your real work.")
  .version("0.1.0");

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
  .action(async (_name: string | undefined, _opts: { all?: boolean; quiet?: boolean }) => {
    console.log("TODO: sync — Milestone 6");
  });

// ─── Git hooks ──────────────────────────────────────────────────────────────
const hook = program.command("hook").description("Manage git hooks for auto-sync");

hook
  .command("install <name>")
  .description("Install a post-commit hook in the repo")
  .action(async (_name: string) => {
    console.log("TODO: hook install — Milestone 7");
  });

hook
  .command("uninstall <name>")
  .description("Remove the post-commit hook from the repo")
  .action(async (_name: string) => {
    console.log("TODO: hook uninstall — Milestone 7");
  });

// ─── Ask / Interview ────────────────────────────────────────────────────────
program
  .command("ask <question>")
  .description("Ask a question about your work")
  .action(async (_question: string) => {
    console.log("TODO: ask — Milestone 8");
  });

program
  .command("interview <question>")
  .description("Answer a question in interview format with concrete examples")
  .action(async (_question: string) => {
    console.log("TODO: interview — Milestone 8");
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
