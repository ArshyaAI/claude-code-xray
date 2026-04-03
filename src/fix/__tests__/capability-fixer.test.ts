import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateCapabilityFixes } from "../capability-fixer.js";
import type {
  XRayResult,
  CheckResult,
  DimensionScore,
} from "../../scan/types.js";

const TMP = join(__dirname, ".tmp-test-capability-fixer");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function makeCheck(
  name: string,
  passed: boolean,
  fixAvailable: boolean = !passed,
): CheckResult {
  return {
    name,
    passed,
    value: passed ? "ok" : "failing",
    target: "expected",
    source: "test",
    confidence: "verified",
    fix_available: fixAvailable,
  };
}

function makeXRayResult(
  capChecks: CheckResult[],
  schemaErrors: { path: string; message: string; scope: string }[] = [],
): XRayResult {
  return {
    timestamp: new Date().toISOString(),
    version: "0.1.0",
    repo: "/tmp/test",
    archetype: "ts-lib",
    overall_score: 50,
    dimensions_scored: 1,
    dimensions: {
      capability: {
        name: "Capability",
        score: 50,
        weight: 0.25,
        checks: capChecks,
      },
    },
    fixes_available: [],
    security_alerts: [],
    settings_validation: {
      valid: schemaErrors.length === 0,
      errors: schemaErrors,
    },
  };
}

describe("generateCapabilityFixes", () => {
  it("returns empty array when all checks pass and no schema errors", () => {
    const result = makeXRayResult([
      makeCheck("Coordinator available", true),
      makeCheck("Schema validity", true),
    ]);
    const fixes = generateCapabilityFixes(result, "/tmp/test");
    assert.equal(fixes.length, 0);
  });

  it("generates coordinator mode fix when check is failing", () => {
    const repo = join(TMP, "repo-coord");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({ permissions: {} }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-coord");
    mkdirSync(join(TMP, "fake-home-coord", ".claude"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("Coordinator available", false),
      ]);
      const fixes = generateCapabilityFixes(result, repo);
      const coordFix = fixes.find(
        (f) => f.id === "capability/coordinator-mode",
      );
      assert.ok(coordFix, "should generate coordinator mode fix");
      assert.equal(coordFix.dimension, "capability");
      assert.ok(coordFix.diff.includes("CLAUDE_CODE_COORDINATOR_MODE"));
      assert.ok(coordFix.diff.includes('"1"'));
      assert.equal(coordFix.security_relevant, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("preserves existing env vars when adding coordinator mode", () => {
    const repo = join(TMP, "repo-env");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({ env: { MY_VAR: "keep" } }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-env");
    mkdirSync(join(TMP, "fake-home-env", ".claude"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("Coordinator available", false),
      ]);
      const fixes = generateCapabilityFixes(result, repo);
      const coordFix = fixes.find(
        (f) => f.id === "capability/coordinator-mode",
      );
      assert.ok(coordFix);
      assert.ok(coordFix.diff.includes("MY_VAR"));
      assert.ok(coordFix.diff.includes("keep"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("generates unknown keys fix when schema errors exist", () => {
    const repo = join(TMP, "repo-unknown");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({ permissions: {}, badKey: "stale", anotherBad: 42 }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-unknown");
    mkdirSync(join(TMP, "fake-home-unknown", ".claude"), { recursive: true });
    try {
      const result = makeXRayResult(
        [makeCheck("Schema validity", false)],
        [
          {
            path: "badKey",
            message:
              'Unknown settings key "badKey". May be a typo or stale config.',
            scope: "project-shared",
          },
          {
            path: "anotherBad",
            message:
              'Unknown settings key "anotherBad". May be a typo or stale config.',
            scope: "project-shared",
          },
        ],
      );
      const fixes = generateCapabilityFixes(result, repo);
      const keysFix = fixes.find(
        (f) => f.id === "capability/remove-unknown-keys",
      );
      assert.ok(keysFix, "should generate unknown keys fix");
      assert.ok(keysFix.description.includes("badKey"));
      assert.ok(keysFix.description.includes("anotherBad"));
      // The diff should NOT contain the unknown keys
      const parsed = JSON.parse(keysFix.diff);
      assert.equal(parsed.badKey, undefined);
      assert.equal(parsed.anotherBad, undefined);
      // But should keep valid keys
      assert.ok(parsed.permissions !== undefined);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("returns no fix when no capability dimension exists", () => {
    const result: XRayResult = {
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      repo: "/tmp/test",
      archetype: "ts-lib",
      overall_score: 0,
      dimensions_scored: 0,
      dimensions: {},
      fixes_available: [],
      security_alerts: [],
      settings_validation: { valid: true, errors: [] },
    };
    const fixes = generateCapabilityFixes(result, "/tmp/test");
    assert.equal(fixes.length, 0);
  });
});
