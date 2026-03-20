#!/usr/bin/env node
// score-layer1.js — DeFactory Layer 1 Evaluator (R_search)
//
// IMMUTABLE: This file is read-only from agents (enforced by policy.yml).
// Changes require board approval and a new policy.yml freeze cycle.
//
// Usage:
//   node score-layer1.js --input <json-file>
//   echo '{"gates":{...},"metrics":{...}}' | node score-layer1.js
//
// Input JSON schema:
//   {
//     "genotype_id": "gen-0042",
//     "task_id": "DEFA-15",
//     "stage": "search",
//     "gates": {
//       "G_build": true,
//       "G_test": true,
//       "G_lint": true,
//       "G_review": true,
//       "G_safe": true
//     },
//     "metrics": {
//       "lint_violations_weighted": 2.5,     // L — weighted by severity
//       "cyclomatic_complexity":    1.2,     // M — penalty value
//       "doc_coverage":             0.72,    // D — [0,1]
//       "diff_hunk_coverage":       0.85,    // cov_delta — [0,1]
//       "mutation_score":           0.70,    // mut — [0,1]
//       "hidden_holdout_pass_rate": 0.80,    // hcov — [0,1] (0 if stage=search)
//       "human_approvals":          4,       // A — count of approvals
//       "human_rejections":         1,       // R — count of rejections
//       "convention_violations":    3,       // v(p) — count
//       "kloc":                     5.0,     // KLOC of changed code
//       "items_completed":          8,       // for throughput
//       "time_hours":               2.0,     // for throughput
//       "throughput_max":           10.0,    // normalization ceiling
//       "cost_per_item_usd":        0.80,    // actual cost
//       "budget_per_item_usd":      2.00,    // from genotype budget
//       "guardrails_passed":        true     // all safety guardrails
//     }
//   }
//
// Output JSON:
//   {
//     "genotype_id": "gen-0042",
//     "task_id": "DEFA-15",
//     "stage": "search",
//     "gates_passed": true,
//     "scores": { "C": 0.82, "R": 0.78, "H": 0.75, "Q": 0.90, "T": 0.80, "K": 0.60, "S": 1.0 },
//     "utility": 0.785,
//     "pareto_dominated": false,
//     "reject_reason": null
//   }

"use strict";

// ─── Policy constants (mirrors policy.yml — DO NOT CHANGE) ───────────────────
const WEIGHTS = { C: 0.15, R: 0.2, H: 0.15, Q: 0.1, T: 0.15, K: 0.15, S: 0.1 };
const PARAMS = {
  code_quality: { alpha_L: 0.1, alpha_M: 0.05, alpha_D: 2.0, tau_D: 0.5 },
  test_reliability: { w_cov: 0.5, w_mut: 0.3, w_hid: 0.2 },
  human_approval: { alpha0: 1.0, beta0: 1.0, tau_H: 0.7 },
  convention_adherence: { lambda: 1.0 },
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

// Beta distribution mean: E[X] = alpha / (alpha + beta)
// We use this as Pr(theta_p >= tau_H | data) approximated via the posterior mean
// mapped through a logistic. For M0 we use the simpler Bayesian estimate:
// s_H = Beta(alpha0+A, beta0+R) mean, then threshold against tau_H via sigmoid.
function betaPosteriorMean(alpha0, beta0, A, R) {
  return (alpha0 + A) / (alpha0 + A + beta0 + R);
}

// ─── Hard gate evaluation ─────────────────────────────────────────────────────
function evaluateGates(gates) {
  const required = ["G_build", "G_test", "G_lint", "G_review", "G_safe"];
  for (const gate of required) {
    if (!gates[gate]) {
      return { passed: false, failed_gate: gate };
    }
  }
  return { passed: true, failed_gate: null };
}

// ─── Dimension scorers ────────────────────────────────────────────────────────

// C: Code Quality
// s_C = exp(-alpha_L * L) * exp(-alpha_M * M) * sigmoid(alpha_D * (D - tau_D))
function scoreCodeQuality(m) {
  const { alpha_L, alpha_M, alpha_D, tau_D } = PARAMS.code_quality;
  const lint_factor = Math.exp(-alpha_L * m.lint_violations_weighted);
  const complexity_factor = Math.exp(-alpha_M * m.cyclomatic_complexity);
  const doc_factor = sigmoid(alpha_D * (m.doc_coverage - tau_D));
  return clamp(lint_factor * complexity_factor * doc_factor);
}

// R: Test Reliability
// s_R = w_cov * cov_delta + w_mut * mut + w_hid * hcov
function scoreTestReliability(m) {
  const { w_cov, w_mut, w_hid } = PARAMS.test_reliability;
  return clamp(
    w_cov * m.diff_hunk_coverage +
      w_mut * m.mutation_score +
      w_hid * m.hidden_holdout_pass_rate,
  );
}

// H: Human Approval
// Pr(theta_p >= tau_H | data) via Beta(alpha0+A, beta0+R)
// Approximated as sigmoid of standardized posterior mean
function scoreHumanApproval(m) {
  const { alpha0, beta0, tau_H } = PARAMS.human_approval;
  const posteriorMean = betaPosteriorMean(
    alpha0,
    beta0,
    m.human_approvals,
    m.human_rejections,
  );
  // Map posterior mean to [0,1] using tau_H as the midpoint
  // Values at tau_H => 0.5; above => >0.5; below => <0.5
  return clamp(sigmoid(10 * (posteriorMean - tau_H)));
}

// Q: Convention Adherence
// s_Q = exp(-lambda * v(p) / max(1, KLOC))
function scoreConventionAdherence(m) {
  const { lambda } = PARAMS.convention_adherence;
  return clamp(
    Math.exp((-lambda * m.convention_violations) / Math.max(1, m.kloc)),
  );
}

// T: Throughput (items completed per hour, normalized to [0,1])
function scoreThroughput(m) {
  const raw = m.items_completed / Math.max(0.01, m.time_hours);
  return clamp(raw / Math.max(0.01, m.throughput_max));
}

// K: Cost Efficiency
// s_K = 1 - min(1, cost_per_item / budget_per_item)
function scoreCostEfficiency(m) {
  return clamp(
    1 -
      Math.min(1, m.cost_per_item_usd / Math.max(0.01, m.budget_per_item_usd)),
  );
}

// S: Safety (binary product — 1 if all guardrails pass, 0 otherwise)
function scoreSafety(m) {
  return m.guardrails_passed ? 1.0 : 0.0;
}

// ─── Utility (tie-break weighted sum) ─────────────────────────────────────────
function computeUtility(scores) {
  return (
    WEIGHTS.C * scores.C +
    WEIGHTS.R * scores.R +
    WEIGHTS.H * scores.H +
    WEIGHTS.Q * scores.Q +
    WEIGHTS.T * scores.T +
    WEIGHTS.K * scores.K +
    WEIGHTS.S * scores.S
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function evaluate(input) {
  const { genotype_id, task_id, stage, gates, metrics: m } = input;

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
  const scores = {
    C: scoreCodeQuality(m),
    R: scoreTestReliability(m),
    H: scoreHumanApproval(m),
    Q: scoreConventionAdherence(m),
    T: scoreThroughput(m),
    K: scoreCostEfficiency(m),
    S: scoreSafety(m),
  };

  // Step 3: Utility
  const utility = computeUtility(scores);

  return {
    genotype_id,
    task_id,
    stage,
    gates_passed: true,
    scores,
    utility,
    pareto_dominated: false, // caller determines this by comparing to frontier
    reject_reason: null,
  };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let inputJson = "";

  if (args.includes("--input")) {
    const inputFile = args[args.indexOf("--input") + 1];
    const fs = await import("fs");
    inputJson = fs.readFileSync(inputFile, "utf8");
  } else if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) {
      inputJson += chunk;
    }
  } else {
    console.error(
      "Usage: node score-layer1.js --input <file>  OR  echo '{...}' | node score-layer1.js",
    );
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    console.error("ERROR: Invalid JSON input:", e.message);
    process.exit(1);
  }

  const result = evaluate(input);
  console.log(JSON.stringify(result, null, 2));

  // Exit code 1 if gates failed (for CI integration)
  if (!result.gates_passed) process.exit(1);
}

// Export for programmatic use
module.exports = { evaluate, evaluateGates, computeUtility, WEIGHTS, PARAMS };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
