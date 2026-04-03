import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeDiff, renderDiff } from "../diff.js";
import type {
  XRayResult,
  HistoryEntry,
  CheckResult,
  DiffResult,
} from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCheck(
  name: string,
  passed: boolean,
  detail?: string,
): CheckResult {
  return {
    name,
    passed,
    value: passed,
    target: true,
    source: "test",
    confidence: "verified" as const,
    fix_available: !passed,
    detail,
    points: 10,
    applicable: true,
  };
}

function makeResult(overrides: Partial<XRayResult> = {}): XRayResult {
  return {
    timestamp: new Date().toISOString(),
    version: "0.2.0",
    repo: "/test",
    archetype: "standard",
    overall_score: 73,
    dimensions_scored: 4,
    dimensions: {
      safety: {
        name: "Safety & Security",
        score: 85,
        weight: 0.3,
        checks: [
          makeCheck("Sandbox enabled", true),
          makeCheck("Deny rules for secrets", true),
        ],
      },
      capability: {
        name: "Capability",
        score: 50,
        weight: 0.25,
        checks: [makeCheck("CLAUDE.md present", true)],
      },
      automation: {
        name: "Automation",
        score: 75,
        weight: 0.25,
        checks: [makeCheck("Pre-commit hooks", true)],
      },
      efficiency: {
        name: "Efficiency",
        score: 79,
        weight: 0.2,
        checks: [makeCheck("Model routing", false, "No model config found")],
      },
    },
    fixes_available: [],
    security_alerts: [],
    settings_validation: { valid: true, errors: [] },
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    action: "scan",
    repo: "/test",
    overall_score: 68,
    dimensions_scored: 4,
    dimensions: {
      safety: { name: "Safety & Security", score: 80 },
      capability: { name: "Capability", score: 50 },
      automation: { name: "Automation", score: 70 },
      efficiency: { name: "Efficiency", score: 75 },
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("computeDiff", () => {
  it("computes overall score delta", () => {
    const current = makeResult({ overall_score: 73 });
    const previous = makeHistoryEntry({ overall_score: 68 });
    const diff = computeDiff(current, previous);

    assert.equal(diff.previous_score, 68);
    assert.equal(diff.current_score, 73);
    assert.equal(diff.delta, 5);
  });

  it("detects regressions when a check flips from pass to fail", () => {
    const current = makeResult({
      dimensions: {
        safety: {
          name: "Safety & Security",
          score: 50,
          weight: 0.3,
          checks: [
            makeCheck("Sandbox enabled", false, "Sandbox is off"),
            makeCheck("Deny rules for secrets", true),
          ],
        },
      },
    });
    const previousChecks: CheckResult[] = [
      makeCheck("Sandbox enabled", true),
      makeCheck("Deny rules for secrets", true),
    ];

    const diff = computeDiff(current, makeHistoryEntry(), previousChecks);

    assert.equal(diff.regressed.length, 1);
    assert.equal(diff.regressed[0]!.name, "Sandbox enabled");
    assert.equal(diff.improved.length, 0);
  });

  it("detects improvements when a check flips from fail to pass", () => {
    const current = makeResult({
      dimensions: {
        safety: {
          name: "Safety & Security",
          score: 90,
          weight: 0.3,
          checks: [
            makeCheck("Sandbox enabled", true),
            makeCheck("Deny rules for secrets", true),
          ],
        },
      },
    });
    const previousChecks: CheckResult[] = [
      makeCheck("Sandbox enabled", false),
      makeCheck("Deny rules for secrets", true),
    ];

    const diff = computeDiff(current, makeHistoryEntry(), previousChecks);

    assert.equal(diff.improved.length, 1);
    assert.equal(diff.improved[0]!.name, "Sandbox enabled");
    assert.equal(diff.regressed.length, 0);
  });

  it("counts unchanged checks correctly", () => {
    const current = makeResult({
      dimensions: {
        safety: {
          name: "Safety & Security",
          score: 85,
          weight: 0.3,
          checks: [
            makeCheck("Sandbox enabled", true),
            makeCheck("Deny rules for secrets", true),
          ],
        },
      },
    });
    const previousChecks: CheckResult[] = [
      makeCheck("Sandbox enabled", true),
      makeCheck("Deny rules for secrets", true),
    ];

    const diff = computeDiff(current, makeHistoryEntry(), previousChecks);

    assert.equal(diff.unchanged_count, 2);
    assert.equal(diff.regressed.length, 0);
    assert.equal(diff.improved.length, 0);
  });

  it("handles missing previous checks gracefully", () => {
    const current = makeResult();
    const diff = computeDiff(current, makeHistoryEntry());

    // Without previous checks, all current checks are counted as unchanged
    assert.equal(diff.regressed.length, 0);
    assert.equal(diff.improved.length, 0);
    assert.ok(diff.unchanged_count > 0);
  });

  it("computes dimension deltas", () => {
    const current = makeResult({
      overall_score: 73,
      dimensions: {
        safety: {
          name: "Safety & Security",
          score: 85,
          weight: 0.3,
          checks: [makeCheck("a", true)],
        },
        capability: {
          name: "Capability",
          score: 55,
          weight: 0.25,
          checks: [makeCheck("b", true)],
        },
      },
    });
    const previous = makeHistoryEntry({
      dimensions: {
        safety: { name: "Safety & Security", score: 80 },
        capability: { name: "Capability", score: 50 },
      },
    });

    const diff = computeDiff(current, previous);

    assert.equal(diff.dimension_deltas.length, 2);
    const safetyDelta = diff.dimension_deltas.find(
      (d) => d.name === "Safety & Security",
    );
    assert.ok(safetyDelta);
    assert.equal(safetyDelta.previous, 80);
    assert.equal(safetyDelta.current, 85);
    assert.equal(safetyDelta.delta, 5);
  });

  it("handles negative overall delta", () => {
    const current = makeResult({ overall_score: 58 });
    const previous = makeHistoryEntry({ overall_score: 73 });
    const diff = computeDiff(current, previous);

    assert.equal(diff.delta, -15);
  });

  it("handles zero delta", () => {
    const current = makeResult({ overall_score: 68 });
    const previous = makeHistoryEntry({ overall_score: 68 });
    const diff = computeDiff(current, previous);

    assert.equal(diff.delta, 0);
  });
});

describe("renderDiff", () => {
  it("renders a positive diff", () => {
    const diff: DiffResult = {
      previous_score: 68,
      current_score: 73,
      delta: 5,
      regressed: [],
      improved: [{ name: "Deny rules added for .env, secrets" }],
      unchanged_count: 14,
      dimension_deltas: [
        {
          name: "Safety & Security",
          previous: 80,
          current: 85,
          delta: 5,
        },
      ],
    };

    const output = renderDiff(diff);
    assert.ok(output.includes("68"));
    assert.ok(output.includes("73"));
    assert.ok(output.includes("+5"));
    assert.ok(output.includes("IMPROVED"));
    assert.ok(output.includes("Deny rules added"));
    assert.ok(output.includes("14 checks"));
  });

  it("renders a negative diff with regressions", () => {
    const diff: DiffResult = {
      previous_score: 73,
      current_score: 58,
      delta: -15,
      regressed: [
        {
          name: "Sandbox enabled",
          detail: "was passing, now failing",
        },
      ],
      improved: [],
      unchanged_count: 10,
      dimension_deltas: [],
    };

    const output = renderDiff(diff);
    assert.ok(output.includes("REGRESSED"));
    assert.ok(output.includes("Sandbox enabled"));
    assert.ok(output.includes("10 checks"));
  });

  it("renders zero delta", () => {
    const diff: DiffResult = {
      previous_score: 50,
      current_score: 50,
      delta: 0,
      regressed: [],
      improved: [],
      unchanged_count: 5,
      dimension_deltas: [],
    };

    const output = renderDiff(diff);
    assert.ok(output.includes("no change"));
  });

  it("renders empty diff with no checks", () => {
    const diff: DiffResult = {
      previous_score: 0,
      current_score: 0,
      delta: 0,
      regressed: [],
      improved: [],
      unchanged_count: 0,
      dimension_deltas: [],
    };

    const output = renderDiff(diff);
    assert.ok(typeof output === "string");
    assert.ok(output.length > 0);
  });
});
