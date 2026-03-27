/**
 * shadow.ts — Shadow League Runner
 *
 * Entry point for the Shadow League evolution experiment.
 * Loads the champion genotype, generates a mutant, dispatches both crews
 * on the same task list, scores results, and makes a promotion decision.
 *
 * Call chain: factory.sh → shadow.ts → dispatch.ts → gates+score → protocol
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { SEED_GENOTYPE, type Genotype } from "../genotype/schema.js";
import { mutate } from "../genotype/mutate.js";
import {
  evaluate,
  type ScoreResult,
  type ParetoDimensions,
} from "../evaluator/score.js";
import { runAllGates, toHardGates } from "../evaluator/gates.js";
import { runSignTest, type SignTestResult } from "../promoter/protocol.js";
import {
  type CrewConfig,
  type AttemptResult,
  type DispatchOptions,
  createWorktree,
  removeWorktree,
  runTaskWithCrew,
} from "./dispatch.js";
import { parseTasks, type Task } from "./tasks.js";
import { loadConfig, type FactoryConfig } from "./config.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShadowRunOptions {
  /** Path to the repository root. */
  repo: string;
  /** Number of tasks to run (min 8). */
  tasks: number;
  /** Number of crews (default 2: champion + 1 mutant). */
  crews: number;
  /** Budget cap in USD (overrides factory.yaml). */
  budget: number | null;
  /** Whether to run crews in parallel. */
  parallel: boolean;
  /** Whether to keep worktrees after completion. */
  keepWorktrees: boolean;
  /** Dry run — estimate cost without executing. */
  dryRun: boolean;
  /** Specific mutation seed for reproducibility. */
  seed: number | null;
}

export interface ShadowRunResult {
  run_id: string;
  status: "completed" | "budget_exceeded" | "failed";
  crews: CrewResult[];
  promotion: PromotionDecision;
  total_cost_usd: number;
  total_duration_sec: number;
}

export interface CrewResult {
  label: string;
  genotype_id: string;
  attempts: AttemptResult[];
  scores: ScoreResult[];
  aggregate_utility: number;
}

export interface PromotionDecision {
  should_promote: boolean;
  winner_label: string;
  sign_test: SignTestResult | null;
  reason: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: ShadowRunOptions = {
  repo: ".",
  tasks: 8,
  crews: 2,
  budget: null,
  parallel: false,
  keepWorktrees: false,
  dryRun: false,
  seed: null,
};

const MIN_TASKS = 8;

// ─── Main runner ─────────────────────────────────────────────────────────────

/**
 * Run a Shadow League experiment.
 *
 * 1. Load config and parse tasks
 * 2. Load/bootstrap champion genotype
 * 3. Generate mutant(s)
 * 4. For each task, run all crews (sequentially or in parallel)
 * 5. Score all attempts through gates + Pareto scorer
 * 6. Aggregate utilities and run sign test
 * 7. Report results
 */
export function runShadowLeague(
  options: Partial<ShadowRunOptions> = {},
): ShadowRunResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const repoRoot = resolve(opts.repo);

  // Validate
  if (opts.tasks < MIN_TASKS) {
    throw new Error(
      `Minimum ${MIN_TASKS} tasks required for sign test. Got: ${opts.tasks}`,
    );
  }

  // Load config
  const configResult = loadConfig(repoRoot);
  if (!configResult.valid) {
    throw new Error(`Invalid factory.yaml: ${configResult.errors.join("; ")}`);
  }
  const config = configResult.config;

  // Parse tasks
  const taskSource = join(repoRoot, config.task_source);
  const parseResult = parseTasks(taskSource);
  const allTasks = parseResult.tasks;

  if (allTasks.length < opts.tasks) {
    throw new Error(
      `Need ${opts.tasks} tasks but ${config.task_source} only has ${allTasks.length}. Add more tasks.`,
    );
  }

  // Select tasks for this run (first N)
  const tasks = allTasks.slice(0, opts.tasks);

  // Budget
  const budgetCap = opts.budget ?? config.default_budget_usd;

  // Generate run ID
  const runId = generateRunId();

  // Dry run: estimate cost and exit
  if (opts.dryRun) {
    return dryRunEstimate(runId, tasks, opts, config, budgetCap);
  }

  // Load champion genotype
  const champion = loadChampion(repoRoot);

  // Generate mutant(s)
  const crewConfigs = buildCrewConfigs(champion, opts);

  // Dispatch options
  const dispatchOpts: DispatchOptions = {
    repo_root: repoRoot,
    run_id: runId,
    task_timeout_sec: 1800, // 30 min per task
    budget_cap_usd: budgetCap,
    keep_worktrees: opts.keepWorktrees,
  };

  // Run all crews on all tasks
  const crewResults: CrewResult[] = [];
  let totalCost = 0;
  const startTime = Date.now();

  for (const crewConfig of crewConfigs) {
    const attempts: AttemptResult[] = [];
    const scores: ScoreResult[] = [];
    let crewCost = 0;

    // Create worktree for this crew
    const baseRef = getCurrentBranch(repoRoot);
    const worktreePath = createWorktree(
      repoRoot,
      runId,
      crewConfig.label,
      baseRef,
    );

    try {
      for (const task of tasks) {
        // Budget check
        if (totalCost + crewCost > budgetCap) {
          console.error(
            `Budget cap $${budgetCap} exceeded at $${totalCost + crewCost}. Stopping.`,
          );
          break;
        }

        // Run task
        const attempt = runTaskWithCrew(
          task,
          crewConfig,
          worktreePath,
          dispatchOpts,
        );
        attempts.push(attempt);
        crewCost += attempt.cost_usd;

        // Score through gates + evaluator
        // Build gate input — only include optional fields when defined
        // (exactOptionalPropertyTypes forbids assigning undefined)
        const gateInput: Parameters<typeof runAllGates>[0] = {
          workspace_path: worktreePath,
          min_review_score:
            crewConfig.genotype.review_strategy.min_review_score,
        };
        if (attempt.review_score !== undefined) {
          gateInput.review_score = attempt.review_score;
        }
        if (attempt.critical_security_findings !== undefined) {
          gateInput.critical_security_findings =
            attempt.critical_security_findings;
        }
        const gateResult = runAllGates(gateInput, attempt.ci_results);

        const gates = toHardGates(gateResult);
        const scoreResult = evaluate({
          genotype_id: crewConfig.genotype.id,
          task_id: task.hash,
          stage: "shadow",
          gates,
          metrics: attempt.metrics,
        });

        scores.push(scoreResult);
      }
    } finally {
      // Clean up worktree
      if (!opts.keepWorktrees) {
        removeWorktree(repoRoot, worktreePath);
      }
    }

    totalCost += crewCost;

    // Aggregate utility
    const utilities = scores
      .filter((s) => s.scores !== null)
      .map((s) => s.utility);
    const aggregateUtility =
      utilities.length > 0
        ? utilities.reduce((a, b) => a + b, 0) / utilities.length
        : 0;

    crewResults.push({
      label: crewConfig.label,
      genotype_id: crewConfig.genotype.id,
      attempts,
      scores,
      aggregate_utility: Math.round(aggregateUtility * 10000) / 10000,
    });
  }

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  // Determine status
  const status: ShadowRunResult["status"] =
    totalCost > budgetCap ? "budget_exceeded" : "completed";

  // Run sign test for promotion decision
  const promotion = makePromotionDecision(crewResults);

  return {
    run_id: runId,
    status,
    crews: crewResults,
    promotion,
    total_cost_usd: Math.round(totalCost * 100) / 100,
    total_duration_sec: totalDuration,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `run-${date}-${seq}`;
}

function getCurrentBranch(repoRoot: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "HEAD";
  }
}

function loadChampion(_repoRoot: string): Genotype {
  // Phase 1: load from seed. Phase 2: load from evo.db
  // TODO: Query evo.db for status='champion', fallback to SEED_GENOTYPE
  return SEED_GENOTYPE;
}

function buildCrewConfigs(
  champion: Genotype,
  opts: ShadowRunOptions,
): CrewConfig[] {
  const configs: CrewConfig[] = [{ genotype: champion, label: "champion" }];

  // Generate mutants
  const mutantCount = Math.max(1, opts.crews - 1);
  for (let i = 0; i < mutantCount; i++) {
    const mutationOpts = opts.seed !== null ? { seed: opts.seed + i } : {};
    const result = mutate(champion, mutationOpts);
    configs.push({
      genotype: result.genotype,
      label: `mutant-${i + 1}`,
    });
  }

  return configs;
}

function makePromotionDecision(crewResults: CrewResult[]): PromotionDecision {
  const champion = crewResults.find((c) => c.label === "champion");
  if (!champion) {
    return {
      should_promote: false,
      winner_label: "champion",
      sign_test: null,
      reason: "No champion crew found",
    };
  }

  // Compare each mutant against champion
  for (const mutant of crewResults.filter((c) => c.label !== "champion")) {
    const candidateScores = mutant.scores
      .filter((s) => s.scores !== null)
      .map((s) => s.scores as ParetoDimensions);
    const championScores = champion.scores
      .filter((s) => s.scores !== null)
      .map((s) => s.scores as ParetoDimensions);

    if (
      candidateScores.length < MIN_TASKS ||
      championScores.length < MIN_TASKS
    ) {
      continue;
    }

    // Phase 1: aggregate utility sign test only
    const signTestResult = runSignTest({
      candidate_scores: candidateScores,
      champion_scores: championScores,
    });

    if (signTestResult.passed) {
      return {
        should_promote: true,
        winner_label: mutant.label,
        sign_test: signTestResult,
        reason: `${mutant.label} (${mutant.genotype_id}) passed sign test with p=${signTestResult.p_value}`,
      };
    }

    // Even if sign test failed, report the best mutant
    return {
      should_promote: false,
      winner_label: "champion",
      sign_test: signTestResult,
      reason: `Champion retains title. ${mutant.label} sign test p=${signTestResult.p_value} (need < 0.05)`,
    };
  }

  return {
    should_promote: false,
    winner_label: "champion",
    sign_test: null,
    reason: "No valid mutant comparisons (insufficient data)",
  };
}

function dryRunEstimate(
  runId: string,
  tasks: Task[],
  opts: ShadowRunOptions,
  _config: FactoryConfig,
  budgetCap: number,
): ShadowRunResult {
  // Rough estimate: ~5 min per task, $0.02/min for Sonnet
  const estMinPerTask = 5;
  const estCostPerMin = 0.02;
  const estTotalMin = tasks.length * opts.crews * estMinPerTask;
  const estCost = estTotalMin * estCostPerMin;

  console.log(`\n--- DRY RUN ESTIMATE ---`);
  console.log(`Run ID:     ${runId}`);
  console.log(`Tasks:      ${tasks.length}`);
  console.log(`Crews:      ${opts.crews}`);
  console.log(`Budget cap: $${budgetCap}`);
  console.log(
    `Est. time:  ${estTotalMin} min (~${Math.round((estTotalMin / 60) * 10) / 10} hours)`,
  );
  console.log(`Est. cost:  $${Math.round(estCost * 100) / 100}`);
  console.log(
    estCost > budgetCap
      ? `⚠️  Estimated cost exceeds budget cap!`
      : `✓  Within budget`,
  );
  console.log(`---\n`);

  return {
    run_id: runId,
    status: "completed",
    crews: [],
    promotion: {
      should_promote: false,
      winner_label: "champion",
      sign_test: null,
      reason: "Dry run — no actual execution",
    },
    total_cost_usd: 0,
    total_duration_sec: 0,
  };
}
