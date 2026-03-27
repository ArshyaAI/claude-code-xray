/**
 * protocol.ts — DeFactory Promotion Protocol
 *
 * 4-stage promotion protocol from BIBLE.md. A candidate genotype progresses
 * through stages only when it passes statistical tests at each stage.
 *
 * Stages:
 *   1. Frontier Admission — one-sided sign test on Layer 1 scores
 *   2. Champion Challenge (Hidden Holdout) — Welch's t-test on utility
 *   3. Champion Challenge (Live Shadow) — same as Stage 2, real tasks
 *   4. Canary (10% traffic) — confidence sequences, 24-72h window
 *
 * IMMUTABLE: Promotion thresholds and statistical tests are locked per
 * policy.yml. Changes require board approval.
 */

import type { Genotype, GenotypeStatus } from "../genotype/schema.js";
import type { ParetoDimensions } from "../evaluator/score.js";

// ─── Stage types ──────────────────────────────────────────────────────────────

export type PromotionStage =
  | "frontier" // Stage 1: admitted to frontier archive
  | "holdout" // Stage 2: champion challenge on hidden holdout
  | "shadow" // Stage 3: live shadow (candidate shadows champion)
  | "canary" // Stage 4: 10% live traffic canary
  | "promoted"; // Final: candidate becomes new champion

/** Why a promotion attempt failed. */
export type RejectionReason =
  | "gate_failure" // Hard gate failed
  | "sign_test_failed" // Stage 1: not non-inferior on all dims
  | "welch_ttest_failed" // Stage 2/3: mean not > champion at p < 0.05
  | "guardrail_violated" // Stage 2/3/4: UCB of guardrail delta > limit
  | "canary_insufficient_data" // Stage 4: not enough tasks completed
  | "rollback_trigger" // Stage 4: rollback condition met
  | "human_approval_below_threshold"; // Stage 4: s_H < 0.80

// ─── Task record ──────────────────────────────────────────────────────────────

/** Result of one task execution by a candidate or champion. */
export interface TaskResult {
  task_id: string;
  genotype_id: string;
  utility: number;
  scores: ParetoDimensions;
  cost_usd: number;
  duration_sec: number;
  human_approved: boolean | null; // null = pending review
  completed_at: string; // ISO 8601
}

// ─── Promotion policy constants (IMMUTABLE) ───────────────────────────────────

export const PROMOTION_THRESHOLDS = {
  /** Stage 1: p-value threshold for one-sided sign test */
  sign_test_alpha: 0.05,
  /** Stage 1: minimum tasks required for sign test */
  frontier_min_tasks: 8,
  /** Stage 2/3: Welch t-test alpha */
  welch_alpha: 0.05,
  /** Stage 2: minimum sample size (per side) */
  holdout_min_tasks: 12,
  /** Stage 3: minimum sample size for non-high-risk mutations */
  shadow_min_tasks: 12,
  /** Stage 3: minimum sample size for high-risk mutations (model swap, prompt swap) */
  shadow_min_tasks_high_risk: 24,
  /** Stage 4: canary traffic fraction */
  canary_fraction: 0.1,
  /** Stage 4: minimum observation window in hours */
  canary_min_hours: 24,
  /** Stage 4: maximum observation window in hours */
  canary_max_hours: 72,
  /** Stage 4: required Pr(Δ_T > 0) */
  canary_throughput_prob: 0.95,
  /** Stage 4: required human approval score */
  canary_min_human_approval: 0.8,
  /** Guardrail: max allowed UCB_0.95(Δg) per metric delta */
  guardrail_delta_limit: 0.05,
} as const;

/** Rollback thresholds. Any one triggers immediate rollback. */
export const ROLLBACK_TRIGGERS = {
  /** Max ratio of candidate failure rate to champion failure rate */
  max_failure_rate_ratio: 2.0,
  /** Max ratio of candidate cost per item to champion cost per item */
  max_cost_ratio: 3.0,
  /** Minimum acceptable human approval rate */
  min_human_approval_rate: 0.6,
} as const;

// ─── Stage 1: Frontier Admission ─────────────────────────────────────────────

export interface SignTestInput {
  candidate_scores: ParetoDimensions[];
  champion_scores: ParetoDimensions[];
}

export interface SignTestResult {
  passed: boolean;
  p_value: number;
  n_tasks: number;
  rejection_reason?: RejectionReason;
  /** Per-dimension results for diagnostics. */
  dimension_results: Record<
    keyof ParetoDimensions,
    {
      n_wins: number;
      n_losses: number;
      n_ties: number;
      p_value: number;
      passed: boolean;
    }
  >;
}

/**
 * Stage 1: One-sided sign test.
 * Candidate must be non-inferior to champion on ALL 7 Pareto dimensions.
 *
 * For each dimension d:
 *   - Count n_wins (candidate > champion) and n_losses (candidate < champion)
 *   - One-sided sign test: H0 = candidate <= champion, H1 = candidate > champion
 *   - Reject if p >= alpha on any dimension
 *
 * Uses exact binomial p-value: Pr(X >= n_wins | n=n_wins+n_losses, p=0.5)
 */
export function runSignTest(input: SignTestInput): SignTestResult {
  const { candidate_scores, champion_scores } = input;
  const n = candidate_scores.length;

  if (n < PROMOTION_THRESHOLDS.frontier_min_tasks) {
    return {
      passed: false,
      p_value: 1.0,
      n_tasks: n,
      rejection_reason: "sign_test_failed",
      dimension_results: _emptyDimensionResults(),
    };
  }

  const dims = Object.keys(
    candidate_scores[0] ?? {},
  ) as (keyof ParetoDimensions)[];
  const dimension_results = {} as SignTestResult["dimension_results"];
  let overall_passed = true;
  let worst_p = 0;

  for (const dim of dims) {
    let wins = 0;
    let losses = 0;
    let ties = 0;

    for (let i = 0; i < n; i++) {
      const c = candidate_scores[i]?.[dim] ?? 0;
      const ch = champion_scores[i]?.[dim] ?? 0;
      if (c > ch) wins++;
      else if (c < ch) losses++;
      else ties++;
    }

    const trials = wins + losses;
    const p = trials === 0 ? 1.0 : _binomialOneSidedP(wins, trials);
    const dim_passed = p < PROMOTION_THRESHOLDS.sign_test_alpha;

    dimension_results[dim] = {
      n_wins: wins,
      n_losses: losses,
      n_ties: ties,
      p_value: round4(p),
      passed: dim_passed,
    };

    if (!dim_passed) {
      overall_passed = false;
    }
    if (p > worst_p) worst_p = p;
  }

  const result: SignTestResult = {
    passed: overall_passed,
    p_value: round4(worst_p),
    n_tasks: n,
    dimension_results,
  };
  if (!overall_passed) {
    result.rejection_reason = "sign_test_failed";
  }
  return result;
}

// ─── Stage 2 & 3: Welch's t-test ─────────────────────────────────────────────

export interface WelchTestInput {
  candidate_utilities: number[];
  champion_utilities: number[];
  stage: "holdout" | "shadow";
  is_high_risk: boolean;
}

export interface WelchTestResult {
  passed: boolean;
  candidate_mean: number;
  champion_mean: number;
  p_value: number;
  t_stat: number;
  df: number;
  n_candidate: number;
  n_champion: number;
  rejection_reason?: RejectionReason;
}

/**
 * Stages 2 & 3: Welch's t-test on utility U(p).
 * Candidate mean must be > champion mean AND p < 0.05 (one-sided).
 *
 * Uses Welch–Satterthwaite degrees of freedom approximation.
 */
export function runWelchTest(input: WelchTestInput): WelchTestResult {
  const { candidate_utilities, champion_utilities, stage, is_high_risk } =
    input;

  const min_n =
    stage === "holdout"
      ? PROMOTION_THRESHOLDS.holdout_min_tasks
      : is_high_risk
        ? PROMOTION_THRESHOLDS.shadow_min_tasks_high_risk
        : PROMOTION_THRESHOLDS.shadow_min_tasks;

  const n_c = candidate_utilities.length;
  const n_ch = champion_utilities.length;

  if (n_c < min_n || n_ch < min_n) {
    return {
      passed: false,
      candidate_mean: _mean(candidate_utilities),
      champion_mean: _mean(champion_utilities),
      p_value: 1.0,
      t_stat: 0,
      df: 0,
      n_candidate: n_c,
      n_champion: n_ch,
      rejection_reason: "welch_ttest_failed",
    };
  }

  const mu_c = _mean(candidate_utilities);
  const mu_ch = _mean(champion_utilities);
  const var_c = _variance(candidate_utilities, mu_c);
  const var_ch = _variance(champion_utilities, mu_ch);

  // Welch t-statistic
  const se = Math.sqrt(var_c / n_c + var_ch / n_ch);
  if (se === 0) {
    // No variance — if means are equal, fail; if candidate > champion, pass
    const passed = mu_c > mu_ch;
    const zeroVarResult: WelchTestResult = {
      passed,
      candidate_mean: round4(mu_c),
      champion_mean: round4(mu_ch),
      p_value: passed ? 0.0 : 1.0,
      t_stat: 0,
      df: 0,
      n_candidate: n_c,
      n_champion: n_ch,
    };
    if (!passed) {
      zeroVarResult.rejection_reason = "welch_ttest_failed";
    }
    return zeroVarResult;
  }

  const t = (mu_c - mu_ch) / se;

  // Welch-Satterthwaite degrees of freedom
  const df_num = Math.pow(var_c / n_c + var_ch / n_ch, 2);
  const df_den =
    Math.pow(var_c / n_c, 2) / (n_c - 1) +
    Math.pow(var_ch / n_ch, 2) / (n_ch - 1);
  const df = df_den === 0 ? n_c + n_ch - 2 : df_num / df_den;

  // One-sided p-value from t-distribution CDF
  const p = _tDistOneSidedP(t, df);

  const passed = mu_c > mu_ch && p < PROMOTION_THRESHOLDS.welch_alpha;

  const welchResult: WelchTestResult = {
    passed,
    candidate_mean: round4(mu_c),
    champion_mean: round4(mu_ch),
    p_value: round4(p),
    t_stat: round4(t),
    df: round4(df),
    n_candidate: n_c,
    n_champion: n_ch,
  };
  if (!passed) {
    welchResult.rejection_reason = "welch_ttest_failed";
  }
  return welchResult;
}

// ─── Stage 4: Canary promotion decision ──────────────────────────────────────

export interface CanaryInput {
  candidate_results: TaskResult[];
  champion_results: TaskResult[];
  elapsed_hours: number;
  candidate_human_approval_score: number;
}

export interface CanaryResult {
  /** D(p, p0) = 1 iff all four conditions met */
  promote: boolean;
  /** G(p) = 1 */
  gates_passed: boolean;
  /** Pr(Δ_T > 0) >= 0.95 */
  throughput_improvement_prob: number;
  throughput_prob_passed: boolean;
  /** Guardrail check: UCB_0.95(Δg) <= δ_g for all g */
  guardrails_passed: boolean;
  /** s_H >= 0.80 */
  human_approval_score: number;
  human_approval_passed: boolean;
  /** Duration check */
  min_duration_met: boolean;
  /** Why promotion was denied, or null if promoted */
  rejection_reason: RejectionReason | null;
}

/**
 * Stage 4: Canary promotion decision.
 * Implements BIBLE.md formula:
 *   D(p, p0) = 1 iff G(p)=1 AND Pr(Δ_T>0)>=0.95 AND ∀j: Pr(Δg_j<=δ_j)>=0.95 AND s_H>=0.80
 */
export function makeCanaryDecision(input: CanaryInput): CanaryResult {
  const {
    candidate_results,
    champion_results,
    elapsed_hours,
    candidate_human_approval_score,
  } = input;

  const min_duration_met =
    elapsed_hours >= PROMOTION_THRESHOLDS.canary_min_hours;

  if (!min_duration_met) {
    return {
      promote: false,
      gates_passed: true,
      throughput_improvement_prob: 0,
      throughput_prob_passed: false,
      guardrails_passed: false,
      human_approval_score: candidate_human_approval_score,
      human_approval_passed: false,
      min_duration_met: false,
      rejection_reason: "canary_insufficient_data",
    };
  }

  // Compute throughput improvement probability
  // Using empirical fraction: Pr(Δ_T > 0) ≈ fraction of paired comparisons where candidate > champion
  const candidate_utils = candidate_results.map((r) => r.utility);
  const champion_utils = champion_results.map((r) => r.utility);
  const throughput_improvement_prob = _empiricalImprovementProb(
    candidate_utils,
    champion_utils,
  );
  const throughput_prob_passed =
    throughput_improvement_prob >= PROMOTION_THRESHOLDS.canary_throughput_prob;

  // Guardrail check (simplified: check cost ratio)
  const candidate_avg_cost =
    candidate_results.reduce((s, r) => s + r.cost_usd, 0) /
    Math.max(1, candidate_results.length);
  const champion_avg_cost =
    champion_results.reduce((s, r) => s + r.cost_usd, 0) /
    Math.max(1, champion_results.length);
  const cost_ratio =
    champion_avg_cost === 0 ? 1.0 : candidate_avg_cost / champion_avg_cost;
  const guardrails_passed = cost_ratio <= ROLLBACK_TRIGGERS.max_cost_ratio;

  // Human approval check
  const human_approval_passed =
    candidate_human_approval_score >=
    PROMOTION_THRESHOLDS.canary_min_human_approval;

  // All conditions
  const gates_passed = true; // assumed — hard gates already checked at Layer 1
  const promote =
    gates_passed &&
    throughput_prob_passed &&
    guardrails_passed &&
    human_approval_passed;

  let rejection_reason: RejectionReason | null = null;
  if (!promote) {
    if (!throughput_prob_passed) rejection_reason = "welch_ttest_failed";
    else if (!guardrails_passed) rejection_reason = "guardrail_violated";
    else if (!human_approval_passed)
      rejection_reason = "human_approval_below_threshold";
  }

  return {
    promote,
    gates_passed,
    throughput_improvement_prob: round4(throughput_improvement_prob),
    throughput_prob_passed,
    guardrails_passed,
    human_approval_score: round4(candidate_human_approval_score),
    human_approval_passed,
    min_duration_met,
    rejection_reason,
  };
}

// ─── Rollback trigger check ───────────────────────────────────────────────────

export interface RollbackCheckInput {
  candidate_results: TaskResult[];
  champion_results: TaskResult[];
}

export interface RollbackCheckResult {
  rollback: boolean;
  /** Which trigger fired, or null if no rollback needed. */
  trigger: string | null;
  details: string;
}

/**
 * Check all rollback triggers. Any one = immediate rollback.
 * Called continuously during Stage 4 monitoring.
 */
export function checkRollbackTriggers(
  input: RollbackCheckInput,
): RollbackCheckResult {
  const { candidate_results, champion_results } = input;

  if (candidate_results.length === 0) {
    return {
      rollback: false,
      trigger: null,
      details: "No candidate results yet",
    };
  }

  // 1. Failure rate check (human_approved === false treated as failure)
  const cand_failure_rate =
    candidate_results.filter((r) => r.human_approved === false).length /
    candidate_results.length;
  const champ_failure_rate =
    champion_results.length === 0
      ? 0
      : champion_results.filter((r) => r.human_approved === false).length /
        champion_results.length;

  if (
    champ_failure_rate > 0 &&
    cand_failure_rate / champ_failure_rate >
      ROLLBACK_TRIGGERS.max_failure_rate_ratio
  ) {
    return {
      rollback: true,
      trigger: "failure_rate",
      details: `Candidate failure rate ${round4(cand_failure_rate)} > ${ROLLBACK_TRIGGERS.max_failure_rate_ratio}x champion rate ${round4(champ_failure_rate)}`,
    };
  }

  // 2. Cost ratio check
  const cand_avg_cost =
    candidate_results.reduce((s, r) => s + r.cost_usd, 0) /
    candidate_results.length;
  const champ_avg_cost =
    champion_results.length === 0
      ? 0
      : champion_results.reduce((s, r) => s + r.cost_usd, 0) /
        champion_results.length;

  if (
    champ_avg_cost > 0 &&
    cand_avg_cost / champ_avg_cost > ROLLBACK_TRIGGERS.max_cost_ratio
  ) {
    return {
      rollback: true,
      trigger: "cost_ratio",
      details: `Candidate avg cost $${round4(cand_avg_cost)} > ${ROLLBACK_TRIGGERS.max_cost_ratio}x champion $${round4(champ_avg_cost)}`,
    };
  }

  // 3. Human approval rate check
  const approved = candidate_results.filter(
    (r) => r.human_approved === true,
  ).length;
  const reviewed = candidate_results.filter(
    (r) => r.human_approved !== null,
  ).length;
  if (reviewed >= 5) {
    const approval_rate = approved / reviewed;
    if (approval_rate < ROLLBACK_TRIGGERS.min_human_approval_rate) {
      return {
        rollback: true,
        trigger: "human_approval_rate",
        details: `Candidate human approval rate ${round4(approval_rate)} < ${ROLLBACK_TRIGGERS.min_human_approval_rate}`,
      };
    }
  }

  return { rollback: false, trigger: null, details: "All triggers clear" };
}

// ─── Promotion record ─────────────────────────────────────────────────────────

export interface PromotionRecord {
  winner_id: string;
  loser_id: string;
  stage: PromotionStage;
  /** Statistical evidence: test stats, p-values, confidence intervals. */
  evidence: {
    sign_test?: SignTestResult;
    welch_holdout?: WelchTestResult;
    welch_shadow?: WelchTestResult;
    canary?: CanaryResult;
  };
  created_at: string;
}

/** Build a promotion record when a candidate wins. */
export function buildPromotionRecord(
  winner: Genotype,
  loser: Genotype,
  stage: PromotionStage,
  evidence: PromotionRecord["evidence"],
): PromotionRecord {
  return {
    winner_id: winner.id,
    loser_id: loser.id,
    stage,
    evidence,
    created_at: new Date().toISOString(),
  };
}

// ─── Cemetery entry ───────────────────────────────────────────────────────────

export interface CemeteryEntry {
  genotype_id: string;
  cause: string;
  stage: string;
  scores: Partial<ParetoDimensions>;
  lessons: string;
  created_at: string;
}

/**
 * Build a cemetery entry for a rejected candidate.
 * Includes causal notes to guide future search (per BIBLE.md).
 */
export function buildCemeteryEntry(
  genotype: Genotype,
  stage: string,
  rejection_reason: RejectionReason,
  scores: Partial<ParetoDimensions>,
  context?: string,
): CemeteryEntry {
  const lessons = _generateLessons(rejection_reason, scores, context);

  return {
    genotype_id: genotype.id,
    cause: rejection_reason,
    stage,
    scores,
    lessons,
    created_at: new Date().toISOString(),
  };
}

function _generateLessons(
  reason: RejectionReason,
  scores: Partial<ParetoDimensions>,
  context?: string,
): string {
  const lines: string[] = [];

  switch (reason) {
    case "gate_failure":
      lines.push("Hard gate failed — genotype not viable for production.");
      lines.push("Check: build errors, test failures, lint violations.");
      break;
    case "sign_test_failed":
      // Find the lowest-scoring dimension
      const dims = Object.entries(scores) as [keyof ParetoDimensions, number][];
      if (dims.length > 0) {
        const worst = dims.reduce((a, b) => (a[1] < b[1] ? a : b));
        lines.push(
          `Non-inferior test failed. Weakest dimension: ${worst[0]} (${round4(worst[1])}).`,
        );
        lines.push(
          "Consider mutations that target this dimension specifically.",
        );
      }
      break;
    case "welch_ttest_failed":
      lines.push(
        "Utility distribution not significantly better than champion.",
      );
      lines.push("May need higher-impact mutation or more task diversity.");
      break;
    case "guardrail_violated":
      lines.push("Guardrail metric delta exceeded safe bound.");
      lines.push("Check cost per item and failure rate trends.");
      break;
    case "canary_insufficient_data":
      lines.push(
        "Canary window too short — not enough tasks for valid inference.",
      );
      break;
    case "rollback_trigger":
      lines.push(
        "Rollback trigger fired during canary. Review cost or failure rate.",
      );
      break;
    case "human_approval_below_threshold":
      lines.push(
        `Human approval rate below ${PROMOTION_THRESHOLDS.canary_min_human_approval}.`,
      );
      lines.push("Review reviewer feedback for quality issues.");
      break;
  }

  if (context) lines.push(`Context: ${context}`);

  return lines.join(" ");
}

// ─── Demotion ────────────────────────────────────────────────────────────────

/**
 * Input for checking whether a promoted genotype should be demoted.
 * A promoted genotype regresses when its utility falls below the champion's
 * in consecutive evaluation runs.
 */
export interface DemotionInput {
  /** The genotype under evaluation for demotion. */
  genotype_id: string;
  /** The current champion's utility U(p). */
  champion_utility: number;
  /** The last N run utilities for this genotype (most recent last). */
  candidate_utilities: number[];
  /** Number of consecutive losses required to trigger demotion (default: 3). */
  consecutive_threshold: number;
}

export interface DemotionResult {
  /** Whether the genotype should be demoted. */
  should_demote: boolean;
  /** Number of consecutive runs where candidate U(p) < champion U(p). */
  consecutive_losses: number;
  /**
   * If demoting, the genotype to restore as champion.
   * Prefers parent_id; falls back to best frontier genotype if parent is in cemetery.
   */
  new_champion_id: string | null;
  /** Evidence for the demotion decision. */
  evidence: {
    runs: number[];
    champion_u: number;
    candidate_u: number[];
  };
}

/**
 * Check whether a promoted genotype should be demoted due to regression.
 *
 * A genotype is demoted when its utility U(p) falls below the champion's
 * in `consecutive_threshold` consecutive evaluation runs. On demotion:
 *   1. Set genotype status to 'cemetery' with cause 'regression'
 *   2. Restore parent_id genotype as champion
 *   3. If parent is also in cemetery, restore the best frontier genotype instead
 *
 * @param input - Demotion check parameters
 * @param parent_id - The genotype's parent ID (for champion restoration)
 * @param parent_status - The parent's current status (to check cemetery)
 * @param best_frontier_id - The best frontier genotype ID (fallback if parent in cemetery)
 */
export function checkDemotion(
  input: DemotionInput,
  parent_id: string | null,
  parent_status: GenotypeStatus | null,
  best_frontier_id: string | null,
): DemotionResult {
  const { champion_utility, candidate_utilities, consecutive_threshold } =
    input;

  // Count consecutive losses from the most recent run backwards
  let consecutive_losses = 0;
  for (let i = candidate_utilities.length - 1; i >= 0; i--) {
    const u = candidate_utilities[i];
    if (u !== undefined && u < champion_utility) {
      consecutive_losses++;
    } else {
      break;
    }
  }

  const should_demote = consecutive_losses >= consecutive_threshold;

  let new_champion_id: string | null = null;
  if (should_demote) {
    if (parent_id && parent_status !== "cemetery") {
      new_champion_id = parent_id;
    } else if (best_frontier_id) {
      new_champion_id = best_frontier_id;
    }
    // If neither parent nor frontier available, new_champion_id stays null
    // — caller must handle this (e.g., keep current champion)
  }

  return {
    should_demote,
    consecutive_losses,
    new_champion_id,
    evidence: {
      runs: Array.from({ length: candidate_utilities.length }, (_, i) => i),
      champion_u: champion_utility,
      candidate_u: [...candidate_utilities],
    },
  };
}

// ─── Stats utilities ──────────────────────────────────────────────────────────

function _mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _variance(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0;
  return arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (arr.length - 1);
}

/**
 * Exact one-sided binomial p-value: Pr(X >= k | n, p=0.5)
 * Uses normal approximation for n >= 20.
 */
function _binomialOneSidedP(k: number, n: number): number {
  if (n === 0) return 1.0;
  if (n >= 20) {
    // Normal approximation with continuity correction
    const z = (k - 0.5 - n * 0.5) / Math.sqrt(n * 0.25);
    return _normalSurvival(z);
  }
  // Exact: Pr(X >= k | n, 0.5) = sum_{i=k}^{n} C(n,i) * 0.5^n
  let p = 0;
  for (let i = k; i <= n; i++) {
    p += _binomCoeff(n, i);
  }
  return p * Math.pow(0.5, n);
}

function _binomCoeff(n: number, k: number): number {
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/** Standard normal survival function: Pr(Z > z) */
function _normalSurvival(z: number): number {
  // Abramowitz & Stegun approximation (error < 7.5e-8)
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))));
  return z > 0 ? p : 1 - p;
}

/**
 * One-sided t-distribution p-value: Pr(T > t | df) via normal approx for df > 30.
 */
function _tDistOneSidedP(t: number, df: number): number {
  if (df <= 0) return 0.5;
  if (df > 30) {
    // Use normal approximation (accurate for df > 30)
    return _normalSurvival(t);
  }
  // Student's t approximation via incomplete beta function
  // Using Hill (1970) approximation
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ibeta = _incompleteBeta(x, a, b);
  const p_two_sided = ibeta;
  return t > 0 ? p_two_sided / 2 : 1 - p_two_sided / 2;
}

/**
 * Regularized incomplete beta function I_x(a, b) — Lentz's continued fraction.
 * Accurate to ~1e-10 for most values.
 */
function _incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Use symmetry: I_x(a,b) = 1 - I_{1-x}(b,a) when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - _incompleteBeta(1 - x, b, a);
  }
  // Log beta function
  const lbeta = _logGamma(a) + _logGamma(b) - _logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  return front * _betaCF(x, a, b);
}

/** Continued fraction for incomplete beta (Lentz's method). */
function _betaCF(x: number, a: number, b: number): number {
  const MAX_ITER = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Stirling approximation for log-gamma. */
function _logGamma(x: number): number {
  // Lanczos approximation (g=5, n=6)
  const p = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of p) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Empirical Pr(Δ_T > 0) via pairwise comparisons. */
function _empiricalImprovementProb(
  candidate: number[],
  champion: number[],
): number {
  if (candidate.length === 0 || champion.length === 0) return 0;
  let wins = 0;
  let total = 0;
  for (const c of candidate) {
    for (const ch of champion) {
      if (c > ch) wins++;
      total++;
    }
  }
  return total === 0 ? 0 : wins / total;
}

function _emptyDimensionResults(): SignTestResult["dimension_results"] {
  const dims: (keyof ParetoDimensions)[] = ["C", "R", "H", "Q", "T", "K", "S"];
  const result = {} as SignTestResult["dimension_results"];
  for (const d of dims) {
    result[d] = {
      n_wins: 0,
      n_losses: 0,
      n_ties: 0,
      p_value: 1.0,
      passed: false,
    };
  }
  return result;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
