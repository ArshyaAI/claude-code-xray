import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateFixes, applyFix, findBackups } from "../index.js";
import type {
  Fix,
  XRayResult,
  CheckResult,
  DimensionScore,
} from "../../scan/types.js";

const TMP = join(__dirname, ".tmp-test-fix-index");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function makeCheck(name: string, passed: boolean): CheckResult {
  return {
    name,
    passed,
    value: passed ? "ok" : "failing",
    target: "expected",
    source: "test",
    confidence: "verified",
    fix_available: !passed,
    points: 10,
    applicable: true,
  };
}

function makeXRayResult(safetyChecks: CheckResult[]): XRayResult {
  return {
    timestamp: new Date().toISOString(),
    version: "0.1.0",
    repo: "/tmp/test",
    archetype: "ts-lib",
    overall_score: 50,
    dimensions_scored: 1,
    dimensions: {
      safety: {
        name: "Safety & Security",
        score: 50,
        weight: 0.3,
        checks: safetyChecks,
      },
    },
    fixes_available: [],
    security_alerts: [],
    settings_validation: { valid: true, errors: [] },
  };
}

describe("generateFixes", () => {
  it("returns fixes sorted by impact_estimate descending", () => {
    const repo = join(TMP, "repo-sorted");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions", deny: [] },
        enableAllProjectMcpServers: true,
      }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-sorted");
    mkdirSync(join(TMP, "fake-home-sorted"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("Permission mode", false),
        makeCheck("Deny rules for sensitive files", false),
        makeCheck("Sandbox enabled", false),
        makeCheck("MCP server trust model", false),
        makeCheck("PreToolUse safety hook", false),
      ]);
      const fixes = generateFixes(result, repo);
      assert.ok(fixes.length > 0, "should generate at least one fix");
      // Verify sorted descending
      for (let i = 1; i < fixes.length; i++) {
        assert.ok(
          fixes[i - 1]!.impact_estimate >= fixes[i]!.impact_estimate,
          `fix ${i - 1} (${fixes[i - 1]!.impact_estimate}) should have >= impact than fix ${i} (${fixes[i]!.impact_estimate})`,
        );
      }
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("returns empty array when all checks pass and hooks exist", () => {
    const repo = join(TMP, "repo-pass");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    // Include existing PostToolUse hook so hook-generator doesn't generate one
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "echo audit" }],
            },
          ],
        },
      }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-pass");
    mkdirSync(join(TMP, "fake-home-pass"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("Permission mode", true),
        makeCheck("Deny rules for sensitive files", true),
        makeCheck("Sandbox enabled", true),
        makeCheck("MCP server trust model", true),
        makeCheck("PreToolUse safety hook", true),
      ]);
      const fixes = generateFixes(result, repo);
      assert.equal(fixes.length, 0);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});

describe("applyFix", () => {
  it("dry run does not modify files", () => {
    const targetFile = join(TMP, "dry-run-target.json");
    mkdirSync(TMP, { recursive: true });
    writeFileSync(targetFile, '{"existing": true}', "utf-8");
    try {
      const fix: Fix = {
        id: "test/dry-run",
        dimension: "safety",
        description: "Test fix",
        diff: JSON.stringify({ newKey: true }),
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      applyFix(fix, true);
      // File should be unchanged
      const content = readFileSync(targetFile, "utf-8");
      assert.ok(content.includes('"existing"'));
      assert.ok(!content.includes("newKey"));
    } finally {
      teardown();
    }
  });

  it("live mode creates backup and writes merged JSON", () => {
    mkdirSync(TMP, { recursive: true });
    const targetFile = join(TMP, "live-target.json");
    writeFileSync(
      targetFile,
      JSON.stringify({ existing: true, keep: "me" }, null, 2),
      "utf-8",
    );
    try {
      const fix: Fix = {
        id: "test/live",
        dimension: "safety",
        description: "Test live fix",
        diff: JSON.stringify({ newKey: "added" }),
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      applyFix(fix, false);

      // Verify the merged content
      const content = JSON.parse(readFileSync(targetFile, "utf-8"));
      assert.equal(content.existing, true);
      assert.equal(content.keep, "me");
      assert.equal(content.newKey, "added");

      // Verify backup was created
      const backups = findBackups(targetFile);
      assert.ok(backups.length > 0, "should have created a backup");
    } finally {
      teardown();
    }
  });

  it("rejects fix with invalid JSON diff", () => {
    mkdirSync(TMP, { recursive: true });
    const targetFile = join(TMP, "bad-diff-target.json");
    writeFileSync(targetFile, "{}", "utf-8");
    try {
      const fix: Fix = {
        id: "test/bad-diff",
        dimension: "safety",
        description: "Bad diff",
        diff: "not valid json",
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      assert.throws(() => applyFix(fix, false), /not valid JSON/);
    } finally {
      teardown();
    }
  });

  it("creates file when target does not exist", () => {
    mkdirSync(TMP, { recursive: true });
    const targetFile = join(TMP, "new-file.json");
    try {
      assert.ok(!existsSync(targetFile));
      const fix: Fix = {
        id: "test/new-file",
        dimension: "safety",
        description: "Create new",
        diff: JSON.stringify({ created: true }),
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      applyFix(fix, false);
      assert.ok(existsSync(targetFile));
      const content = JSON.parse(readFileSync(targetFile, "utf-8"));
      assert.equal(content.created, true);
    } finally {
      teardown();
    }
  });
});

describe("findBackups", () => {
  it("returns empty array when no backups exist", () => {
    mkdirSync(TMP, { recursive: true });
    try {
      const backups = findBackups(join(TMP, "nonexistent.json"));
      assert.deepEqual(backups, []);
    } finally {
      teardown();
    }
  });

  it("returns empty array when directory does not exist", () => {
    const backups = findBackups("/nonexistent/path/settings.json");
    assert.deepEqual(backups, []);
  });

  it("finds and sorts backup files", () => {
    mkdirSync(TMP, { recursive: true });
    const base = join(TMP, "settings.json");
    try {
      writeFileSync(base, "{}", "utf-8");
      writeFileSync(`${base}.xray-backup.100`, "{}", "utf-8");
      writeFileSync(`${base}.xray-backup.200`, "{}", "utf-8");
      writeFileSync(`${base}.xray-backup.150`, "{}", "utf-8");

      const backups = findBackups(base);
      assert.equal(backups.length, 3);
      // Should be sorted oldest to newest
      assert.ok(backups[0]!.includes("100"));
      assert.ok(backups[1]!.includes("150"));
      assert.ok(backups[2]!.includes("200"));
    } finally {
      teardown();
    }
  });
});

describe("deepMerge (tested via applyFix)", () => {
  it("merges nested objects", () => {
    mkdirSync(TMP, { recursive: true });
    const targetFile = join(TMP, "deep-merge.json");
    writeFileSync(
      targetFile,
      JSON.stringify({
        permissions: { defaultMode: "default", deny: ["**/.env"] },
        hooks: { PreToolUse: [] },
      }),
      "utf-8",
    );
    try {
      const fix: Fix = {
        id: "test/merge",
        dimension: "safety",
        description: "Merge test",
        diff: JSON.stringify({
          permissions: { deny: ["**/secrets/**"], allow: ["src/**"] },
          sandbox: { enabled: true },
        }),
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      applyFix(fix, false);

      const content = JSON.parse(readFileSync(targetFile, "utf-8"));
      // Nested object should be merged, not replaced
      assert.equal(content.permissions.defaultMode, "default");
      // Arrays use source value (replace, not concatenate) — fix generators
      // produce the complete merged array, so deepMerge must not duplicate.
      assert.deepEqual(content.permissions.deny, ["**/secrets/**"]);
      assert.deepEqual(content.permissions.allow, ["src/**"]);
      // New keys should be added
      assert.equal(content.sandbox.enabled, true);
      assert.ok(content.hooks);
    } finally {
      teardown();
    }
  });

  it("replaces arrays with source value during merge", () => {
    mkdirSync(TMP, { recursive: true });
    const targetFile = join(TMP, "replace-merge.json");
    writeFileSync(
      targetFile,
      JSON.stringify({ items: ["a", "b", "c"] }),
      "utf-8",
    );
    try {
      const fix: Fix = {
        id: "test/replace",
        dimension: "safety",
        description: "Replace test",
        diff: JSON.stringify({ items: ["b", "c", "d"] }),
        impact_estimate: 10,
        security_relevant: false,
        why_safe: "test",
        target_file: targetFile,
      };
      applyFix(fix, false);

      const content = JSON.parse(readFileSync(targetFile, "utf-8"));
      // Arrays: source wins (fix generators produce the complete merged array)
      assert.deepEqual(content.items, ["b", "c", "d"]);
    } finally {
      teardown();
    }
  });
});
