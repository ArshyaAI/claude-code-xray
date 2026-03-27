/**
 * dispatch.ts — Shadow League Crew Dispatch
 *
 * Creates git worktrees, spawns Claude Code agents per crew per task,
 * collects metrics from the worktree after completion, and cleans up.
 *
 * Call chain: shadow.ts → dispatch.ts → (agent runs) → gates+score
 */

import { execSync, spawn, type ExecSyncOptions } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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
 * Create an isolated git worktree for a crew.
 * Worktrees are namespaced as `factory-{run_id}-{crew_label}` to avoid conflicts.
 */
export function createWorktree(
  repoRoot: string,
  runId: string,
  crewLabel: string,
  baseRef: string,
): string {
  const worktreeName = `factory-${runId}-${crewLabel}`;
  const worktreePath = join(repoRoot, ".worktrees", worktreeName);

  if (existsSync(worktreePath)) {
    // Clean up stale worktree
    shell(`git worktree remove --force "${worktreePath}"`, repoRoot);
  }

  mkdirSync(join(repoRoot, ".worktrees"), { recursive: true });
  shell(`git worktree add --detach "${worktreePath}" "${baseRef}"`, repoRoot);

  return worktreePath;
}

/**
 * Remove a worktree and prune.
 */
export function removeWorktree(repoRoot: string, worktreePath: string): void {
  shell(`git worktree remove --force "${worktreePath}"`, repoRoot);
  shell("git worktree prune", repoRoot);
}

// ─── Agent spawning ──────────────────────────────────────────────────────────

/**
 * Run a single task with a single crew configuration.
 *
 * 1. Writes NIGHT-TASK.md into the worktree
 * 2. Spawns `claude --prompt-file NIGHT-TASK.md`
 * 3. Measures wall-clock time
 * 4. Collects metrics from the worktree
 */
export function runTaskWithCrew(
  task: Task,
  crew: CrewConfig,
  worktreePath: string,
  options: DispatchOptions,
): AttemptResult {
  const taskContent = formatTaskContent(task);
  const nightTaskPath = join(worktreePath, "NIGHT-TASK.md");
  writeFileSync(nightTaskPath, taskContent, "utf-8");

  const startTime = Date.now();
  let agentSuccess = false;
  let agentOutput = "";

  try {
    // Spawn Claude Code agent with --prompt-file (safe from shell injection)
    const timeoutMs = options.task_timeout_sec * 1000;
    const result = execSync(
      `claude --prompt-file NIGHT-TASK.md --dangerously-skip-permissions --output-format json 2>/dev/null`,
      {
        cwd: worktreePath,
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8" as BufferEncoding,
        env: { ...process.env },
      },
    );
    agentOutput = typeof result === "string" ? result : "";
    agentSuccess = true;
  } catch (e: unknown) {
    const err = e as {
      killed?: boolean;
      code?: string | number;
      stdout?: string;
    };
    agentOutput = err.stdout ?? "";
    // timeout kills the process — err.killed will be true
    if (err.killed) {
      // Timeout — agent took too long
      agentSuccess = false;
    } else if (err.code === 0 || err.code === "0") {
      agentSuccess = true;
    }
    // Other errors: agent failed
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);

  // Collect metrics from the worktree
  const ciResults = collectCiResults(worktreePath);
  const reviewScore = collectReviewScore(worktreePath);
  const criticalFindings = collectSecurityFindings(worktreePath);
  const costUsd = parseCostFromOutput(agentOutput, durationSec);

  const budgetMetrics = budgetMetricsFromGenotype(crew.genotype);
  const archetypeDefaults = getArchetypeDefaults(options.archetype);
  const metrics = defaultMetrics({
    lint_violations_weighted: ciResults.lint_passed ? 0 : 5,
    items_completed: agentSuccess && ciResults.build_passed ? 1 : 0,
    time_hours: durationSec / 3600,
    cost_per_item_usd: costUsd,
    budget_per_item_usd: budgetMetrics.budget_per_item_usd,
    guardrails_passed: criticalFindings === 0,
    convention_violations: 0,
    kloc: 1.0,
    throughput_max: archetypeDefaults.throughput_max,
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
      const reviewScore = collectReviewScore(worktreePath);
      const criticalFindings = collectSecurityFindings(worktreePath);
      const costUsd = parseCostFromOutput(agentOutput, durationSec);

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
      const reviewScore = collectReviewScore(worktreePath);
      const criticalFindings = collectSecurityFindings(worktreePath);

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

function collectReviewScore(_worktreePath: string): number | undefined {
  // Phase 1: review score is collected if /review was run and wrote SCORE: N
  // For now, return undefined (neutral) — the gate will use the default
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
