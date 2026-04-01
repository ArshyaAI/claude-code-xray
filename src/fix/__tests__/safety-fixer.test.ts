import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  fixDenyRules,
  fixSandboxConfig,
  fixBypassPermissions,
  fixMcpTrust,
  generateSafetyFixes,
} from "../safety-fixer.js";
import type {
  XRayResult,
  DimensionScore,
  CheckResult,
} from "../../scan/types.js";

const TMP = join(__dirname, ".tmp-test-safety-fixer");

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

function makeSafetyDimension(checks: CheckResult[]): DimensionScore {
  return {
    name: "Safety & Security",
    score: 50,
    weight: 0.3,
    checks,
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
      safety: makeSafetyDimension(safetyChecks),
    },
    fixes_available: [],
    security_alerts: [],
    settings_validation: { valid: true, errors: [] },
  };
}

describe("fixDenyRules", () => {
  it("returns undefined when deny rules check is passing", () => {
    const result = makeXRayResult([
      makeCheck("Deny rules for sensitive files", true),
    ]);
    const fix = fixDenyRules(result, "/tmp/test");
    assert.equal(fix, undefined);
  });

  it("generates a fix when deny rules check is failing", () => {
    const repo = join(TMP, "repo");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeFileSync(
        join(repo, ".claude", "settings.json"),
        JSON.stringify({ permissions: { deny: [] } }),
        "utf-8",
      );
      const result = makeXRayResult([
        makeCheck("Deny rules for sensitive files", false),
      ]);
      const fix = fixDenyRules(result, repo);
      assert.ok(fix, "should generate a fix");
      assert.equal(fix.id, "safety/deny-rules");
      assert.equal(fix.dimension, "safety");
      assert.equal(fix.security_relevant, true);
      assert.ok(fix.impact_estimate > 0);
      // The diff should contain deny patterns
      assert.ok(fix.diff.includes(".env"), "diff should include .env pattern");
      assert.ok(fix.diff.includes("pem"), "diff should include pem pattern");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("returns undefined when no safety dimension exists", () => {
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
    const fix = fixDenyRules(result, "/tmp/test");
    assert.equal(fix, undefined);
  });
});

describe("fixSandboxConfig", () => {
  it("returns undefined when sandbox check is passing", () => {
    const result = makeXRayResult([makeCheck("Sandbox enabled", true)]);
    const fix = fixSandboxConfig(result, "/tmp/test");
    assert.equal(fix, undefined);
  });

  it("generates sandbox config fix when failing", () => {
    const repo = join(TMP, "repo-sandbox");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "settings.json"), "{}", "utf-8");
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-sandbox");
    mkdirSync(join(TMP, "fake-home-sandbox"), { recursive: true });
    try {
      const result = makeXRayResult([makeCheck("Sandbox enabled", false)]);
      const fix = fixSandboxConfig(result, repo);
      assert.ok(fix);
      assert.equal(fix.id, "safety/sandbox-config");
      assert.ok(fix.diff.includes("sandbox"));
      assert.ok(fix.diff.includes("enabled"));
      assert.ok(fix.diff.includes("true"));
      assert.equal(fix.security_relevant, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});

describe("fixBypassPermissions", () => {
  it("returns undefined when permission mode is passing", () => {
    const result = makeXRayResult([makeCheck("Permission mode", true)]);
    const fix = fixBypassPermissions(result, "/tmp/test");
    assert.equal(fix, undefined);
  });

  it("generates fix to switch to default mode", () => {
    const repo = join(TMP, "repo-bypass");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-bypass");
    mkdirSync(join(TMP, "fake-home-bypass"), { recursive: true });
    try {
      const result = makeXRayResult([makeCheck("Permission mode", false)]);
      const fix = fixBypassPermissions(result, repo);
      assert.ok(fix);
      assert.equal(fix.id, "safety/permission-mode");
      assert.ok(fix.diff.includes('"default"'));
      assert.equal(fix.impact_estimate, 25);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});

describe("fixMcpTrust", () => {
  it("returns undefined when MCP trust check is passing", () => {
    const result = makeXRayResult([makeCheck("MCP server trust model", true)]);
    const fix = fixMcpTrust(result, "/tmp/test");
    assert.equal(fix, undefined);
  });

  it("generates fix to disable auto-trust", () => {
    const repo = join(TMP, "repo-mcp");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "settings.json"),
      JSON.stringify({ enableAllProjectMcpServers: true }),
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-mcp");
    mkdirSync(join(TMP, "fake-home-mcp"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("MCP server trust model", false),
      ]);
      const fix = fixMcpTrust(result, repo);
      assert.ok(fix);
      assert.equal(fix.id, "safety/mcp-trust");
      assert.ok(fix.diff.includes("false"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});

describe("generateSafetyFixes", () => {
  it("returns empty array when all checks pass", () => {
    const result = makeXRayResult([
      makeCheck("Permission mode", true),
      makeCheck("Deny rules for sensitive files", true),
      makeCheck("Sandbox enabled", true),
      makeCheck("MCP server trust model", true),
      makeCheck("PreToolUse safety hook", true),
      makeCheck("Bash subprocess deny gap", true),
    ]);
    const fixes = generateSafetyFixes(result, "/tmp/test");
    assert.equal(fixes.length, 0);
  });

  it("returns multiple fixes when multiple checks fail", () => {
    const repo = join(TMP, "repo-multi");
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
    process.env.HOME = join(TMP, "fake-home-multi");
    mkdirSync(join(TMP, "fake-home-multi"), { recursive: true });
    try {
      const result = makeXRayResult([
        makeCheck("Permission mode", false),
        makeCheck("Deny rules for sensitive files", false),
        makeCheck("Sandbox enabled", false),
        makeCheck("MCP server trust model", false),
      ]);
      const fixes = generateSafetyFixes(result, repo);
      assert.ok(fixes.length >= 3, `expected >= 3 fixes, got ${fixes.length}`);
      // Each fix should have a unique ID
      const ids = fixes.map((f) => f.id);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, ids.length, "fix IDs should be unique");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
