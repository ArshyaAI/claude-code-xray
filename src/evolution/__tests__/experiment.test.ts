import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  renderExperimentResults,
  readExperimentHistory,
} from "../experiment.js";
import type { ExperimentResult } from "../types.js";
import { takeSnapshot, restoreSnapshot, cleanupSnapshot } from "../snapshot.js";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

const TMP = join(__dirname, ".tmp-test-experiment");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function makeResult(
  overrides: Partial<ExperimentResult> = {},
): ExperimentResult {
  return {
    fix_id: "safety/deny-rules",
    fix_description: "Add deny rules for secrets",
    before_score: 34,
    after_score: 52,
    delta: 18,
    dimension_deltas: { safety: 25 },
    checks_flipped: [
      { name: "Deny rules for sensitive files", from: false, to: true },
    ],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── renderExperimentResults ────────────────────────────────────────────────

describe("renderExperimentResults", () => {
  it("returns message when no results", () => {
    const output = renderExperimentResults([]);
    assert.ok(output.includes("No experiment results"));
  });

  it("renders single result with correct values", () => {
    const results = [makeResult()];
    const output = renderExperimentResults(results);

    assert.ok(output.includes("X-Ray Experiment Results"));
    assert.ok(output.includes("Add deny rules for secrets"));
    assert.ok(output.includes("34"));
    assert.ok(output.includes("52"));
    assert.ok(output.includes("+18"));
  });

  it("renders multiple results sorted by delta descending", () => {
    const results = [
      makeResult({
        fix_id: "a",
        fix_description: "Fix A",
        delta: 5,
        after_score: 39,
      }),
      makeResult({
        fix_id: "b",
        fix_description: "Fix B",
        delta: 18,
        after_score: 52,
      }),
      makeResult({
        fix_id: "c",
        fix_description: "Fix C",
        delta: 8,
        after_score: 42,
      }),
    ];
    const output = renderExperimentResults(results);

    // Fix B (delta 18) should come before Fix C (delta 8) which comes before Fix A (delta 5)
    const posB = output.indexOf("Fix B");
    const posC = output.indexOf("Fix C");
    const posA = output.indexOf("Fix A");
    assert.ok(posB < posC, "Fix B should appear before Fix C");
    assert.ok(posC < posA, "Fix C should appear before Fix A");
  });

  it("shows combined potential line", () => {
    const results = [
      makeResult({ delta: 18 }),
      makeResult({
        fix_id: "b",
        fix_description: "Fix B",
        delta: 8,
        after_score: 42,
      }),
    ];
    const output = renderExperimentResults(results);
    assert.ok(output.includes("Combined potential"));
    // Combined delta = 18 + 8 = 26
    assert.ok(output.includes("+26"));
  });

  it("handles negative deltas", () => {
    const results = [
      makeResult({ delta: -3, after_score: 31, fix_description: "Bad fix" }),
    ];
    const output = renderExperimentResults(results);
    assert.ok(output.includes("-3"));
  });
});

// ─── Snapshot ───────────────────────────────────────────────────────────────

describe("snapshot", () => {
  it("takes and restores a snapshot of settings files", () => {
    const repo = join(TMP, "repo-snapshot");
    const settingsDir = join(repo, ".claude");
    mkdirSync(settingsDir, { recursive: true });

    const origHome = process.env.HOME;
    const fakeHome = join(TMP, "fake-home-snap");
    process.env.HOME = fakeHome;
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });

    try {
      const originalContent = '{"permissions":{"deny":["*.env"]}}';
      writeFileSync(
        join(settingsDir, "settings.json"),
        originalContent,
        "utf-8",
      );

      // Take snapshot
      const snapshot = takeSnapshot(repo, "test-snap-1");
      assert.equal(snapshot.id, "test-snap-1");
      assert.ok(snapshot.files.length > 0);

      // Modify the file
      writeFileSync(
        join(settingsDir, "settings.json"),
        '{"modified":true}',
        "utf-8",
      );

      // Restore
      restoreSnapshot(snapshot);

      // Verify restored
      const restored = readFileSync(
        join(settingsDir, "settings.json"),
        "utf-8",
      );
      assert.equal(restored, originalContent);

      // Cleanup
      cleanupSnapshot("test-snap-1");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("handles files that did not exist before snapshot", () => {
    const repo = join(TMP, "repo-no-exist");
    mkdirSync(join(repo, ".claude"), { recursive: true });

    const origHome = process.env.HOME;
    const fakeHome = join(TMP, "fake-home-noexist");
    process.env.HOME = fakeHome;
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });

    try {
      // No settings.local.json exists
      const snapshot = takeSnapshot(repo, "test-snap-2");

      // Create the file after snapshot
      const localPath = join(repo, ".claude", "settings.local.json");
      writeFileSync(localPath, '{"new":true}', "utf-8");
      assert.ok(existsSync(localPath));

      // Restore should remove the new file
      restoreSnapshot(snapshot);
      assert.ok(!existsSync(localPath));

      cleanupSnapshot("test-snap-2");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});

// ─── readExperimentHistory ──────────────────────────────────────────────────

describe("readExperimentHistory", () => {
  it("returns empty array when no history file exists", () => {
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-no-history");
    mkdirSync(join(TMP, "fake-home-no-history"), { recursive: true });
    try {
      const history = readExperimentHistory();
      assert.deepEqual(history, []);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
