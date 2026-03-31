import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { sparkline, renderHistory, type RunSummary } from "../history.js";

describe("sparkline", () => {
  it("returns empty string for empty array", () => {
    assert.equal(sparkline([]), "");
  });

  it("renders single value as middle char", () => {
    const result = sparkline([5]);
    assert.equal(result.length, 1);
  });

  it("renders ascending values as ascending bars", () => {
    const result = sparkline([0, 1, 2, 3, 4]);
    assert.equal(result[0], "▁");
    assert.equal(result[result.length - 1], "█");
  });

  it("renders equal values as same char", () => {
    const result = sparkline([5, 5, 5]);
    assert.equal(result[0], result[1]);
    assert.equal(result[1], result[2]);
  });
});

describe("renderHistory", () => {
  it("returns no-runs message for empty array", () => {
    const output = renderHistory([]);
    assert.equal(output, "No completed runs found.");
  });

  it("renders table with run data", () => {
    const runs: RunSummary[] = [
      {
        id: "run-20260327-001",
        crews: 2,
        tasks: 8,
        avg_utility: 0.58,
        cost: 1.23,
        status: "completed",
        champion_id: "gen-0003",
      },
      {
        id: "run-20260327-002",
        crews: 2,
        tasks: 8,
        avg_utility: 0.61,
        cost: 1.45,
        status: "completed",
        champion_id: "gen-0003",
      },
    ];
    const output = renderHistory(runs, 1);
    assert.ok(output.includes("FACTORY HISTORY"));
    assert.ok(output.includes("run-20260327-001"));
    assert.ok(output.includes("run-20260327-002"));
    assert.ok(output.includes("gen-0003"));
    assert.ok(output.includes("Utility:"));
    assert.ok(output.includes("Cost:"));
    assert.ok(output.includes("Promotions: 1/2 runs (50%)"));
  });

  it("includes status coloring markers", () => {
    const runs: RunSummary[] = [
      {
        id: "run-001",
        crews: 2,
        tasks: 8,
        avg_utility: 0.5,
        cost: 2.0,
        status: "failed",
        champion_id: "gen-0000",
      },
    ];
    const output = renderHistory(runs, 0);
    // Should contain ANSI red escape for failed status
    assert.ok(output.includes("\x1b[31m"));
  });
});
