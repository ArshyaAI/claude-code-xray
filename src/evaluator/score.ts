/**
 * score.ts — DeFactory Layer 1 Evaluator (R_search)
 *
 * Typed implementation of the 7-dimension Pareto scoring function from BIBLE.md.
 * This is the "cheap public score" that all explorers optimize against.
 *
 * IMMUTABLE: Scoring formulas and weights are locked. Changes require board
 * approval. Matches the constants in evo/evaluator/score-layer1.js exactly.
 *
 * Formula references (BIBLE.md, "Layer 1: R_search"):
 *   C: exp(-α_L * L) * exp(-α_M * M) * σ(α_D * (D - τ_D))
 *   R: w_cov * cov_Δ + w_mut * mut + w_hid * hcov
 *   H: Pr(θ_p ≥ τ_H | data) via Beta(α₀+A, β₀+R) posterior
 *   Q: exp(-λ * v(p) / max(1, KLOC))
 *   T: items_completed / time_hours, normalized to [0,1]
 *   K: 1 - min(1, cost_per_item / budget_per_item)
 *   S: ∏_j 1[guardrail_j passes]
 */

import type { Genotype } from "../genotype/schema.js";

// ─── Stage ────────────────────────────────────────────────────────────────────

export type EvalStage = "search" | "hidden" | "shadow" | "canary";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface HardGates {
  G_build: boolean;
  G_test: boolean;
  G_lint: boolean;
  G_review: boolean;
  G_safe: boolean;
}

/**
 * Raw metrics collected by the QA agent or computed from workspace analysis.
 * All are required; callers should use sensible defaults when values are
 * unavailable (see BIBLE.md defaults in evaluate.sh).
 */
export interface EvalMetrics {
  /** L — weighted lint violation count (0 = perfect, higher = worse) */
  lint_violations_weighted: number;
  /** M — cyclomatic complexity penalty value */
  cyclomatic_complexity: number;
  /** D — documentation coverage on changed surfaces [0,1] */
  doc_coverage: number;
  /** cov_Δ — diff-hunk test coverage [0,1] */
  diff_hunk_coverage: number;
  /** mut — mutation testing score [0,1] */
  mutation_score: number;
  /** hcov — hidden holdout pass rate [0,1]; 0 if stage=search */
  hidden_holdout_pass_rate: number;
  /** A — count of human approvals for this genotype */
  human_approvals: number;
  /** R — count of human rejections for this genotype */
  human_rejections: number;
  /** v(p) — convention violations count */
  convention_violations: number;
  /** KLOC of changed code (used to normalize convention violations) */
  kloc: number;
  /** Items completed in this evaluation batch */
  items_completed: number;
  /** Wall-clock time for items_completed (hours) */
  time_hours: number;
  /** Normalization ceiling for throughput score */
  throughput_max: number;
  /** Actual cost in USD per item */
  cost_per_item_usd: number;
  /** Budget ceiling in USD per item (from genotype.budget) */
  budget_per_item_usd: number;
  /** Whether all safety guardrails passed (binary) */
  guardrails_passed: boolean;
}

export interface ScoreInput {
  genotype_id: string;
  task_id: string;
  stage: EvalStage;
  gates: HardGates;
  metrics: EvalMetrics;
}

// ─── Output types ─────────────────────────────────────────────────────────────

/** The 7 Pareto scoring dimensions, each in [0,1]. */
export interface ParetoDimensions {
  /** Code Quality */
  C: number;
  /** Test Reliability */
  R: number;
  /** Human Approval */
  H: number;
  /** Convention Adherence */
  Q: number;
  /** Throughput */
  T: number;
  /** Cost Efficiency */
  K: number;
  /** Safety */
  S: number;
}

export interface ScoreResult {
  genotype_id: string;
  task_id: string;
  stage: EvalStage;
  gates_passed: boolean;
  /** Null if gates failed. */
  scores: ParetoDimensions | null;
  /** Weighted utility U(p). 0 if gates failed. */
  utility: number;
  /** True if this candidate is dominated by the champion on all dimensions. */
  pareto_dominated: boolean;
  /** Reason for rejection, or null if accepted. */
  reject_reason: string | null;
}

// ─── Policy constants (IMMUTABLE — mirrors evo/evaluator/score-layer1.js) ─────

/** Tie-break utility weights. Default per BIBLE.md. Never learned by agents. */
export const WEIGHTS: Readonly<Record<keyof ParetoDimensions, number>> = {
  C: 0.15,
  R: 0.2,
  H: 0.15,
  Q: 0.1,
  T: 0.15,
  K: 0.15,
  S: 0.1,
} as const;

/** Layer 1 formula parameters. IMMUTABLE per policy.yml. */
export const PARAMS = {
  code_quality: {
    alpha_L: 0.1, // lint penalty rate
    alpha_M: 0.05, // complexity penalty rate
    alpha_D: 2.0, // doc coverage sharpness
    tau_D: 0.5, // doc coverage midpoint
  },
  test_reliability: {
    w_cov: 0.5, // diff-hunk coverage weight
    w_mut: 0.3, // mutation score weight
    w_hid: 0.2, // hidden holdout weight
  },
  human_approval: {
    alpha0: 1.0, // Beta prior alpha
    beta0: 1.0, // Beta prior beta
    tau_H: 0.7, // approval probability threshold
  },
  convention_adherence: {
    lambda: 1.0, // violation penalty rate
  },
} as const;

// Validate weights sum to 1.0
const weightSum = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`Utility weights must sum to 1.0, got ${weightSum}`);
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function betaPosteriorMean(
  alpha0: number,
  beta0: number,
  A: number,
  R: number,
): number {
  return (alpha0 + A) / (alpha0 + A + beta0 + R);
}

// ─── Hard gate evaluation ─────────────────────────────────────────────────────

export interface GateResult {
  passed: boolean;
  failed_gate: keyof HardGates | null;
}

/**
 * Evaluate all 5 hard gates.
 * G(p) = ∏_i 1[gate_i passes]
 * If any gate fails, G(p) = 0 — reject immediately.
 */
export function evaluateGates(gates: HardGates): GateResult {
  const required: (keyof HardGates)[] = [
    "G_build",
    "G_test",
    "G_lint",
    "G_review",
    "G_safe",
  ];
  for (const gate of required) {
    if (!gates[gate]) {
      return { passed: false, failed_gate: gate };
    }
  }
  return { passed: true, failed_gate: null };
}

// ─── Dimension scorers ────────────────────────────────────────────────────────

/**
 * C — Code Quality
 * s_C = exp(-α_L * L) * exp(-α_M * M) * σ(α_D * (D - τ_D))
 */
export function scoreCodeQuality(m: EvalMetrics): number {
  const { alpha_L, alpha_M, alpha_D, tau_D } = PARAMS.code_quality;
  const lint_factor = Math.exp(-alpha_L * m.lint_violations_weighted);
  const complexity_factor = Math.exp(-alpha_M * m.cyclomatic_complexity);
  const doc_factor = sigmoid(alpha_D * (m.doc_coverage - tau_D));
  return clamp(lint_factor * complexity_factor * doc_factor);
}

/**
 * R — Test Reliability
 * s_R = w_cov * cov_Δ + w_mut * mut + w_hid * hcov
 * (hcov=0 when stage=search since Layer 2 hasn't run)
 */
export function scoreTestReliability(m: EvalMetrics): number {
  const { w_cov, w_mut, w_hid } = PARAMS.test_reliability;
  return clamp(
    w_cov * m.diff_hunk_coverage +
      w_mut * m.mutation_score +
      w_hid * m.hidden_holdout_pass_rate,
  );
}

/**
 * H — Human Approval
 * Pr(θ_p ≥ τ_H | data) via Beta posterior, approximated via sigmoid.
 * s_H = σ(10 * (E[θ | A, R] - τ_H))
 */
export function scoreHumanApproval(m: EvalMetrics): number {
  const { alpha0, beta0, tau_H } = PARAMS.human_approval;
  const posteriorMean = betaPosteriorMean(
    alpha0,
    beta0,
    m.human_approvals,
    m.human_rejections,
  );
  return clamp(sigmoid(10 * (posteriorMean - tau_H)));
}

/**
 * Q — Convention Adherence
 * s_Q = exp(-λ * v(p) / max(1, KLOC))
 */
export function scoreConventionAdherence(m: EvalMetrics): number {
  const { lambda } = PARAMS.convention_adherence;
  return clamp(
    Math.exp((-lambda * m.convention_violations) / Math.max(1, m.kloc)),
  );
}

/**
 * T — Throughput
 * items_completed / time_hours, normalized to [0,1]
 */
export function scoreThroughput(m: EvalMetrics): number {
  const raw = m.items_completed / Math.max(0.01, m.time_hours);
  return clamp(raw / Math.max(0.01, m.throughput_max));
}

/**
 * K — Cost Efficiency
 * s_K = 1 - min(1, cost_per_item / budget_per_item)
 */
export function scoreCostEfficiency(m: EvalMetrics): number {
  return clamp(
    1 -
      Math.min(1, m.cost_per_item_usd / Math.max(0.01, m.budget_per_item_usd)),
  );
}

/**
 * S — Safety
 * Binary: 1.0 if all guardrails pass, 0.0 otherwise.
 * This is a post-gate check — gates already filter critical failures.
 */
export function scoreSafety(m: EvalMetrics): number {
  return m.guardrails_passed ? 1.0 : 0.0;
}

// ─── Utility (tie-break) ──────────────────────────────────────────────────────

/**
 * Weighted utility for tie-breaking Pareto-equivalent candidates.
 * U(p) = Σ_d w_d * s_d
 */
export function computeUtility(scores: ParetoDimensions): number {
  return (
    WEIGHTS["C"] * scores.C +
    WEIGHTS["R"] * scores.R +
    WEIGHTS["H"] * scores.H +
    WEIGHTS["Q"] * scores.Q +
    WEIGHTS["T"] * scores.T +
    WEIGHTS["K"] * scores.K +
    WEIGHTS["S"] * scores.S
  );
}

// ─── Pareto dominance check ───────────────────────────────────────────────────

/**
 * Returns true if `candidate` is strictly dominated by `champion` on
 * all 7 Pareto dimensions (champion >= candidate on every dim).
 *
 * If the champion dominates on all dims, the candidate adds nothing new
 * to the frontier archive.
 */
export function isParetodominated(
  candidate: ParetoDimensions,
  champion: ParetoDimensions,
): boolean {
  const dims = Object.keys(WEIGHTS) as (keyof ParetoDimensions)[];
  return dims.every((d) => champion[d] >= candidate[d]);
}

// ─── Main evaluate function ───────────────────────────────────────────────────

/**
 * Run the full Layer 1 evaluation pipeline.
 *
 * 1. Hard gates (G_build, G_test, G_lint, G_review, G_safe)
 * 2. 7-dimension Pareto scoring
 * 3. Tie-break utility computation
 * 4. Optional Pareto dominance check against champion scores
 *
 * @param input - Score input (genotype ID, task ID, stage, gates, metrics)
 * @param championScores - Optional champion's current scores for dominance check
 */
export function evaluate(
  input: ScoreInput,
  championScores?: ParetoDimensions,
): ScoreResult {
  const { genotype_id, task_id, stage, gates, metrics } = input;

  // Step 1: Hard gates
  const gateResult = evaluateGates(gates);
  if (!gateResult.passed) {
    return {
      genotype_id,
      task_id,
      stage,
      gates_passed: false,
      scores: null,
      utility: 0,
      pareto_dominated: true,
      reject_reason: `Hard gate failed: ${gateResult.failed_gate}`,
    };
  }

  // Step 2: Compute 7 Pareto dimensions
  const scores: ParetoDimensions = {
    C: scoreCodeQuality(metrics),
    R: scoreTestReliability(metrics),
    H: scoreHumanApproval(metrics),
    Q: scoreConventionAdherence(metrics),
    T: scoreThroughput(metrics),
    K: scoreCostEfficiency(metrics),
    S: scoreSafety(metrics),
  };

  // Step 3: Utility
  const utility = computeUtility(scores);

  // Step 4: Pareto dominance (only when champion scores are provided)
  const pareto_dominated =
    championScores !== undefined
      ? isParetodominated(scores, championScores)
      : false;

  return {
    genotype_id,
    task_id,
    stage,
    gates_passed: true,
    scores,
    utility: Math.round(utility * 10000) / 10000,
    pareto_dominated,
    reject_reason: null,
  };
}

// ─── Metrics default factory ──────────────────────────────────────────────────

/**
 * Returns safe default metrics for situations where real measurements
 * are unavailable (e.g., new workspace with no test infrastructure).
 * These are conservative — a genotype with default metrics will score
 * low but not catastrophically.
 */
export function defaultMetrics(
  overrides: Partial<EvalMetrics> = {},
): EvalMetrics {
  return {
    lint_violations_weighted: 0,
    cyclomatic_complexity: 1.0,
    doc_coverage: 0.3,
    diff_hunk_coverage: 0.5,
    mutation_score: 0.5,
    hidden_holdout_pass_rate: 0.0, // 0 for search stage
    human_approvals: 0,
    human_rejections: 0,
    convention_violations: 0,
    kloc: 1.0,
    items_completed: 1,
    time_hours: 1.0,
    throughput_max: 10.0,
    cost_per_item_usd: 0.5,
    budget_per_item_usd: 2.0,
    guardrails_passed: true,
    ...overrides,
  };
}

// ─── Convenience: extract budget metrics from genotype ───────────────────────

/**
 * Pull the budget ceiling from a genotype for use in metrics.
 * This ensures cost efficiency is evaluated against the genotype's own budget.
 */
export function budgetMetricsFromGenotype(
  g: Genotype,
): Pick<EvalMetrics, "budget_per_item_usd"> {
  return {
    budget_per_item_usd: g.budget.max_cost_per_task_usd,
  };
}
