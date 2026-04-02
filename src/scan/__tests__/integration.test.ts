/**
 * integration.test.ts — Scan-Fix-Rescan viral thesis test
 *
 * Proves the core value proposition: scan -> fix -> rescan improves the score.
 * Uses a minimal deliberately-bad Claude Code setup in a temp directory.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runXRay } from "../index.js";
import { generateFixes, applyFix } from "../../fix/index.js";

const TMP = join(__dirname, ".tmp-integration-test");
let origHome: string | undefined;

describe("scan-fix-rescan integration", () => {
  before(() => {
    // Save and override HOME so scanners read from the temp dir
    origHome = process.env.HOME;
    process.env.HOME = TMP;

    // Create temp directory structure
    mkdirSync(join(TMP, ".claude"), { recursive: true });

    // Write a deliberately bad settings.json:
    // - bypassPermissions (safety fail)
    // - no deny rules (safety fail)
    // - no sandbox (safety fail)
    writeFileSync(
      join(TMP, ".claude", "settings.json"),
      JSON.stringify(
        {
          permissions: {
            defaultMode: "bypassPermissions",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  after(() => {
    // Restore HOME
    if (origHome !== undefined) {
      process.env.HOME = origHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up
    rmSync(TMP, { recursive: true, force: true });
  });

  it("score improves after applying fixes", () => {
    // 1. Initial scan — should have a low score due to bad config
    const beforeResult = runXRay(TMP);
    const beforeScore = beforeResult.overall_score;

    assert.ok(
      beforeScore < 80,
      `initial score should be low (<80), got ${beforeScore}`,
    );

    // 2. Generate fixes for the bad config
    const fixes = generateFixes(beforeResult, TMP);

    assert.ok(
      fixes.length > 0,
      "should generate at least one fix for the bad config",
    );

    // 3. Apply all fixes (not dry-run)
    for (const fix of fixes) {
      applyFix(fix, false);
    }

    // 4. Rescan — score should improve
    const afterResult = runXRay(TMP);
    const afterScore = afterResult.overall_score;

    assert.ok(
      afterScore > beforeScore,
      `score should improve after fixes: before=${beforeScore}, after=${afterScore}`,
    );

    // 5. Verify specific improvements
    const afterSafety = afterResult.dimensions["safety"];
    assert.ok(afterSafety, "safety dimension should exist after rescan");

    // Deny rules should now be covered
    const denyCheck = afterSafety.checks.find(
      (c) => c.name === "Deny rules for sensitive files",
    );
    assert.ok(denyCheck, "deny rules check should exist");
    assert.equal(denyCheck.passed, true, "deny rules should pass after fix");

    // Sandbox should be enabled
    const sandboxCheck = afterSafety.checks.find(
      (c) => c.name === "Sandbox enabled",
    );
    assert.ok(sandboxCheck, "sandbox check should exist");
    assert.equal(sandboxCheck.passed, true, "sandbox should pass after fix");

    // PreToolUse hook should be present
    const hookCheck = afterSafety.checks.find(
      (c) => c.name === "PreToolUse safety hook",
    );
    assert.ok(hookCheck, "hook check should exist");
    assert.equal(hookCheck.passed, true, "hook should pass after fix");
  });
});
