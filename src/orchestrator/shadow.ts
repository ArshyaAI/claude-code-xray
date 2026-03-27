/**
 * shadow.ts — Shadow League Runner
 *
 * Entry point for the Shadow League evolution experiment.
 * Loads the champion genotype, generates a mutant, dispatches both crews
 * on the same task list, scores results, and makes a promotion decision.
 *
 * Call chain: factory.sh → shadow.ts → dispatch.ts → gates+score → protocol
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  SEED_GENOTYPE,
  validateGenotype,
  type Genotype,
} from "../genotype/schema.js";
import { mutate, type MutationManifest } from "../genotype/mutate.js";
export type { MutationManifest } from "../genotype/mutate.js";
import {
  evaluate,
  type ScoreResult,
  type ParetoDimensions,
} from "../evaluator/score.js";
import { runAllGates, toHardGates } from "../evaluator/gates.js";
import {
  runSignTest,
  runParetoDominanceTest,
  type SignTestResult,
  type ParetoDominanceResult,
} from "../promoter/protocol.js";
import {
  type CrewConfig,
  type AttemptResult,
  type DispatchOptions,
  createWorktree,
  removeWorktree,
  runTaskWithCrew,
  runTaskWithCrewAsync,
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
  /** Variance check mode: run same genotype for all crews (no mutation). */
  varianceCheck: boolean;
  /** Force per-dimension Pareto dominance test (requires N >= 20). */
  fullPareto: boolean;
  /** Override task source file (default: from factory.yaml or PROGRAM.md). */
  taskSource: string | null;
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
  /** Mutation manifest — only present for mutant crews. */
  mutation_manifest?: MutationManifest | undefined;
}

export interface PromotionDecision {
  should_promote: boolean;
  winner_label: string;
  sign_test: SignTestResult | null;
  pareto_dominance: ParetoDominanceResult | null;
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
  varianceCheck: false,
  fullPareto: false,
  taskSource: null,
};

const MIN_TASKS = 8;

// ─── DB helpers ─────────────────────────────────────────────────────────────

const DB_EXEC_OPTS: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  stdio: ["pipe", "pipe", "pipe"],
};

function getDbPath(): string {
  return process.env.FACTORY_DB ?? join(homedir(), ".factory", "evo.db");
}

/** Run a sqlite3 query and return stdout. Throws on missing DB. */
function dbQuery(sql: string): string {
  const db = getDbPath();
  if (!existsSync(db)) {
    throw new Error(`evo.db not found at ${db}`);
  }
  const escaped = sql.replace(/'/g, "'\\''");
  const result = execSync(`sqlite3 '${db}' '${escaped}'`, DB_EXEC_OPTS);
  return (typeof result === "string" ? result : "").trim();
}

/** Run a sqlite3 statement (INSERT/UPDATE). Returns true on success. */
function dbExec(sql: string): boolean {
  const db = getDbPath();
  if (!existsSync(db)) return false;
  const escaped = sql.replace(/'/g, "'\\''");
  try {
    execSync(`sqlite3 '${db}' '${escaped}'`, DB_EXEC_OPTS);
    return true;
  } catch {
    return false;
  }
}

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
export async function runShadowLeague(
  options: Partial<ShadowRunOptions> = {},
): Promise<ShadowRunResult> {
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

  // Parse tasks — use override, configured source, or fall back to TASKS.md
  let taskSource = opts.taskSource
    ? join(repoRoot, opts.taskSource)
    : join(repoRoot, config.task_source);
  if (!existsSync(taskSource) && config.task_source === "PROGRAM.md") {
    const fallback = join(repoRoot, "TASKS.md");
    if (existsSync(fallback)) {
      console.log("No PROGRAM.md found. Falling back to TASKS.md.");
      taskSource = fallback;
    } else {
      throw new Error(
        "No PROGRAM.md found. Create one with checkbox items (- [ ] task description) to define work for the Shadow League.",
      );
    }
  }
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

  // Record shadow run start
  recordShadowRunStart(
    runId,
    repoRoot,
    config.archetype,
    budgetCap,
    tasks.length,
    opts.crews,
  );

  // Load champion genotype
  const champion = loadChampion(repoRoot);
  const championGen = getGeneration(champion.id);

  // Generate mutant(s) and persist them
  const crewConfigs = buildCrewConfigs(champion, opts);
  for (const crew of crewConfigs) {
    if (crew.label !== "champion") {
      saveGenotype(crew.genotype, championGen);
    }
  }

  // Dispatch options
  const dispatchOpts: DispatchOptions = {
    repo_root: repoRoot,
    run_id: runId,
    task_timeout_sec: 1800, // 30 min per task
    budget_cap_usd: budgetCap,
    keep_worktrees: opts.keepWorktrees,
    archetype: config.archetype,
  };

  // Run all crews on all tasks
  const crewResults: CrewResult[] = [];
  let totalCost = 0;
  const startTime = Date.now();
  const activeWorktrees: string[] = [];
  let aborted = false;

  // SIGTERM/SIGINT handler: clean up worktrees and record partial scores
  const cleanup = () => {
    aborted = true;
    console.error("\nReceived shutdown signal. Cleaning up worktrees...");
    for (const wt of activeWorktrees) {
      try {
        removeWorktree(repoRoot, wt);
        console.error(`  Removed: ${wt}`);
      } catch {
        console.error(`  Failed to remove: ${wt}`);
      }
    }
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  if (opts.parallel) {
    // ── Parallel mode: all crews run concurrently per task round ──

    // Create ALL worktrees upfront
    const baseRef = getCurrentBranch(repoRoot);
    const crewWorktrees = new Map<string, string>();
    for (const crewConfig of crewConfigs) {
      const worktreePath = createWorktree(
        repoRoot,
        runId,
        crewConfig.label,
        baseRef,
      );
      crewWorktrees.set(crewConfig.label, worktreePath);
      activeWorktrees.push(worktreePath);
    }

    // Per-crew accumulators
    const crewAttempts = new Map<string, AttemptResult[]>();
    const crewScores = new Map<string, ScoreResult[]>();
    for (const c of crewConfigs) {
      crewAttempts.set(c.label, []);
      crewScores.set(c.label, []);
    }

    try {
      for (const task of tasks) {
        if (aborted) break;

        // Budget check before starting this round
        if (totalCost > budgetCap) {
          console.error(
            `Budget cap $${budgetCap} exceeded at $${totalCost}. Stopping.`,
          );
          break;
        }

        // Run all crews on this task in parallel
        const results = await Promise.all(
          crewConfigs.map((crewConfig) => {
            const worktreePath = crewWorktrees.get(crewConfig.label)!;
            return runTaskWithCrewAsync(
              task,
              crewConfig,
              worktreePath,
              dispatchOpts,
            );
          }),
        );

        // Collect results and score
        for (let i = 0; i < crewConfigs.length; i++) {
          const crewConfig = crewConfigs[i]!;
          const attempt = results[i]!;
          const worktreePath = crewWorktrees.get(crewConfig.label)!;

          crewAttempts.get(crewConfig.label)!.push(attempt);
          totalCost += attempt.cost_usd;

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

          crewScores.get(crewConfig.label)!.push(scoreResult);

          const evalId = saveEvaluation(
            scoreResult,
            attempt.cost_usd,
            attempt.duration_sec,
          );
          recordShadowAttempt(
            runId,
            crewConfig.genotype.id,
            task,
            worktreePath,
            attempt,
            evalId,
          );
        }
      }
    } finally {
      // Clean up all worktrees
      for (const [, worktreePath] of crewWorktrees) {
        if (!opts.keepWorktrees) {
          removeWorktree(repoRoot, worktreePath);
        }
        const idx = activeWorktrees.indexOf(worktreePath);
        if (idx >= 0) activeWorktrees.splice(idx, 1);
      }
    }

    // Aggregate results per crew
    for (const crewConfig of crewConfigs) {
      const attempts = crewAttempts.get(crewConfig.label)!;
      const scores = crewScores.get(crewConfig.label)!;
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
        mutation_manifest: crewConfig.mutation_manifest,
      });
    }
  } else {
    // ── Sequential mode (original) ──

    for (const crewConfig of crewConfigs) {
      const attempts: AttemptResult[] = [];
      const scores: ScoreResult[] = [];
      let crewCost = 0;

      if (aborted) break;

      // Create worktree for this crew
      const baseRef = getCurrentBranch(repoRoot);
      const worktreePath = createWorktree(
        repoRoot,
        runId,
        crewConfig.label,
        baseRef,
      );
      activeWorktrees.push(worktreePath);

      try {
        for (const task of tasks) {
          if (aborted) break;

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

          // Persist evaluation and attempt to evo.db
          const evalId = saveEvaluation(
            scoreResult,
            attempt.cost_usd,
            attempt.duration_sec,
          );
          recordShadowAttempt(
            runId,
            crewConfig.genotype.id,
            task,
            worktreePath,
            attempt,
            evalId,
          );
        }
      } finally {
        // Clean up worktree
        if (!opts.keepWorktrees) {
          removeWorktree(repoRoot, worktreePath);
        }
        const idx = activeWorktrees.indexOf(worktreePath);
        if (idx >= 0) activeWorktrees.splice(idx, 1);
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
        mutation_manifest: crewConfig.mutation_manifest,
      });
    }
  }

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  // Remove signal handlers
  process.removeListener("SIGTERM", cleanup);
  process.removeListener("SIGINT", cleanup);

  // Determine status
  const status: ShadowRunResult["status"] = aborted
    ? "failed"
    : totalCost > budgetCap
      ? "budget_exceeded"
      : "completed";

  // Run sign test for promotion decision
  const promotion = makePromotionDecision(crewResults, opts.fullPareto);

  // Record shadow run completion
  recordShadowRunEnd(runId, status, totalCost);

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
  try {
    const raw = dbQuery(
      'SELECT yaml FROM genotypes WHERE status="champion" LIMIT 1',
    );
    if (!raw) return SEED_GENOTYPE;

    const parsed: unknown = JSON.parse(raw);
    const validation = validateGenotype(parsed);
    if (!validation.valid) {
      console.error(
        `Champion genotype failed validation: ${validation.errors.join("; ")}. Falling back to seed.`,
      );
      return SEED_GENOTYPE;
    }
    return parsed as Genotype;
  } catch {
    return SEED_GENOTYPE;
  }
}

/** Get the generation number for a genotype from evo.db (0 if not found). */
function getGeneration(genotypeId: string): number {
  try {
    const raw = dbQuery(
      `SELECT generation FROM genotypes WHERE id="${genotypeId}" LIMIT 1`,
    );
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

/** Insert a new genotype into evo.db after mutation. */
function saveGenotype(genotype: Genotype, parentGeneration: number): void {
  const yaml = JSON.stringify(genotype).replace(/"/g, '""');
  const now = new Date().toISOString();
  const gen = parentGeneration + 1;
  dbExec(
    `INSERT OR IGNORE INTO genotypes (id, parent_id, yaml, created_at, status, generation) VALUES ("${genotype.id}", "${genotype.parent_id}", "${yaml}", "${now}", "active", ${gen})`,
  );
}

/** Insert an evaluation record and return the rowid. */
function saveEvaluation(
  score: ScoreResult,
  costUsd: number,
  durationSec: number,
): number | null {
  const now = new Date().toISOString();
  const scoresJson = score.scores
    ? JSON.stringify(score.scores).replace(/"/g, '""')
    : "{}";
  const gatesPassed = score.gates_passed ? 1 : 0;
  try {
    dbExec(
      `INSERT INTO evaluations (genotype_id, task_id, stage, scores, utility, gates_passed, cost_usd, duration_sec, created_at) VALUES ("${score.genotype_id}", "${score.task_id}", "${score.stage}", "${scoresJson}", ${score.utility}, ${gatesPassed}, ${costUsd}, ${durationSec}, "${now}")`,
    );
    const rowid = dbQuery("SELECT last_insert_rowid()");
    return rowid ? parseInt(rowid, 10) : null;
  } catch {
    return null;
  }
}

/** Record a shadow run start. */
function recordShadowRunStart(
  runId: string,
  repo: string,
  archetype: string,
  budgetCap: number,
  taskCount: number,
  crewCount: number,
): void {
  const now = new Date().toISOString();
  dbExec(
    `INSERT OR IGNORE INTO shadow_runs (id, repo, archetype, started_at, budget_cap, task_count, crew_count, status) VALUES ("${runId}", "${repo}", "${archetype}", "${now}", ${budgetCap}, ${taskCount}, ${crewCount}, "running")`,
  );
}

/** Update a shadow run on completion. */
function recordShadowRunEnd(
  runId: string,
  status: string,
  actualCost: number,
): void {
  const now = new Date().toISOString();
  dbExec(
    `UPDATE shadow_runs SET status="${status}", actual_cost=${actualCost}, completed_at="${now}" WHERE id="${runId}"`,
  );
}

/** Record a shadow attempt for a crew+task pair. */
function recordShadowAttempt(
  runId: string,
  genotypeId: string,
  task: Task,
  worktreePath: string,
  attempt: AttemptResult,
  evaluationId: number | null,
): void {
  const now = new Date().toISOString();
  const completedAt = new Date().toISOString();
  const status = attempt.agent_success ? "completed" : "failed";
  const evalIdVal = evaluationId !== null ? String(evaluationId) : "NULL";
  const descEscaped = task.description.replace(/"/g, '""');
  dbExec(
    `INSERT INTO shadow_attempts (run_id, genotype_id, task_hash, task_desc, worktree_path, evaluation_id, cost_usd, duration_sec, created_at, completed_at, status) VALUES ("${runId}", "${genotypeId}", "${task.hash}", "${descEscaped}", "${worktreePath}", ${evalIdVal}, ${attempt.cost_usd}, ${attempt.duration_sec}, "${now}", "${completedAt}", "${status}")`,
  );
}

interface CrewConfigWithManifest extends CrewConfig {
  mutation_manifest?: MutationManifest;
}

function buildCrewConfigs(
  champion: Genotype,
  opts: ShadowRunOptions,
): CrewConfigWithManifest[] {
  const configs: CrewConfigWithManifest[] = [
    { genotype: champion, label: "champion" },
  ];

  if (opts.varianceCheck) {
    // Variance check: all crews use the same champion genotype
    const extraCrews = Math.max(1, opts.crews - 1);
    for (let i = 0; i < extraCrews; i++) {
      configs.push({
        genotype: champion,
        label: `champion-replica-${i + 1}`,
      });
    }
  } else {
    // Normal mode: generate mutants
    const mutantCount = Math.max(1, opts.crews - 1);
    for (let i = 0; i < mutantCount; i++) {
      const mutationOpts = opts.seed !== null ? { seed: opts.seed + i } : {};
      const result = mutate(champion, mutationOpts);
      configs.push({
        genotype: result.genotype,
        label: `mutant-${i + 1}`,
        mutation_manifest: result.manifest,
      });
    }
  }

  return configs;
}

function makePromotionDecision(
  crewResults: CrewResult[],
  forceFullPareto = false,
): PromotionDecision {
  const champion = crewResults.find((c) => c.label === "champion");
  if (!champion) {
    return {
      should_promote: false,
      winner_label: "champion",
      sign_test: null,
      pareto_dominance: null,
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

    const n = Math.min(candidateScores.length, championScores.length);
    const usePareto = n >= 20 || forceFullPareto;

    if (usePareto) {
      // Phase 2: per-dimension Pareto dominance test
      if (forceFullPareto && n < 20) {
        return {
          should_promote: false,
          winner_label: "champion",
          sign_test: null,
          pareto_dominance: null,
          reason: `--full-pareto requires N >= 20 tasks, got ${n}`,
        };
      }

      const paretoResult = runParetoDominanceTest({
        candidate_scores: candidateScores.slice(0, n),
        champion_scores: championScores.slice(0, n),
        alpha: 0.05,
      });

      if (paretoResult.passed) {
        return {
          should_promote: true,
          winner_label: mutant.label,
          sign_test: null,
          pareto_dominance: paretoResult,
          reason: `${mutant.label} (${mutant.genotype_id}) passed per-dimension Pareto dominance test (N=${n})`,
        };
      }

      // Find which dimensions failed
      const failedDims = Object.entries(paretoResult.dimension_results)
        .filter(([, r]) => !r.passed)
        .map(([d, r]) => `${d}(p=${r.p_value})`)
        .join(", ");

      return {
        should_promote: false,
        winner_label: "champion",
        sign_test: null,
        pareto_dominance: paretoResult,
        reason: `Champion retains title. ${mutant.label} failed Pareto dominance on: ${failedDims}`,
      };
    }

    // Phase 1: aggregate sign test (N < 20)
    const signTestResult = runSignTest({
      candidate_scores: candidateScores,
      champion_scores: championScores,
    });

    if (signTestResult.passed) {
      return {
        should_promote: true,
        winner_label: mutant.label,
        sign_test: signTestResult,
        pareto_dominance: null,
        reason: `${mutant.label} (${mutant.genotype_id}) passed sign test with p=${signTestResult.p_value}`,
      };
    }

    return {
      should_promote: false,
      winner_label: "champion",
      sign_test: signTestResult,
      pareto_dominance: null,
      reason: `Champion retains title. ${mutant.label} sign test p=${signTestResult.p_value} (need < 0.05)`,
    };
  }

  return {
    should_promote: false,
    winner_label: "champion",
    sign_test: null,
    pareto_dominance: null,
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
      pareto_dominance: null,
      reason: "Dry run — no actual execution",
    },
    total_cost_usd: 0,
    total_duration_sec: 0,
  };
}
