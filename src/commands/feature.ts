import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/loader.js";
import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  FeatureStatus,
} from "../db/features.js";
import { buildFeatureContext } from "../orchestrator/feature-context.js";
import { buildImplementationPrompt } from "../orchestrator/prompts.js";
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

interface AgentResult {
  status: "completed" | "failed";
  summary?: string;
  files_modified?: string[];
  files_created?: string[];
  tests_run?: "pass" | "fail" | "none";
  impact_report?: string;
  notes?: string;
}

export interface FeatureCreateOptions {
  title: string;
  description: string;
  repo?: string;
  noPr?: boolean;
}

/**
 * End-to-end feature implementation flow:
 *   1. Resolve target repo from config
 *   2. Create feature row in SQLite (status: pending)
 *   3. Assemble context (graph + vectors + repo summary)
 *   4. Create agent branch off the default branch
 *   5. Spawn Claude CLI with the implementation prompt
 *   6. Parse .agent/results/result-{id}.json that Claude wrote
 *   7. Stage + commit + push
 *   8. Open PR via `gh`
 *   9. Update feature row with final status, files, PR info
 */
export async function featureCreateCommand(
  opts: FeatureCreateOptions,
): Promise<void> {
  const config = loadConfig();

  // Step 1: resolve repo
  const repoName = opts.repo ?? config.repos[0]?.name;
  if (!repoName) {
    console.error("No repo specified and no repos registered.");
    console.error("Run `auto-coder repo add <name> <path>` first.");
    process.exit(1);
  }
  const repo = config.repos.find((r) => r.name === repoName);
  if (!repo) {
    console.error(`No repo named "${repoName}" is registered.`);
    process.exit(1);
  }

  // Preflight: working tree must be clean so we don't accidentally
  // bundle the user's uncommitted work into the agent's PR.
  if (hasUncommittedChanges(repo.path)) {
    console.error(`✗ ${repo.path} has uncommitted changes.`);
    console.error("  Commit or stash them before running `feature create`.");
    process.exit(1);
  }

  if (!opts.noPr && !isGhAvailable()) {
    console.error("✗ GitHub CLI (`gh`) is not installed or not on PATH.");
    console.error("  Install it from https://cli.github.com/ or re-run with --no-pr");
    process.exit(1);
  }

  // Step 2: create feature row
  console.log(`Creating feature: ${opts.title}`);
  const feature = createFeature(repo.name, opts.title, opts.description);
  console.log(`  Feature ID: ${feature.id}`);
  console.log(`  Status: ${feature.status}`);

  try {
    // Step 3: assemble context
    console.log("  Assembling context from graph + vectors...");
    const context = await buildFeatureContext(
      config,
      repo,
      feature.id,
      opts.description,
    );
    console.log(`  ✓ Got ${context.sources.length} relevant documents`);

    // Step 4: create branch
    const baseBranch = getDefaultBranch(repo.path);
    const branchName = context.branchName;
    console.log(`  Creating branch ${branchName} off ${baseBranch}...`);
    createAndCheckoutBranch(repo.path, branchName, baseBranch);

    updateFeature(feature.id, {
      status: "implementing" as FeatureStatus,
      branch_name: branchName,
    });

    // Step 5: build prompt + spawn Claude CLI
    const prompt = buildImplementationPrompt({
      featureId: feature.id,
      title: opts.title,
      description: opts.description,
      context,
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

    // Step 6: read result file
    const resultPath = path.join(repo.path, ".agent/results", `result-${feature.id}.json`);
    if (!fs.existsSync(resultPath)) {
      throw new Error(
        `Claude did not write the result file at ${resultPath}. Something went wrong.`,
      );
    }
    const agentResult = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AgentResult;

    if (agentResult.status === "failed") {
      updateFeature(feature.id, {
        status: "failed",
        error_message: agentResult.notes ?? "Claude reported failure with no notes",
        impact_report: agentResult.impact_report ?? null,
      });
      console.error(`✗ Feature marked as failed: ${agentResult.notes ?? "(no notes)"}`);
      process.exit(1);
    }

    // Step 7: stage + commit + push
    console.log("  Staging and committing changes...");
    stageAll(repo.path);
    if (!hasUncommittedChanges(repo.path)) {
      throw new Error("Claude claimed success but made no file changes — aborting.");
    }
    commitAll(
      repo.path,
      `${opts.title}\n\n${agentResult.summary ?? opts.description}\n\n[feature: ${feature.id}]`,
    );
    console.log("  Pushing branch to origin...");
    pushBranch(repo.path, branchName);

    // Step 8: open PR (optional)
    let prUrl: string | null = null;
    let prNumber: number | null = null;
    if (!opts.noPr) {
      console.log("  Creating pull request...");
      const body = buildPrBody(feature.id, opts, agentResult);
      const pr = createPullRequest(repo.path, opts.title, body, baseBranch);
      prUrl = pr.url;
      prNumber = pr.number;
      console.log(`  ✓ PR created: ${prUrl}`);
    }

    // Step 9: final update
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

function buildPrBody(
  featureId: string,
  opts: FeatureCreateOptions,
  result: AgentResult,
): string {
  const lines: string[] = [];
  lines.push(`## Feature: ${opts.title}`);
  lines.push("");
  lines.push(opts.description);
  lines.push("");
  if (result.summary) {
    lines.push("### Summary");
    lines.push(result.summary);
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

  const idWidth = 12;
  const statusWidth = 18;
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

export async function featureApproveCommand(id: string): Promise<void> {
  const feature = getFeature(id);
  if (!feature) {
    console.error(`No feature with id "${id}"`);
    process.exit(1);
  }
  if (feature.status !== "ready_for_review") {
    console.error(`Feature is in state "${feature.status}", not "ready_for_review"`);
    process.exit(1);
  }
  updateFeature(id, { status: "approved" });
  console.log(`✓ Feature ${id} approved`);
  console.log("  (Knowledge-base sync will happen on the next `auto-coder sync` run,");
  console.log("   or automatically via the post-commit hook if installed.)");
}
