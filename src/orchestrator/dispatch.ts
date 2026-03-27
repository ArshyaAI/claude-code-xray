/**
 * dispatch.ts — Shadow League Crew Dispatch
 *
 * Creates git worktrees, spawns Claude Code agents per crew per task,
 * collects metrics from the worktree after completion, and cleans up.
 *
 * Call chain: shadow.ts → dispatch.ts → (agent runs) → gates+score
 */

import { execSync, spawn, type ExecSyncOptions } from "node:child_process";
import * as crypto from "node:crypto";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { Task } from "./tasks.js";
import type { Genotype } from "../genotype/schema.js";
import type { Archetype } from "./config.js";
import type { EvalMetrics } from "../evaluator/score.js";
import {
  defaultMetrics,
  budgetMetricsFromGenotype,
} from "../evaluator/score.js";
import { getArchetypeDefaults } from "./archetypes.js";
import { collectComplexity } from "./complexity.js";
import { collectMutationScore } from "./mutation-testing.js";
import { collectDiffHunkCoverage } from "./coverage.js";
import { collectConventionViolations } from "./conventions.js";
import { collectDocCoverage } from "./doc-coverage.js";
import { runCrewPipeline, type PipelineOptions } from "./crew-pipeline.js";
import type { ActiveRole } from "./config.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CrewConfig {
  genotype: Genotype;
  /** Label for this crew (e.g., "champion", "mutant-1"). */
  label: string;
}

export interface AttemptResult {
  task: Task;
  crew: CrewConfig;
  /** Whether the agent completed successfully (exit 0). */
  agent_success: boolean;
  /** Wall-clock duration in seconds. */
  duration_sec: number;
  /** Estimated cost in USD (parsed from agent output, or 0). */
  cost_usd: number;
  /** Collected metrics for scoring. */
  metrics: EvalMetrics;
  /** Path to the worktree used for this attempt. */
  worktree_path: string;
  /** CI results for gate evaluation. */
  ci_results: {
    build_passed: boolean;
    build_reason?: string;
    test_passed: boolean;
    test_reason?: string;
    lint_passed: boolean;
    lint_reason?: string;
  };
  /** Review score from /review output, if available. */
  review_score: number | undefined;
  /** Critical security findings count. */
  critical_security_findings: number;
}

export interface DispatchOptions {
  /** Path to the repository root. */
  repo_root: string;
  /** Run ID for worktree namespacing. */
  run_id: string;
  /** Timeout per task in seconds (default: 1800 = 30 min). */
  task_timeout_sec: number;
  /** Budget cap for the entire run. */
  budget_cap_usd: number;
  /** Whether to keep worktrees after completion (for debugging). */
  keep_worktrees: boolean;
  /** Repo archetype for score normalization. */
  archetype: Archetype;
  /** Which agent roles to activate per task (default: builder, reviewer, qa). */
  active_roles: ActiveRole[];
}

// ─── Shell helpers ───────────────────────────────────────────────────────────

const EXEC_OPTS: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  stdio: ["pipe", "pipe", "pipe"],
};

function shell(cmd: string, cwd?: string): string {
  try {
    const result = execSync(cmd, { ...EXEC_OPTS, cwd });
    return (typeof result === "string" ? result : "").trim();
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string };
    return (err.stdout ?? err.stderr ?? "").toString().trim();
  }
}

function shellSuccess(cmd: string, cwd?: string): boolean {
  try {
    execSync(cmd, { ...EXEC_OPTS, cwd });
    return true;
  } catch {
    return false;
  }
}

// ─── Worktree management ─────────────────────────────────────────────────────

/**
 * Check if a path is registered as a git worktree.
 * Uses `git worktree list` as the authoritative source.
 */
export function isActiveWorktree(repoRoot: string, wtPath: string): boolean {
  const list = shell("git worktree list --porcelain", repoRoot);
  return list.split("\n").some((line) => line === `worktree ${wtPath}`);
}

/**
 * Create an isolated git worktree for a crew.
 * Worktrees are namespaced as `factory-{run_id}-{crew_label}` to avoid conflicts.
 *
 * Conflict handling:
 * - If the path already exists as a registered worktree, attempt to remove it first.
 * - If removal fails, generate a unique suffix to avoid the conflict.
 * - After creation, verify the worktree is valid (.git file present).
 */
export function createWorktree(
  repoRoot: string,
  runId: string,
  crewLabel: string,
  baseRef: string,
): string {
  let worktreeName = `factory-${runId}-${crewLabel}`;
  let worktreePath = join(repoRoot, ".worktrees", worktreeName);

  // Check for existing worktree conflict
  if (existsSync(worktreePath)) {
    if (isActiveWorktree(repoRoot, worktreePath)) {
      console.warn(
        `⚠ Worktree conflict: ${worktreePath} already registered. Attempting removal…`,
      );
      const removed = shellSuccess(
        `git worktree remove --force "${worktreePath}"`,
        repoRoot,
      );
      if (!removed) {
        // Removal failed — generate a unique suffix
        const suffix = crypto.randomBytes(2).toString("hex");
        worktreeName = `factory-${runId}-${crewLabel}-${suffix}`;
        worktreePath = join(repoRoot, ".worktrees", worktreeName);
        console.warn(`⚠ Removal failed. Using fallback path: ${worktreePath}`);
      }
    } else {
      // Path exists but not a registered worktree — stale directory, force remove
      shell(`git worktree remove --force "${worktreePath}"`, repoRoot);
    }
  }

  mkdirSync(join(repoRoot, ".worktrees"), { recursive: true });
  shell(`git worktree add --detach "${worktreePath}" "${baseRef}"`, repoRoot);

  // Verify worktree was actually created
  if (!existsSync(join(worktreePath, ".git"))) {
    throw new Error(
      `Worktree creation failed: ${worktreePath} does not contain a .git file`,
    );
  }

  // Install dependencies if package.json exists (needed for gate checks)
  if (existsSync(join(worktreePath, "package.json"))) {
    shell("npm install --ignore-scripts 2>/dev/null", worktreePath);
  }

  return worktreePath;
}

/**
 * Remove a worktree and prune.
 */
export function removeWorktree(repoRoot: string, worktreePath: string): void {
  shell(`git worktree remove --force "${worktreePath}"`, repoRoot);
  shell("git worktree prune", repoRoot);
}

/**
 * Create a failed AttemptResult for when worktree creation fails.
 * Used by callers that catch createWorktree errors.
 */
export function failedWorktreeResult(
  task: Task,
  crew: CrewConfig,
  reason: string,
): AttemptResult {
  return {
    task,
    crew,
    agent_success: false,
    duration_sec: 0,
    cost_usd: 0,
    metrics: defaultMetrics({}),
    worktree_path: "",
    ci_results: {
      build_passed: false,
      build_reason: reason,
      test_passed: false,
      test_reason: reason,
      lint_passed: false,
      lint_reason: reason,
    },
    review_score: undefined,
    critical_security_findings: 0,
  };
}

// ─── Agent spawning ──────────────────────────────────────────────────────────

/**
 * Run a single task with a crew configuration using the multi-agent pipeline.
 *
 * Pipeline: builder → reviewer → QA (per design doc active_roles)
 * Each role uses the genotype's model routing and prompt policy.
 * Falls back to builder-only if reviewer/QA not in active_roles.
 */
export function runTaskWithCrew(
  task: Task,
  crew: CrewConfig,
  worktreePath: string,
  options: DispatchOptions,
): AttemptResult {
  const taskContent = formatTaskContent(task);

  // Run the multi-agent crew pipeline
  const pipelineOpts: PipelineOptions = {
    worktreePath,
    timeout_sec: options.task_timeout_sec,
    activeRoles: options.active_roles,
  };

  const pipeline = runCrewPipeline(taskContent, crew.genotype, pipelineOpts);

  const agentSuccess = pipeline.builder.success;
  const agentOutput = pipeline.builder.output;
  const durationSec = pipeline.total_duration_sec;

  // Collect metrics from the worktree (after all agents ran)
  const ciResults = collectCiResults(worktreePath);
  const reviewScore =
    pipeline.review_score ?? collectReviewScore(worktreePath, agentOutput);
  const criticalFindings = collectSecurityFindings(worktreePath);
  const costUsd = pipeline.total_cost_usd;

  const mutationScore = collectMutationScore(worktreePath);
  const complexity = collectComplexity(worktreePath);
  const diffCoverage = collectDiffHunkCoverage(worktreePath);
  const conventions = collectConventionViolations(worktreePath);
  const docCoverage = collectDocCoverage(worktreePath);
  const budgetMetrics = budgetMetricsFromGenotype(crew.genotype);
  const archetypeDefaults = getArchetypeDefaults(options.archetype);
  const metrics = defaultMetrics({
    lint_violations_weighted: ciResults.lint_passed ? 0 : 5,
    cyclomatic_complexity: complexity,
    diff_hunk_coverage: diffCoverage,
    items_completed: agentSuccess && ciResults.build_passed ? 1 : 0,
    time_hours: durationSec / 3600,
    cost_per_item_usd: costUsd,
    budget_per_item_usd: budgetMetrics.budget_per_item_usd,
    guardrails_passed: criticalFindings === 0,
    convention_violations: conventions,
    kloc: 1.0,
    throughput_max: archetypeDefaults.throughput_max,
    mutation_score: mutationScore,
    doc_coverage: docCoverage,
  });

  return {
    task,
    crew,
    agent_success: agentSuccess,
    duration_sec: durationSec,
    cost_usd: costUsd,
    metrics,
    worktree_path: worktreePath,
    ci_results: ciResults,
    review_score: reviewScore,
    critical_security_findings: criticalFindings,
  };
}

/**
 * Async version of runTaskWithCrew using spawn + Promise.
 * Used for parallel crew execution.
 */
export function runTaskWithCrewAsync(
  task: Task,
  crew: CrewConfig,
  worktreePath: string,
  options: DispatchOptions,
): Promise<AttemptResult> {
  const taskContent = formatTaskContent(task);
  const nightTaskPath = join(worktreePath, "NIGHT-TASK.md");
  writeFileSync(nightTaskPath, taskContent, "utf-8");

  const startTime = Date.now();
  const timeoutMs = options.task_timeout_sec * 1000;

  return new Promise<AttemptResult>((resolve) => {
    let agentOutput = "";
    let killed = false;

    const child = spawn(
      "claude",
      [
        "--prompt-file",
        "NIGHT-TASK.md",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
      ],
      {
        cwd: worktreePath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (data: Buffer) => {
      agentOutput += data.toString();
    });

    // Ignore stderr
    child.stderr.on("data", () => {});

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      // Force kill after 5s if still alive
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 5000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationSec = Math.round((Date.now() - startTime) / 1000);
      const agentSuccess = !killed && code === 0;

      const ciResults = collectCiResults(worktreePath);
      const reviewScore = collectReviewScore(worktreePath, agentOutput);
      const criticalFindings = collectSecurityFindings(worktreePath);
      const costUsd = parseCostFromOutput(agentOutput, durationSec);

      const mutationScore = collectMutationScore(worktreePath);
      const complexity = collectComplexity(worktreePath);
      const docCoverage = collectDocCoverage(worktreePath);
      const budgetMetrics = budgetMetricsFromGenotype(crew.genotype);
      const metrics = defaultMetrics({
        lint_violations_weighted: ciResults.lint_passed ? 0 : 5,
        items_completed: agentSuccess && ciResults.build_passed ? 1 : 0,
        time_hours: durationSec / 3600,
        cost_per_item_usd: costUsd,
        budget_per_item_usd: budgetMetrics.budget_per_item_usd,
        guardrails_passed: criticalFindings === 0,
        convention_violations: 0,
        kloc: 1.0,
        throughput_max: 10.0,
        mutation_score: mutationScore,
        cyclomatic_complexity: complexity,
        doc_coverage: docCoverage,
      });

      resolve({
        task,
        crew,
        agent_success: agentSuccess,
        duration_sec: durationSec,
        cost_usd: costUsd,
        metrics,
        worktree_path: worktreePath,
        ci_results: ciResults,
        review_score: reviewScore,
        critical_security_findings: criticalFindings,
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      const durationSec = Math.round((Date.now() - startTime) / 1000);
      const costUsd = parseCostFromOutput(agentOutput, durationSec);
      const ciResults = collectCiResults(worktreePath);
      const reviewScore = collectReviewScore(worktreePath, agentOutput);
      const criticalFindings = collectSecurityFindings(worktreePath);

      const mutationScore = collectMutationScore(worktreePath);
      const complexity = collectComplexity(worktreePath);
      const docCoverage = collectDocCoverage(worktreePath);
      const budgetMetrics = budgetMetricsFromGenotype(crew.genotype);
      const metrics = defaultMetrics({
        lint_violations_weighted: ciResults.lint_passed ? 0 : 5,
        items_completed: 0,
        time_hours: durationSec / 3600,
        cost_per_item_usd: costUsd,
        budget_per_item_usd: budgetMetrics.budget_per_item_usd,
        guardrails_passed: criticalFindings === 0,
        convention_violations: 0,
        kloc: 1.0,
        throughput_max: 10.0,
        mutation_score: mutationScore,
        cyclomatic_complexity: complexity,
        doc_coverage: docCoverage,
      });

      resolve({
        task,
        crew,
        agent_success: false,
        duration_sec: durationSec,
        cost_usd: costUsd,
        metrics,
        worktree_path: worktreePath,
        ci_results: ciResults,
        review_score: reviewScore,
        critical_security_findings: criticalFindings,
      });
    });
  });
}

// ─── Metrics collection ──────────────────────────────────────────────────────

function collectCiResults(worktreePath: string): AttemptResult["ci_results"] {
  // Build check: tsc --noEmit or npm run build
  const buildPassed = shellSuccess("npx tsc --noEmit", worktreePath);

  // Test check: npm test
  const testPassed = shellSuccess("npm test 2>/dev/null", worktreePath);

  // Lint check: try eslint, then biome
  let lintPassed = true;
  let lintReason: string | null = null;
  if (
    existsSync(join(worktreePath, ".eslintrc.json")) ||
    existsSync(join(worktreePath, ".eslintrc.js")) ||
    existsSync(join(worktreePath, "eslint.config.js"))
  ) {
    lintPassed = shellSuccess(
      "npx eslint . --max-warnings 0 2>/dev/null",
      worktreePath,
    );
    if (!lintPassed) lintReason = "ESLint errors found";
  } else if (existsSync(join(worktreePath, "biome.json"))) {
    lintPassed = shellSuccess("npx biome check . 2>/dev/null", worktreePath);
    if (!lintPassed) lintReason = "Biome check failed";
  }

  // Build result object — only include reason keys when there's a value
  // (exactOptionalPropertyTypes forbids assigning undefined to optional props)
  const result: AttemptResult["ci_results"] = {
    build_passed: buildPassed,
    test_passed: testPassed,
    lint_passed: lintPassed,
  };

  if (!buildPassed) {
    result.build_reason = shell(
      "npx tsc --noEmit 2>&1 | tail -3",
      worktreePath,
    );
  }
  if (!testPassed) {
    result.test_reason = "Test suite failed or not configured";
  }
  if (lintReason) {
    result.lint_reason = lintReason;
  }

  return result;
}

/**
 * Parse a SCORE: N value from text content.
 * Exported for testing.
 */
export function parseReviewScore(text: string): number | undefined {
  const match = text.match(/SCORE:\s*(\d+)/i);
  if (!match?.[1]) return undefined;
  const score = parseInt(match[1], 10);
  if (score < 0 || score > 100) return undefined;
  return score;
}

function collectReviewScore(
  worktreePath: string,
  agentOutput: string,
): number | undefined {
  const fromOutput = parseReviewScore(agentOutput);
  if (fromOutput !== undefined) return fromOutput;

  const candidates = [".claude/review-output.txt", "REVIEW.md"];
  for (const file of candidates) {
    const filePath = join(worktreePath, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const score = parseReviewScore(content);
        if (score !== undefined) return score;
      } catch {
        /* ignore */
      }
    }
  }

  return undefined;
}

function collectSecurityFindings(worktreePath: string): number {
  // npm audit --audit-level=critical — count critical findings
  const output = shell(
    "npm audit --audit-level=critical --json 2>/dev/null",
    worktreePath,
  );
  try {
    const audit = JSON.parse(output) as {
      metadata?: { vulnerabilities?: { critical?: number } };
    };
    return audit.metadata?.vulnerabilities?.critical ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Parse cost from Claude Code JSON output.
 * Claude Code with --output-format json may include a cost_usd field
 * or a usage summary. Falls back to duration-based estimate.
 */
function parseCostFromOutput(agentOutput: string, durationSec: number): number {
  // Try to parse JSON output from Claude Code
  try {
    // Claude Code JSON output may contain cost info
    const parsed = JSON.parse(agentOutput) as {
      cost_usd?: number;
      usage?: { cost_usd?: number };
      total_cost_usd?: number;
    };
    if (typeof parsed.cost_usd === "number") return parsed.cost_usd;
    if (typeof parsed.usage?.cost_usd === "number")
      return parsed.usage.cost_usd;
    if (typeof parsed.total_cost_usd === "number") return parsed.total_cost_usd;
  } catch {
    // Not valid JSON — try regex patterns
  }

  // Try to find cost in text output (e.g., "Total cost: $1.23")
  const costMatch = agentOutput.match(
    /(?:total[_ ]?cost|cost)[:\s]*\$?([\d.]+)/i,
  );
  if (costMatch?.[1]) {
    const cost = parseFloat(costMatch[1]);
    if (!isNaN(cost)) return cost;
  }

  // Fallback: duration-based estimate ($0.02/min for Sonnet)
  const minutes = durationSec / 60;
  return Math.round(minutes * 0.02 * 100) / 100;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTaskContent(task: Task): string {
  const lines = [`# Task\n`, task.description, ""];

  if (task.context.length > 0) {
    lines.push("## Context\n");
    for (const ctx of task.context) {
      lines.push(ctx);
    }
    lines.push("");
  }

  return lines.join("\n");
}
