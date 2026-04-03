import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateContextFixes } from "../context-generator.js";
import type { XRayResult, CheckResult } from "../../scan/types.js";

const TMP = join(__dirname, ".tmp-test-context-generator");

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

function makeXRayResult(capChecks: CheckResult[]): XRayResult {
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
    settings_validation: { valid: true, errors: [] },
  };
}

describe("generateContextFixes", () => {
  it("returns empty array when CLAUDE.md exists and rules dir exists", () => {
    const repo = join(TMP, "repo-ok");
    mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
    writeFileSync(join(repo, "CLAUDE.md"), "# Project", "utf-8");
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", true)]);
      const fixes = generateContextFixes(result, repo);
      assert.equal(fixes.length, 0);
    } finally {
      teardown();
    }
  });

  it("generates CLAUDE.md fix when check is failing", () => {
    const repo = join(TMP, "repo-no-md");
    mkdirSync(repo, { recursive: true });
    // No CLAUDE.md exists
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", false)]);
      const fixes = generateContextFixes(result, repo);
      const mdFix = fixes.find((f) => f.id === "context/claude-md");
      assert.ok(mdFix, "should generate CLAUDE.md fix");
      assert.equal(mdFix.dimension, "capability");
      assert.ok(mdFix.diff.includes("# "));
      assert.ok(mdFix.diff.includes("## Commands"));
      assert.ok(mdFix.diff.includes("## Architecture"));
      assert.ok(mdFix.diff.includes("## Rules"));
      assert.equal(mdFix.target_file, join(repo, "CLAUDE.md"));
    } finally {
      teardown();
    }
  });

  it("uses package.json name for project name", () => {
    const repo = join(TMP, "repo-pkg");
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "my-cool-project" }),
      "utf-8",
    );
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", false)]);
      const fixes = generateContextFixes(result, repo);
      const mdFix = fixes.find((f) => f.id === "context/claude-md");
      assert.ok(mdFix);
      assert.ok(
        mdFix.diff.includes("# my-cool-project"),
        "should use package.json name",
      );
    } finally {
      teardown();
    }
  });

  it("detects stack from package.json dependencies", () => {
    const repo = join(TMP, "repo-stack");
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({
        name: "test-app",
        dependencies: { react: "^18.0.0", next: "^14.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", false)]);
      const fixes = generateContextFixes(result, repo);
      const mdFix = fixes.find((f) => f.id === "context/claude-md");
      assert.ok(mdFix);
      assert.ok(mdFix.diff.includes("Next.js"));
      assert.ok(mdFix.diff.includes("React"));
      assert.ok(mdFix.diff.includes("TypeScript"));
    } finally {
      teardown();
    }
  });

  it("generates rules directory fix when missing", () => {
    const repo = join(TMP, "repo-no-rules");
    mkdirSync(repo, { recursive: true });
    // No .claude/rules/ exists
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", true)]);
      const fixes = generateContextFixes(result, repo);
      const rulesFix = fixes.find((f) => f.id === "context/rules-dir");
      assert.ok(rulesFix, "should generate rules dir fix");
      assert.ok(rulesFix.diff.includes("Claude Code Rules"));
      assert.equal(
        rulesFix.target_file,
        join(repo, ".claude", "rules", "README.md"),
      );
    } finally {
      teardown();
    }
  });

  it("does not generate rules fix when directory exists", () => {
    const repo = join(TMP, "repo-has-rules");
    mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
    try {
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", true)]);
      const fixes = generateContextFixes(result, repo);
      const rulesFix = fixes.find((f) => f.id === "context/rules-dir");
      assert.equal(rulesFix, undefined);
    } finally {
      teardown();
    }
  });

  it("does not generate CLAUDE.md fix when file already exists", () => {
    const repo = join(TMP, "repo-existing-md");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "CLAUDE.md"), "# Existing", "utf-8");
    try {
      // Even if the check reports false (maybe from a stale scan),
      // the fixer double-checks the filesystem
      const result = makeXRayResult([makeCheck("Project CLAUDE.md", false)]);
      const fixes = generateContextFixes(result, repo);
      const mdFix = fixes.find((f) => f.id === "context/claude-md");
      assert.equal(mdFix, undefined, "should not overwrite existing CLAUDE.md");
    } finally {
      teardown();
    }
  });
});
