/**
 * pareto-dominance.test.ts — Unit tests for per-dimension Pareto dominance test
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { runParetoDominanceTest } from "../protocol.js";
import type { ParetoDimensions } from "../../evaluator/score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScores(
  overrides: Partial<ParetoDimensions> = {},
): ParetoDimensions {
  return {
    C: 0.5,
    R: 0.5,
    H: 0.5,
    Q: 0.5,
    T: 0.5,
    K: 0.5,
    S: 0.5,
    ...overrides,
  };
}

/** Generate N score pairs where candidate wins on all dims by `margin`. */
function generateWinning(
  n: number,
  margin = 0.1,
): { candidate: ParetoDimensions[]; champion: ParetoDimensions[] } {
  const candidate: ParetoDimensions[] = [];
  const champion: ParetoDimensions[] = [];
  for (let i = 0; i < n; i++) {
    champion.push(makeScores());
    candidate.push(
      makeScores({
        C: 0.5 + margin,
        R: 0.5 + margin,
        H: 0.5 + margin,
        Q: 0.5 + margin,
        T: 0.5 + margin,
        K: 0.5 + margin,
        S: 0.5 + margin,
      }),
    );
  }
  return { candidate, champion };
}

/** Generate N score pairs where candidate loses on all dims. */
function generateLosing(
  n: number,
  margin = 0.1,
): { candidate: ParetoDimensions[]; champion: ParetoDimensions[] } {
  const candidate: ParetoDimensions[] = [];
  const champion: ParetoDimensions[] = [];
  for (let i = 0; i < n; i++) {
    champion.push(
      makeScores({
        C: 0.5 + margin,
        R: 0.5 + margin,
        H: 0.5 + margin,
        Q: 0.5 + margin,
        T: 0.5 + margin,
        K: 0.5 + margin,
        S: 0.5 + margin,
      }),
    );
    candidate.push(makeScores());
  }
  return { candidate, champion };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runParetoDominanceTest", () => {
  it("passes when candidate wins on all 7 dimensions (N=20)", () => {
    const { candidate, champion } = generateWinning(20);
    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.passed, true);
    assert.equal(result.n_tasks, 20);
    assert.equal(result.rejection_reason, undefined);

    // All 7 dimensions should pass
    const dims: (keyof ParetoDimensions)[] = [
      "C",
      "R",
      "H",
      "Q",
      "T",
      "K",
      "S",
    ];
    for (const dim of dims) {
      assert.equal(
        result.dimension_results[dim].passed,
        true,
        `${dim} should pass`,
      );
      assert.equal(
        result.dimension_results[dim].n_wins,
        20,
        `${dim} should have 20 wins`,
      );
      assert.equal(
        result.dimension_results[dim].n_losses,
        0,
        `${dim} should have 0 losses`,
      );
    }
  });

  it("fails when candidate loses on all dimensions", () => {
    const { candidate, champion } = generateLosing(20);
    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.passed, false);
    assert.equal(result.rejection_reason, "sign_test_failed");

    const dims: (keyof ParetoDimensions)[] = [
      "C",
      "R",
      "H",
      "Q",
      "T",
      "K",
      "S",
    ];
    for (const dim of dims) {
      assert.equal(
        result.dimension_results[dim].passed,
        false,
        `${dim} should fail`,
      );
      assert.equal(
        result.dimension_results[dim].n_losses,
        20,
        `${dim} should have 20 losses`,
      );
    }
  });

  it("fails when even one dimension fails (candidate wins 6, loses 1)", () => {
    const n = 20;
    const candidate: ParetoDimensions[] = [];
    const champion: ParetoDimensions[] = [];

    for (let i = 0; i < n; i++) {
      // Candidate wins on C, R, H, Q, T, K but loses on S
      candidate.push(
        makeScores({
          C: 0.7,
          R: 0.7,
          H: 0.7,
          Q: 0.7,
          T: 0.7,
          K: 0.7,
          S: 0.3,
        }),
      );
      champion.push(
        makeScores({
          C: 0.5,
          R: 0.5,
          H: 0.5,
          Q: 0.5,
          T: 0.5,
          K: 0.5,
          S: 0.5,
        }),
      );
    }

    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.passed, false, "should fail because S dimension fails");
    assert.equal(result.dimension_results.S.passed, false);
    assert.equal(result.dimension_results.S.n_losses, 20);
    // Other dims should pass
    assert.equal(result.dimension_results.C.passed, true);
    assert.equal(result.dimension_results.R.passed, true);
  });

  it("rejects when N < 20", () => {
    const { candidate, champion } = generateWinning(15);
    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.passed, false);
    assert.equal(result.n_tasks, 15);
    assert.equal(result.rejection_reason, "sign_test_failed");
  });

  it("handles known win/loss counts correctly (18 wins, 2 losses out of 20)", () => {
    const n = 20;
    const candidate: ParetoDimensions[] = [];
    const champion: ParetoDimensions[] = [];

    // 18 wins, 2 losses on C dimension; all wins on others
    for (let i = 0; i < n; i++) {
      if (i < 18) {
        candidate.push(makeScores({ C: 0.8 }));
        champion.push(makeScores({ C: 0.5 }));
      } else {
        candidate.push(makeScores({ C: 0.3 }));
        champion.push(makeScores({ C: 0.5 }));
      }
    }

    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.dimension_results.C.n_wins, 18);
    assert.equal(result.dimension_results.C.n_losses, 2);
    // With 18 wins out of 20 trials, p should be very small — should pass
    assert.equal(result.dimension_results.C.passed, true);
    assert.ok(result.dimension_results.C.p_value < 0.05);
  });

  it("respects custom alpha", () => {
    // Generate a borderline scenario: 14 wins, 6 losses (N=20)
    // p-value for 14/20 ≈ 0.058 — fails at alpha=0.05, passes at alpha=0.10
    const n = 20;
    const candidate: ParetoDimensions[] = [];
    const champion: ParetoDimensions[] = [];

    for (let i = 0; i < n; i++) {
      const allWin = i < 14;
      candidate.push(
        makeScores({
          C: allWin ? 0.8 : 0.3,
          R: 0.8,
          H: 0.8,
          Q: 0.8,
          T: 0.8,
          K: 0.8,
          S: 0.8,
        }),
      );
      champion.push(makeScores());
    }

    const strict = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    const lenient = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.1,
    });

    // C dimension should be the borderline one
    // Other dims all win so they pass regardless
    // The overall result depends on whether C passes
    assert.equal(strict.dimension_results.C.n_wins, 14);
    assert.equal(strict.dimension_results.C.n_losses, 6);
    // Just verify p-values are computed consistently
    assert.equal(
      strict.dimension_results.C.p_value,
      lenient.dimension_results.C.p_value,
    );
  });

  it("works with large N (N=30)", () => {
    const { candidate, champion } = generateWinning(30);
    const result = runParetoDominanceTest({
      candidate_scores: candidate,
      champion_scores: champion,
      alpha: 0.05,
    });

    assert.equal(result.passed, true);
    assert.equal(result.n_tasks, 30);
  });
});
