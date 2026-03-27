/**
 * dispatch.test.ts — Tests for sync and async crew dispatch
 *
 * Verifies that runTaskWithCrewAsync returns the same AttemptResult
 * structure as runTaskWithCrew, using a mock agent.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  runTaskWithCrew,
  runTaskWithCrewAsync,
  createWorktree,
  removeWorktree,
  isActiveWorktree,
  failedWorktreeResult,
  type CrewConfig,
  type DispatchOptions,
} from "../dispatch.js";
import type { Task } from "../tasks.js";
import { SEED_GENOTYPE } from "../../genotype/schema.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_ROOT = join(__dirname, ".tmp-dispatch-test");

function createMockBinDir(dir: string): string {
  const mockBinDir = join(dir, ".mock-bin");
  mkdirSync(mockBinDir, { recursive: true });

  const mockPath = join(mockBinDir, "claude");
  writeFileSync(
    mockPath,
    [
      "#!/bin/sh",
      "# Mock claude agent",
      "touch task-done.txt",
      "echo '{\"cost_usd\": 0.42}'",
      "exit 0",
    ].join("\n"),
    "utf-8",
  );
  chmodSync(mockPath, 0o755);

  for (const tool of ["npx", "npm"]) {
    const toolPath = join(mockBinDir, tool);
    writeFileSync(toolPath, ["#!/bin/sh", "exit 0"].join("\n"), "utf-8");
    chmodSync(toolPath, 0o755);
  }

  return mockBinDir;
}

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf-8" as BufferEncoding };
  execSync("git init", opts);
  execSync("git config user.email test@test.com", opts);
  execSync("git config user.name Test", opts);
  writeFileSync(join(dir, ".gitignore"), ".worktrees/\n.mock-bin/\n", "utf-8");
  execSync("git add -A", opts);
  execSync('git commit -m "init"', opts);
}

function setupTestDir(): { repoDir: string; mockBinDir: string } {
  const repoDir = join(
    TEST_ROOT,
    `repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(repoDir, { recursive: true });
  initGitRepo(repoDir);
  const mockBinDir = createMockBinDir(repoDir);
  return { repoDir, mockBinDir };
}

const TEST_TASK: Task = {
  description: "Test task for dispatch",
  context: ["Some context"],
  hash: "test-hash-001",
};

const TEST_CREW: CrewConfig = {
  genotype: SEED_GENOTYPE,
  label: "test-crew",
};

function makeDispatchOpts(repoDir: string): DispatchOptions {
  return {
    repo_root: repoDir,
    run_id: "test-run-001",
    task_timeout_sec: 30,
    budget_cap_usd: 100,
    keep_worktrees: false,
    archetype: "ts-lib",
    active_roles: ["builder", "reviewer", "qa"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runTaskWithCrewAsync", () => {
  it("returns same structure as runTaskWithCrew", async () => {
    const { repoDir, mockBinDir } = setupTestDir();
    const originalPath = process.env["PATH"];

    try {
      process.env["PATH"] = `${mockBinDir}:${originalPath}`;
      const opts = makeDispatchOpts(repoDir);

      // Create two worktrees — one for sync, one for async
      const wtSync = createWorktree(repoDir, "test-run-001", "sync", "HEAD");
      const wtAsync = createWorktree(repoDir, "test-run-001", "async", "HEAD");

      const syncResult = runTaskWithCrew(TEST_TASK, TEST_CREW, wtSync, opts);
      const asyncResult = await runTaskWithCrewAsync(
        TEST_TASK,
        TEST_CREW,
        wtAsync,
        opts,
      );

      // Same top-level fields
      assert.equal(typeof asyncResult.agent_success, "boolean");
      assert.equal(typeof asyncResult.duration_sec, "number");
      assert.equal(typeof asyncResult.cost_usd, "number");
      assert.ok(asyncResult.metrics, "should have metrics");
      assert.ok(asyncResult.ci_results, "should have ci_results");
      assert.equal(asyncResult.task, TEST_TASK);
      assert.equal(asyncResult.crew, TEST_CREW);

      // Both should succeed with mock agent
      assert.equal(syncResult.agent_success, true, "sync should succeed");
      assert.equal(asyncResult.agent_success, true, "async should succeed");

      // Both should parse cost from mock output
      assert.equal(syncResult.cost_usd, 0.42, "sync cost parsed");
      assert.equal(asyncResult.cost_usd, 0.42, "async cost parsed");

      // CI results structure matches
      assert.equal(typeof asyncResult.ci_results.build_passed, "boolean");
      assert.equal(typeof asyncResult.ci_results.test_passed, "boolean");
      assert.equal(typeof asyncResult.ci_results.lint_passed, "boolean");

      // Metrics structure matches
      const syncKeys = Object.keys(syncResult.metrics).sort();
      const asyncKeys = Object.keys(asyncResult.metrics).sort();
      assert.deepEqual(asyncKeys, syncKeys, "metrics keys should match");

      // Clean up worktrees
      removeWorktree(repoDir, wtSync);
      removeWorktree(repoDir, wtAsync);
    } finally {
      process.env["PATH"] = originalPath;
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("handles worktree conflict by recovering with unique suffix", () => {
    const { repoDir } = setupTestDir();

    try {
      // Create a worktree
      const wt1 = createWorktree(repoDir, "conflict-run", "crew-a", "HEAD");
      assert.ok(existsSync(wt1), "first worktree should exist");
      assert.ok(
        isActiveWorktree(repoDir, wt1),
        "first worktree should be active",
      );

      // Create another worktree with the same run_id + crew_label
      // The existing one should be removed and re-created
      const wt2 = createWorktree(repoDir, "conflict-run", "crew-a", "HEAD");
      assert.ok(existsSync(wt2), "second worktree should exist");
      assert.ok(
        existsSync(join(wt2, ".git")),
        "second worktree should be valid git worktree",
      );

      // Clean up
      removeWorktree(repoDir, wt2);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("failedWorktreeResult returns correct structure", () => {
    const result = failedWorktreeResult(
      TEST_TASK,
      TEST_CREW,
      "worktree_conflict",
    );
    assert.equal(result.agent_success, false);
    assert.equal(result.duration_sec, 0);
    assert.equal(result.cost_usd, 0);
    assert.equal(result.worktree_path, "");
    assert.equal(result.ci_results.build_passed, false);
    assert.equal(result.ci_results.build_reason, "worktree_conflict");
    assert.ok(result.metrics, "should have default metrics");
  });

  it("createWorktree throws when git worktree add fails", () => {
    const { repoDir } = setupTestDir();

    try {
      // Try to create a worktree from a non-existent ref
      assert.throws(
        () =>
          createWorktree(
            repoDir,
            "bad-run",
            "crew-x",
            "non-existent-ref-abc123",
          ),
        /Worktree creation failed/,
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("handles agent failure gracefully", async () => {
    const { repoDir, mockBinDir } = setupTestDir();
    const originalPath = process.env["PATH"];

    try {
      // Overwrite mock claude to fail
      const failMock = join(mockBinDir, "claude");
      writeFileSync(failMock, ["#!/bin/sh", "exit 1"].join("\n"), "utf-8");
      chmodSync(failMock, 0o755);

      process.env["PATH"] = `${mockBinDir}:${originalPath}`;
      const opts = makeDispatchOpts(repoDir);
      const wt = createWorktree(repoDir, "test-run-002", "fail", "HEAD");

      const result = await runTaskWithCrewAsync(TEST_TASK, TEST_CREW, wt, opts);

      assert.equal(result.agent_success, false, "should report failure");
      assert.equal(typeof result.duration_sec, "number");
      assert.equal(typeof result.cost_usd, "number");
      assert.ok(result.metrics, "should still have metrics");

      removeWorktree(repoDir, wt);
    } finally {
      process.env["PATH"] = originalPath;
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
