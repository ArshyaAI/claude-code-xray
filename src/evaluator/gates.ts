/**
 * gates.ts — DeFactory Hard Gates
 *
 * Binary gate evaluators that must ALL pass before any Pareto scoring runs.
 * If G(p) = ∏_i 1[gate_i passes] = 0, the candidate is immediately rejected.
 *
 * Gates run in dependency order:
 *   G_build → G_test → G_lint → G_review → G_safe
 *
 * Each gate either passes (true) or fails with a reason string.
 * The evaluator calls these sequentially and stops at the first failure.
 */

import type { HardGates } from "./score.js";

// ─── Gate check input ─────────────────────────────────────────────────────────

export interface GateCheckInput {
  /** Path to the repository workspace being evaluated. */
  workspace_path: string;
  /** Optional: pre-computed cross-model review score [0, 100]. */
  review_score?: number;
  /** Minimum acceptable review score threshold (from genotype). */
  min_review_score: number;
  /** Optional: SAST findings count (critical severity). */
  critical_security_findings?: number;
  /**
   * Optional: override individual gate results (for testing / manual injection).
   * If a gate result is provided here, the runner skips executing it.
   */
  overrides?: Partial<Record<keyof HardGates, boolean>>;
}

export interface GateCheckResult {
  gate: keyof HardGates;
  passed: boolean;
  /** Reason for failure, or null if passed. */
  reason: string | null;
  /** Duration in milliseconds (approximate). */
  duration_ms: number;
}

export interface AllGatesResult {
  /** True if all 5 gates passed (G(p) = 1). */
  all_passed: boolean;
  /** The first gate that failed, or null if all passed. */
  first_failure: keyof HardGates | null;
  gates: Record<keyof HardGates, GateCheckResult>;
  /** Total duration across all gate checks. */
  total_duration_ms: number;
}

// ─── Individual gate definitions ──────────────────────────────────────────────

/**
 * G_build: Verifies the build command passes.
 *
 * In CI, this runs `npm run build` or `tsc --noEmit`.
 * In this TypeScript module, we expose the gate contract — the actual shell
 * execution is done by evo/evaluator/run-gates.sh. This function accepts
 * a pre-computed result (from CI output) and validates it.
 */
export function checkGBuild(passed: boolean, reason?: string): GateCheckResult {
  return {
    gate: "G_build",
    passed,
    reason: passed ? null : (reason ?? "Build command failed"),
    duration_ms: 0,
  };
}

/**
 * G_test: Verifies tests pass.
 * `npm test` or `pytest` must exit 0.
 */
export function checkGTest(passed: boolean, reason?: string): GateCheckResult {
  return {
    gate: "G_test",
    passed,
    reason: passed ? null : (reason ?? "Test suite failed"),
    duration_ms: 0,
  };
}

/**
 * G_lint: Verifies lint and format pass.
 * Zero lint errors required (warnings are tolerated, not counted as failures).
 */
export function checkGLint(passed: boolean, reason?: string): GateCheckResult {
  return {
    gate: "G_lint",
    passed,
    reason: passed ? null : (reason ?? "Lint/format check failed"),
    duration_ms: 0,
  };
}

/**
 * G_review: Verifies cross-model review score meets threshold.
 *
 * @param reviewScore - Review score from 0-100 (from Codex or Claude reviewer)
 * @param minScore - Minimum threshold from genotype.review_strategy.min_review_score
 */
export function checkGReview(
  reviewScore: number | undefined,
  minScore: number,
): GateCheckResult {
  if (reviewScore === undefined) {
    // Phase 1: no reviewer agent configured — pass the gate by default.
    // Phase 2+ will require cross-model review for all evaluations.
    return {
      gate: "G_review",
      passed: true,
      reason: null,
      duration_ms: 0,
    };
  }

  const passed = reviewScore >= minScore;
  return {
    gate: "G_review",
    passed,
    reason: passed
      ? null
      : `Review score ${reviewScore} < threshold ${minScore}`,
    duration_ms: 0,
  };
}

/**
 * G_safe: Verifies zero critical security findings.
 *
 * @param criticalFindings - Count of critical SAST/dependency findings (0 = pass)
 */
export function checkGSafe(
  criticalFindings: number | undefined,
): GateCheckResult {
  // If count is not provided, default to 0 (assume safe until proven otherwise)
  const findings = criticalFindings ?? 0;
  const passed = findings === 0;
  return {
    gate: "G_safe",
    passed,
    reason: passed ? null : `${findings} critical security finding(s) detected`,
    duration_ms: 0,
  };
}

// ─── Run all gates ────────────────────────────────────────────────────────────

/**
 * Run all 5 hard gates in sequence.
 * Stops at the first failure (short-circuit evaluation).
 *
 * @param input - Gate check inputs including pre-computed CI results
 * @param ciResults - Pre-computed CI results (typically from shell gate runner)
 */
export function runAllGates(
  input: GateCheckInput,
  ciResults: {
    build_passed: boolean;
    build_reason?: string;
    test_passed: boolean;
    test_reason?: string;
    lint_passed: boolean;
    lint_reason?: string;
  },
): AllGatesResult {
  const start = Date.now();
  const results: Partial<Record<keyof HardGates, GateCheckResult>> = {};

  const overrides = input.overrides ?? {};

  // G_build
  const buildResult =
    overrides["G_build"] !== undefined
      ? checkGBuild(overrides["G_build"])
      : checkGBuild(ciResults.build_passed, ciResults.build_reason);
  results["G_build"] = buildResult;
  if (!buildResult.passed) {
    return _buildAllGatesResult(results, "G_build", Date.now() - start);
  }

  // G_test
  const testResult =
    overrides["G_test"] !== undefined
      ? checkGTest(overrides["G_test"])
      : checkGTest(ciResults.test_passed, ciResults.test_reason);
  results["G_test"] = testResult;
  if (!testResult.passed) {
    return _buildAllGatesResult(results, "G_test", Date.now() - start);
  }

  // G_lint
  const lintResult =
    overrides["G_lint"] !== undefined
      ? checkGLint(overrides["G_lint"])
      : checkGLint(ciResults.lint_passed, ciResults.lint_reason);
  results["G_lint"] = lintResult;
  if (!lintResult.passed) {
    return _buildAllGatesResult(results, "G_lint", Date.now() - start);
  }

  // G_review
  const reviewResult =
    overrides["G_review"] !== undefined
      ? checkGReview(
          overrides["G_review"] ? input.min_review_score : undefined,
          input.min_review_score,
        )
      : checkGReview(input.review_score, input.min_review_score);
  results["G_review"] = reviewResult;
  if (!reviewResult.passed) {
    return _buildAllGatesResult(results, "G_review", Date.now() - start);
  }

  // G_safe
  const safeResult =
    overrides["G_safe"] !== undefined
      ? checkGSafe(overrides["G_safe"] ? 0 : 1)
      : checkGSafe(input.critical_security_findings);
  results["G_safe"] = safeResult;
  if (!safeResult.passed) {
    return _buildAllGatesResult(results, "G_safe", Date.now() - start);
  }

  return _buildAllGatesResult(results, null, Date.now() - start);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _buildAllGatesResult(
  partial: Partial<Record<keyof HardGates, GateCheckResult>>,
  firstFailure: keyof HardGates | null,
  total_duration_ms: number,
): AllGatesResult {
  // Fill any un-run gates as "not reached" (treated as pending, not failed)
  const gateKeys: (keyof HardGates)[] = [
    "G_build",
    "G_test",
    "G_lint",
    "G_review",
    "G_safe",
  ];

  const gates = {} as Record<keyof HardGates, GateCheckResult>;
  for (const key of gateKeys) {
    gates[key] = partial[key] ?? {
      gate: key,
      passed: false,
      reason: "Gate not reached (earlier gate failed)",
      duration_ms: 0,
    };
  }

  return {
    all_passed: firstFailure === null,
    first_failure: firstFailure,
    gates,
    total_duration_ms,
  };
}

// ─── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Convert AllGatesResult to the flat HardGates record consumed by evaluate().
 * Only produces true for gates that actually ran and passed.
 */
export function toHardGates(result: AllGatesResult): HardGates {
  return {
    G_build: result.gates["G_build"]?.passed ?? false,
    G_test: result.gates["G_test"]?.passed ?? false,
    G_lint: result.gates["G_lint"]?.passed ?? false,
    G_review: result.gates["G_review"]?.passed ?? false,
    G_safe: result.gates["G_safe"]?.passed ?? false,
  };
}

/**
 * Construct an all-pass HardGates record.
 * Use only in tests or when running in local dev mode without CI.
 */
export function allPassGates(): HardGates {
  return {
    G_build: true,
    G_test: true,
    G_lint: true,
    G_review: true,
    G_safe: true,
  };
}
