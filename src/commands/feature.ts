import fs from "node:fs";
import path from "node:path";
import { Config, RepoConfig } from "../config/types.js";
import { loadConfig } from "../config/loader.js";
import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  FeatureRow,
  FeatureStatus,
} from "../db/features.js";
import { buildFeatureContext } from "../orchestrator/feature-context.js";
import {
  buildImplementationPrompt,
  buildPlanningPrompt,
  buildReworkPrompt,
} from "../orchestrator/prompts.js";
import {
  spawnClaudeCli,
  defaultEventPrinter,
} from "../orchestrator/spawner.js";
import {
  getDefaultBranch,
  hasUncommittedChanges,
  createAndCheckoutBranch,
  stageAll,
  commitAll,
  pushBranch,
  createPullRequest,
  isGhAvailable,
} from "../git/pr.js";

/* ───── Shared types + helpers ───────────────────────────────────── */

interface AgentImplementResult {
  status: "completed" | "failed";
  summary?: string;
  files_modified?: string[];
  files_created?: string[];
  tests_run?: "pass" | "fail" | "none";
  impact_report?: string;
  notes?: string;
}

interface AgentPlanResult {
  status: "completed" | "failed";
  plan_file?: string;
  summary?: string;
  notes?: string;
}

function resolveRepo(config: Config, repoName: string | undefined): RepoConfig {
  const name = repoName ?? config.repos[0]?.name;
  if (!name) {
    console.error("No repo specified and no repos registered.");
    console.error("Run `auto-coder repo add <name> <path>` first.");
    process.exit(1);
  }
  const repo = config.repos.find((r) => r.name === name);
  if (!repo) {
    console.error(`No repo named "${name}" is registered.`);
    process.exit(1);
  }
  return repo;
}

function ensureCleanWorktree(repoPath: string): void {
  if (hasUncommittedChanges(repoPath)) {
    console.error(`✗ ${repoPath} has uncommitted changes.`);
    console.error("  Commit or stash them before running this command.");
    process.exit(1);
  }
}

/* ───── feature create ────────────────────────────────────────────── */

export interface FeatureCreateOptions {
  title: string;
  description: string;
  repo?: string;
  noPr?: boolean;
  /** Commander sets this from `--plan` / `--no-plan`. Default is true (plan-first). */
  plan?: boolean;
}

/**
 * Default flow: plan-first.
 *   1. Create feature row (pending)
 *   2. Assemble context
 *   3. Spawn Claude in PLANNING mode — writes plan markdown, no code
 *   4. Read and save the plan
 *   5. Mark plan_ready and exit, telling the user how to proceed
 *
 * With --no-plan: same behavior as F5 — straight to implementation.
 */
export async function featureCreateCommand(
  opts: FeatureCreateOptions,
): Promise<void> {
  const config = loadConfig();
  const repo = resolveRepo(config, opts.repo);
  ensureCleanWorktree(repo.path);

  // --no-pr path requires --no-plan to make sense: planning produces no
  // branch/PR, so --no-pr has nothing to skip. We allow the combination
  // but it only affects the implement step.
  if (opts.plan !== false && !isGhAvailable() && !opts.noPr) {
    console.error("✗ GitHub CLI (`gh`) is not installed or not on PATH.");
    console.error("  Install it from https://cli.github.com/ or re-run with --no-pr");
    process.exit(1);
  }

  console.log(`Creating feature: ${opts.title}`);
  const feature = createFeature(repo.name, opts.title, opts.description);
  console.log(`  Feature ID: ${feature.id}`);
  console.log(`  Status: ${feature.status}`);

  try {
    if (opts.plan === false) {
      // --no-plan: straight to implementation (old F5 behavior)
      await runImplementation(config, repo, feature, { noPr: opts.noPr });
      return;
    }

    // Default: plan-first
    await runPlanning(config, repo, feature);

    console.log();
    console.log(`Next steps:`);
    console.log(`  auto-coder feature plan ${feature.id}`);
    console.log(`  auto-coder feature implement ${feature.id}`);
  } catch (err) {
    updateFeature(feature.id, {
      status: "failed",
      error_message: (err as Error).message,
    });
    console.error();
    console.error(`✗ Feature ${feature.id} failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

/* ───── feature implement ────────────────────────────────────────── */

export interface FeatureImplementOptions {
  repo?: string;
  noPr?: boolean;
}

/**
 * Second phase of the plan-first flow. Loads a feature from the DB
 * (must be in plan_ready state), then runs the implementation with
 * the saved plan injected into the prompt.
 */
export async function featureImplementCommand(
  id: string,
  opts: FeatureImplementOptions,
): Promise<void> {
  const config = loadConfig();
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }
  if (feature.status !== "plan_ready" && feature.status !== "pending") {
    console.error(`Feature is in state "${feature.status}" — expected "plan_ready"`);
    console.error("  Run `auto-coder feature plan " + id + "` to see its current plan.");
    process.exit(1);
  }
  if (feature.status === "plan_ready" && !feature.implementation_plan) {
    console.error("✗ Feature is plan_ready but has no saved plan. Something is inconsistent.");
    process.exit(1);
  }

  const repo = resolveRepo(config, opts.repo ?? feature.repo);
  ensureCleanWorktree(repo.path);

  if (!opts.noPr && !isGhAvailable()) {
    console.error("✗ GitHub CLI (`gh`) is not installed.");
    console.error("  Install it or re-run with --no-pr");
    process.exit(1);
  }

  try {
    await runImplementation(config, repo, feature, { noPr: opts.noPr });
  } catch (err) {
    updateFeature(feature.id, {
      status: "failed",
      error_message: (err as Error).message,
    });
    console.error();
    console.error(`✗ Feature ${feature.id} failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

/* ───── feature plan (view) ──────────────────────────────────────── */

export async function featurePlanCommand(id: string): Promise<void> {
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }
  if (!feature.implementation_plan) {
    console.error(`Feature ${id} has no saved plan (status: ${feature.status})`);
    console.error("  Run `auto-coder feature create` to start with a plan,");
    console.error("  or `auto-coder feature status ${id}` to see its current state.");
    process.exit(1);
  }
  console.log(`# Plan for feature ${id} — ${feature.title}`);
  console.log();
  console.log(feature.implementation_plan);
}

/* ───── feature test-context ──────────────────────────────────────── */

export interface FeatureTestContextOptions {
  title: string;
  description: string;
  repo?: string;
}

/**
 * Preview the exact prompt that would be sent to Claude, without
 * creating a feature row or spawning anything. Useful for debugging
 * context quality before committing to a real feature.
 */
export async function featureTestContextCommand(
  opts: FeatureTestContextOptions,
): Promise<void> {
  const config = loadConfig();
  const repo = resolveRepo(config, opts.repo);

  console.log(`Previewing context for: ${opts.title}`);
  console.log(`  Repo: ${repo.name} (${repo.path})`);
  console.log();

  const context = await buildFeatureContext(
    config,
    repo,
    "test-preview",
    opts.description,
  );

  console.log(`Retrieved ${context.sources.length} documents from the knowledge base.`);
  console.log();

  const prompt = buildImplementationPrompt({
    featureId: "test-preview",
    title: opts.title,
    description: opts.description,
    context,
  });

  console.log("━".repeat(70));
  console.log(prompt);
  console.log("━".repeat(70));
  console.log();
  console.log(`Total prompt length: ${prompt.length} chars`);
  console.log(`Estimated tokens: ~${Math.ceil(prompt.length / 4)}`);
  console.log();
  console.log("This is what Claude would receive. No feature was created, no Claude was spawned.");
}

/* ───── feature rework ────────────────────────────────────────────── */

export interface FeatureReworkOptions {
  instructions: string;
  repo?: string;
}

/**
 * Rework a feature based on reviewer feedback.
 *
 * Must be in `ready_for_review` status. Checks out the feature branch,
 * spawns Claude with the rework prompt, stages + commits + pushes.
 * The PR automatically updates on GitHub because we push to the same branch.
 */
export async function featureReworkCommand(
  id: string,
  opts: FeatureReworkOptions,
): Promise<void> {
  const config = loadConfig();
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }
  if (feature.status !== "ready_for_review") {
    console.error(`Feature is in state "${feature.status}" — expected "ready_for_review"`);
    process.exit(1);
  }
  if (!feature.branch_name) {
    console.error("Feature has no branch_name — can't rework without a branch.");
    process.exit(1);
  }

  const repo = resolveRepo(config, opts.repo ?? feature.repo);

  try {
    // Checkout the existing feature branch
    const { execSync } = await import("node:child_process");
    execSync(`git checkout ${feature.branch_name}`, {
      cwd: repo.path,
      stdio: "pipe",
    });

    console.log(`Reworking feature ${feature.id} on branch ${feature.branch_name}`);
    console.log(`  Instructions: ${opts.instructions}`);

    // Assemble context
    console.log("  Assembling context...");
    const context = await buildFeatureContext(
      config,
      repo,
      feature.id,
      feature.description,
    );
    console.log(`  ✓ Got ${context.sources.length} relevant documents`);

    // Update status
    updateFeature(feature.id, { status: "implementing" as FeatureStatus });

    // Build rework prompt
    const prompt = buildReworkPrompt({
      featureId: feature.id,
      title: feature.title,
      description: feature.description,
      context,
      plan: feature.implementation_plan ?? undefined,
      reworkInstructions: opts.instructions,
      reworkHistory: feature.rework_history,
    });

    console.log("  Spawning Claude CLI for rework...");
    console.log();
    const spawnResult = await spawnClaudeCli({
      prompt,
      workingDir: repo.path,
      onEvent: defaultEventPrinter,
    });
    console.log();

    if (spawnResult.exitCode !== 0) {
      throw new Error(`Claude CLI exited with code ${spawnResult.exitCode}`);
    }
    console.log(
      `  ✓ Claude finished — ${spawnResult.eventCount} events in ${(spawnResult.elapsedMs / 1000).toFixed(1)}s`,
    );

    // Read result file
    const resultPath = `${repo.path}/.agent/results/result-${feature.id}.json`;
    const fs = await import("node:fs");
    if (!fs.existsSync(resultPath)) {
      throw new Error("Claude did not write the result file.");
    }
    const agentResult = JSON.parse(
      fs.readFileSync(resultPath, "utf-8"),
    ) as AgentImplementResult;

    if (agentResult.status === "failed") {
      updateFeature(feature.id, {
        status: "failed",
        error_message: agentResult.notes ?? "Rework failed",
      });
      console.error(`✗ Rework failed: ${agentResult.notes ?? "(no notes)"}`);
      process.exit(1);
    }

    // Stage + commit + push (same branch — PR updates automatically)
    console.log("  Staging and committing rework...");
    stageAll(repo.path);
    if (!hasUncommittedChanges(repo.path)) {
      console.log("  (no changes — rework may have been a no-op)");
    } else {
      const { execSync: exec2 } = await import("node:child_process");
      exec2(
        `git commit -m "Rework: ${opts.instructions.slice(0, 60)}\n\n[feature: ${feature.id}]"`,
        { cwd: repo.path, stdio: "pipe" },
      );
      pushBranch(repo.path, feature.branch_name);
      console.log("  ✓ Pushed rework to existing branch");
    }

    // Append to rework history and update status
    const newHistory = [
      ...feature.rework_history,
      { instructions: opts.instructions, timestamp: new Date().toISOString() },
    ];
    updateFeature(feature.id, {
      status: "ready_for_review" as FeatureStatus,
      rework_history: newHistory,
      files_modified: agentResult.files_modified ?? feature.files_modified,
      files_created: agentResult.files_created ?? feature.files_created,
      impact_report: agentResult.impact_report ?? feature.impact_report,
      test_results: agentResult.tests_run ?? feature.test_results,
    });

    console.log();
    console.log(`✓ Rework applied — feature ${feature.id} back to ready_for_review`);
    if (agentResult.summary) console.log(`  ${agentResult.summary}`);
    if (feature.pr_url) console.log(`  PR: ${feature.pr_url} (updated)`);
    console.log(`  Rework history: ${newHistory.length} round(s)`);
  } catch (err) {
    updateFeature(feature.id, {
      status: "failed",
      error_message: (err as Error).message,
    });
    console.error();
    console.error(`✗ Rework failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

/* ───── runPlanning (shared helper) ──────────────────────────────── */

async function runPlanning(
  config: Config,
  repo: RepoConfig,
  feature: FeatureRow,
): Promise<void> {
  console.log("  Assembling context from graph + vectors...");
  const context = await buildFeatureContext(
    config,
    repo,
    feature.id,
    feature.description,
  );
  console.log(`  ✓ Got ${context.sources.length} relevant documents`);

  updateFeature(feature.id, { status: "planning" as FeatureStatus });

  const prompt = buildPlanningPrompt({
    featureId: feature.id,
    title: feature.title,
    description: feature.description,
    context,
  });

  console.log("  Spawning Claude CLI in planning mode...");
  console.log();
  const spawnResult = await spawnClaudeCli({
    prompt,
    workingDir: repo.path,
    onEvent: defaultEventPrinter,
  });
  console.log();

  if (spawnResult.exitCode !== 0) {
    throw new Error(
      `Claude CLI exited with code ${spawnResult.exitCode}. stderr: ${spawnResult.stderr.slice(0, 500)}`,
    );
  }
  console.log(
    `  ✓ Claude finished — ${spawnResult.eventCount} events in ${(spawnResult.elapsedMs / 1000).toFixed(1)}s`,
  );

  // Read the plan file
  const planFilePath = path.join(repo.path, ".agent/plans", `plan-${feature.id}.md`);
  if (!fs.existsSync(planFilePath)) {
    throw new Error(`Claude did not write the plan file at ${planFilePath}.`);
  }
  const planMarkdown = fs.readFileSync(planFilePath, "utf-8");

  // Read the result file
  const resultPath = path.join(repo.path, ".agent/results", `result-${feature.id}.json`);
  let agentResult: AgentPlanResult | null = null;
  if (fs.existsSync(resultPath)) {
    try {
      agentResult = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AgentPlanResult;
    } catch {
      // Plan file exists; result file is broken — continue with plan only
    }
  }

  if (agentResult?.status === "failed") {
    updateFeature(feature.id, {
      status: "failed",
      error_message: agentResult.notes ?? "Planning failed with no notes",
    });
    throw new Error(agentResult.notes ?? "Planning failed with no notes");
  }

  // Save the plan to SQLite and flip status
  updateFeature(feature.id, {
    status: "plan_ready",
    implementation_plan: planMarkdown,
  });

  console.log();
  console.log("━".repeat(70));
  console.log(planMarkdown.trim());
  console.log("━".repeat(70));
  console.log();
  if (agentResult?.summary) console.log(`  ${agentResult.summary}`);
  console.log(`✓ Plan ready for feature ${feature.id}`);
}

/* ───── runImplementation (shared helper) ────────────────────────── */

async function runImplementation(
  config: Config,
  repo: RepoConfig,
  feature: FeatureRow,
  opts: { noPr?: boolean },
): Promise<void> {
  console.log("  Assembling context from graph + vectors...");
  const context = await buildFeatureContext(
    config,
    repo,
    feature.id,
    feature.description,
  );
  console.log(`  ✓ Got ${context.sources.length} relevant documents`);

  const baseBranch = getDefaultBranch(repo.path);
  const branchName = feature.branch_name ?? context.branchName;
  console.log(`  Creating branch ${branchName} off ${baseBranch}...`);
  createAndCheckoutBranch(repo.path, branchName, baseBranch);

  updateFeature(feature.id, {
    status: "implementing" as FeatureStatus,
    branch_name: branchName,
  });

  const prompt = buildImplementationPrompt({
    featureId: feature.id,
    title: feature.title,
    description: feature.description,
    context,
    plan: feature.implementation_plan ?? undefined,
  });

  console.log("  Spawning Claude CLI to implement the feature...");
  console.log();
  const spawnResult = await spawnClaudeCli({
    prompt,
    workingDir: repo.path,
    onEvent: defaultEventPrinter,
  });
  console.log();

  if (spawnResult.exitCode !== 0) {
    throw new Error(
      `Claude CLI exited with code ${spawnResult.exitCode}. stderr: ${spawnResult.stderr.slice(0, 500)}`,
    );
  }
  console.log(
    `  ✓ Claude finished — ${spawnResult.eventCount} events in ${(spawnResult.elapsedMs / 1000).toFixed(1)}s`,
  );

  const resultPath = path.join(repo.path, ".agent/results", `result-${feature.id}.json`);
  if (!fs.existsSync(resultPath)) {
    throw new Error(
      `Claude did not write the result file at ${resultPath}. Something went wrong.`,
    );
  }
  const agentResult = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AgentImplementResult;

  if (agentResult.status === "failed") {
    updateFeature(feature.id, {
      status: "failed",
      error_message: agentResult.notes ?? "Claude reported failure with no notes",
      impact_report: agentResult.impact_report ?? null,
    });
    console.error(`✗ Feature marked as failed: ${agentResult.notes ?? "(no notes)"}`);
    process.exit(1);
  }

  console.log("  Staging and committing changes...");
  stageAll(repo.path);
  if (!hasUncommittedChanges(repo.path)) {
    throw new Error("Claude claimed success but made no file changes — aborting.");
  }
  commitAll(
    repo.path,
    `${feature.title}\n\n${agentResult.summary ?? feature.description}\n\n[feature: ${feature.id}]`,
  );
  console.log("  Pushing branch to origin...");
  pushBranch(repo.path, branchName);

  let prUrl: string | null = null;
  let prNumber: number | null = null;
  if (!opts.noPr) {
    console.log("  Creating pull request...");
    const body = buildPrBody(feature.id, feature, agentResult);
    const pr = createPullRequest(repo.path, feature.title, body, baseBranch);
    prUrl = pr.url;
    prNumber = pr.number;
    console.log(`  ✓ PR created: ${prUrl}`);
  }

  updateFeature(feature.id, {
    status: "ready_for_review" as FeatureStatus,
    files_modified: agentResult.files_modified ?? [],
    files_created: agentResult.files_created ?? [],
    impact_report: agentResult.impact_report ?? null,
    test_results: agentResult.tests_run ?? null,
    pr_url: prUrl,
    pr_number: prNumber,
  });

  console.log();
  console.log(`✓ Feature ${feature.id} ready for review`);
  if (agentResult.summary) console.log(`  ${agentResult.summary}`);
  if (prUrl) console.log(`  PR: ${prUrl}`);
  console.log();
  console.log("Next steps:");
  console.log(`  auto-coder feature status ${feature.id}`);
  console.log(`  auto-coder feature approve ${feature.id}    (after merging the PR)`);
}

function buildPrBody(
  featureId: string,
  feature: FeatureRow,
  result: AgentImplementResult,
): string {
  const lines: string[] = [];
  lines.push(`## Feature: ${feature.title}`);
  lines.push("");
  lines.push(feature.description);
  lines.push("");
  if (result.summary) {
    lines.push("### Summary");
    lines.push(result.summary);
    lines.push("");
  }
  if (feature.implementation_plan) {
    lines.push("### Plan");
    lines.push(feature.implementation_plan);
    lines.push("");
  }
  if (result.impact_report) {
    lines.push("### Impact");
    lines.push(result.impact_report);
    lines.push("");
  }
  if (result.files_modified?.length || result.files_created?.length) {
    lines.push("### Files");
    for (const f of result.files_created ?? []) lines.push(`- \`${f}\` (new)`);
    for (const f of result.files_modified ?? []) lines.push(`- \`${f}\` (modified)`);
    lines.push("");
  }
  if (result.tests_run) {
    lines.push(`**Tests**: ${result.tests_run}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Generated by auto-coder. Feature ID: \`${featureId}\`_`);
  return lines.join("\n");
}

/* ───── feature list ──────────────────────────────────────────── */

export async function featureListCommand(opts: { repo?: string }): Promise<void> {
  const features = listFeatures(opts.repo);
  if (features.length === 0) {
    console.log("No features yet.");
    console.log('Create one: auto-coder feature create -t "Title" -d "Description"');
    return;
  }

  const idWidth = 20;
  const statusWidth = 20;
  const titleWidth = 40;

  console.log(`${"ID".padEnd(idWidth)}${"STATUS".padEnd(statusWidth)}${"TITLE".padEnd(titleWidth)}REPO`);
  console.log(`${"─".repeat(idWidth + statusWidth + titleWidth + 20)}`);
  for (const f of features) {
    const title = f.title.length > titleWidth - 2 ? f.title.slice(0, titleWidth - 5) + "..." : f.title;
    console.log(
      `${f.id.padEnd(idWidth)}${f.status.padEnd(statusWidth)}${title.padEnd(titleWidth)}${f.repo}`,
    );
  }
}

/* ───── feature status ────────────────────────────────────────── */

export async function featureStatusCommand(id: string): Promise<void> {
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }

  console.log(`# Feature ${feature.id}`);
  console.log();
  console.log(`Title:       ${feature.title}`);
  console.log(`Repo:        ${feature.repo}`);
  console.log(`Status:      ${feature.status}`);
  console.log(`Created:     ${feature.created_at}`);
  console.log(`Updated:     ${feature.updated_at}`);
  if (feature.branch_name) console.log(`Branch:      ${feature.branch_name}`);
  if (feature.pr_url) console.log(`PR:          ${feature.pr_url}`);
  if (feature.test_results) console.log(`Tests:       ${feature.test_results}`);
  console.log();
  console.log(`## Description`);
  console.log(feature.description);
  if (feature.implementation_plan) {
    console.log();
    console.log(`## Plan`);
    console.log(feature.implementation_plan);
  }
  if (feature.impact_report) {
    console.log();
    console.log(`## Impact`);
    console.log(feature.impact_report);
  }
  if (feature.files_created?.length || feature.files_modified?.length) {
    console.log();
    console.log(`## Files`);
    for (const f of feature.files_created ?? []) console.log(`  + ${f}`);
    for (const f of feature.files_modified ?? []) console.log(`  ~ ${f}`);
  }
  if (feature.error_message) {
    console.log();
    console.log(`## Error`);
    console.log(feature.error_message);
  }
}

/* ───── feature approve ──────────────────────────────────────── */

export async function featureApproveCommand(
  id: string,
  opts: { repo?: string },
): Promise<void> {
  const config = loadConfig();
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }
  if (feature.status !== "ready_for_review") {
    console.error(`Feature is in state "${feature.status}", not "ready_for_review"`);
    process.exit(1);
  }

  updateFeature(id, { status: "approved" as FeatureStatus });
  console.log(`✓ Feature ${id} approved`);

  // Run knowledge sync from the diff
  const repo = resolveRepo(config, opts.repo ?? feature.repo);
  try {
    const { syncFeatureApproval } = await import("../sync/feature-sync.js");
    await syncFeatureApproval(config, repo, feature);
  } catch (err) {
    console.warn(`  ⚠ Knowledge sync failed: ${(err as Error).message}`);
    console.warn("  (The feature is still approved — run `auto-coder sync` manually to recover.)");
  }
}
