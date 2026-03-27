/**
 * shadow.integration.test.ts — Integration test for Shadow League pipeline
 *
 * Uses a mock claude agent (shell script) to test the full pipeline:
 * config loading → task parsing → worktree creation → agent dispatch →
 * scoring → promotion decision → cleanup.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runShadowLeague } from "../shadow.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_ROOT = join(__dirname, ".tmp-shadow-integration");

/** Generate a PROGRAM.md with N checkbox items. */
function generateProgramMd(n: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(`- [ ] Task number ${i}`);
    lines.push(`  - Context line for task ${i}`);
  }
  return lines.join("\n") + "\n";
}

/** Create a minimal factory.yaml. */
function writeFactoryYaml(dir: string, archetype = "ts-lib"): void {
  writeFileSync(
    join(dir, "factory.yaml"),
    `archetype: ${archetype}\nmax_crews: 5\ndefault_budget_usd: 100\n`,
    "utf-8",
  );
}

/**
 * Create a mock-agent.sh that simulates a claude agent:
 * - Reads NIGHT-TASK.md from cwd
 * - Creates a dummy file (touch task-done.txt)
 * - Exits 0
 */
function createMockAgent(dir: string): string {
  const mockBinDir = join(dir, ".mock-bin");
  mkdirSync(mockBinDir, { recursive: true });

  // The mock agent is named "claude" so it shadows the real one on PATH
  const mockPath = join(mockBinDir, "claude");
  writeFileSync(
    mockPath,
    [
      "#!/bin/sh",
      "# Mock claude agent for integration tests",
      "# Reads NIGHT-TASK.md from cwd, creates task-done.txt, exits 0",
      'if [ -f "NIGHT-TASK.md" ]; then',
      "  cat NIGHT-TASK.md > /dev/null",
      "fi",
      "touch task-done.txt",
      "exit 0",
    ].join("\n"),
    "utf-8",
  );
  chmodSync(mockPath, 0o755);

  // Also mock npx, npm, tsc to avoid real tool invocations in worktrees
  for (const tool of ["npx", "npm"]) {
    const toolPath = join(mockBinDir, tool);
    writeFileSync(
      toolPath,
      ["#!/bin/sh", "# Mock tool — always succeeds", "exit 0"].join("\n"),
      "utf-8",
    );
    chmodSync(toolPath, 0o755);
  }

  return mockBinDir;
}

/**
 * Initialize a git repo in the given directory with an initial commit.
 * Required for worktree creation.
 */
function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf-8" as BufferEncoding };
  execSync("git init", opts);
  execSync("git config user.email test@test.com", opts);
  execSync("git config user.name Test", opts);
  // Need at least one commit for worktree to work
  writeFileSync(join(dir, ".gitignore"), ".worktrees/\n.mock-bin/\n", "utf-8");
  execSync("git add -A", opts);
  execSync('git commit -m "init"', opts);
}

/**
 * Set up a complete test repo with PROGRAM.md, factory.yaml, git, and mock agent.
 * Returns the mock bin directory path for PATH prepending.
 */
function setupTestRepo(
  taskCount: number,
  archetype = "ts-lib",
): { repoDir: string; mockBinDir: string } {
  const repoDir = join(
    TEST_ROOT,
    `repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(repoDir, { recursive: true });

  writeFileSync(
    join(repoDir, "PROGRAM.md"),
    generateProgramMd(taskCount),
    "utf-8",
  );
  writeFactoryYaml(repoDir, archetype);
  initGitRepo(repoDir);

  const mockBinDir = createMockAgent(repoDir);
  return { repoDir, mockBinDir };
}

/**
 * Run shadow league with PATH overridden to use mock agent.
 * We patch process.env.PATH to prepend the mock bin dir.
 */
function runWithMockAgent(
  repoDir: string,
  mockBinDir: string,
  options: Parameters<typeof runShadowLeague>[0] = {},
) {
  const originalPath = process.env["PATH"];
  try {
    process.env["PATH"] = `${mockBinDir}:${originalPath}`;
    return runShadowLeague({ repo: repoDir, ...options });
  } finally {
    process.env["PATH"] = originalPath;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Shadow League integration", () => {
  // Clean up the entire test root after all tests
  it("dry run parses config and tasks correctly", () => {
    const { repoDir } = setupTestRepo(8);
    try {
      const result = runShadowLeague({ repo: repoDir, dryRun: true });

      assert.equal(result.status, "completed");
      assert.equal(result.crews.length, 0, "dry run should have no crews");
      assert.equal(result.total_cost_usd, 0);
      assert.equal(result.promotion.should_promote, false);
      assert.ok(
        result.run_id.startsWith("run-"),
        "run_id should start with run-",
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("full pipeline: 2 crews, 8 tasks, scoring, promotion", () => {
    const { repoDir, mockBinDir } = setupTestRepo(8);
    try {
      const result = runWithMockAgent(repoDir, mockBinDir, {
        tasks: 8,
        crews: 2,
        seed: 42, // deterministic mutation
      });

      // a. 2 crews created (champion + mutant)
      assert.equal(result.crews.length, 2, "should have 2 crews");
      const labels = result.crews.map((c) => c.label).sort();
      assert.deepEqual(labels, ["champion", "mutant-1"]);

      // b. Each crew ran 8 tasks
      for (const crew of result.crews) {
        assert.equal(
          crew.attempts.length,
          8,
          `${crew.label} should have 8 attempts`,
        );
        assert.equal(
          crew.scores.length,
          8,
          `${crew.label} should have 8 scores`,
        );
      }

      // c. ScoreResults are populated
      for (const crew of result.crews) {
        for (const score of crew.scores) {
          assert.ok(score.genotype_id, "score should have genotype_id");
          assert.ok(score.task_id, "score should have task_id");
          assert.equal(score.stage, "shadow");
          // Utility should be a number (may be 0 if gates failed)
          assert.equal(typeof score.utility, "number");
        }
      }

      // d. Promotion decision is made
      assert.ok(result.promotion, "promotion decision should exist");
      assert.equal(typeof result.promotion.should_promote, "boolean");
      assert.ok(result.promotion.winner_label, "winner_label should be set");
      assert.ok(result.promotion.reason, "reason should be set");

      // e. Worktrees are cleaned up
      const worktreesDir = join(repoDir, ".worktrees");
      if (existsSync(worktreesDir)) {
        // Directory may exist but should be empty (all worktrees removed)
        const remaining = execSync("ls -A", {
          cwd: worktreesDir,
          encoding: "utf-8",
        }).trim();
        assert.equal(remaining, "", "all worktrees should be cleaned up");
      }

      // Status should be completed
      assert.equal(result.status, "completed");
      assert.ok(result.total_duration_sec >= 0);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("attempts have correct structure", () => {
    const { repoDir, mockBinDir } = setupTestRepo(8);
    try {
      const result = runWithMockAgent(repoDir, mockBinDir, {
        tasks: 8,
        crews: 2,
        seed: 42,
      });

      for (const crew of result.crews) {
        for (const attempt of crew.attempts) {
          assert.ok(attempt.task, "attempt should have task");
          assert.ok(attempt.crew, "attempt should have crew config");
          assert.equal(typeof attempt.agent_success, "boolean");
          assert.equal(typeof attempt.duration_sec, "number");
          assert.equal(typeof attempt.cost_usd, "number");
          assert.ok(attempt.metrics, "attempt should have metrics");
          assert.ok(attempt.ci_results, "attempt should have ci_results");
        }
      }
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("aggregate_utility is computed for each crew", () => {
    const { repoDir, mockBinDir } = setupTestRepo(8);
    try {
      const result = runWithMockAgent(repoDir, mockBinDir, {
        tasks: 8,
        crews: 2,
        seed: 42,
      });

      for (const crew of result.crews) {
        assert.equal(typeof crew.aggregate_utility, "number");
        assert.ok(
          crew.aggregate_utility >= 0 && crew.aggregate_utility <= 1,
          `aggregate_utility should be in [0,1], got ${crew.aggregate_utility}`,
        );
      }
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("Shadow League edge cases", () => {
  it("empty PROGRAM.md throws error", () => {
    const repoDir = join(TEST_ROOT, `repo-empty-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    try {
      writeFileSync(
        join(repoDir, "PROGRAM.md"),
        "# Empty program\n\nNo tasks here.\n",
        "utf-8",
      );
      writeFactoryYaml(repoDir);
      initGitRepo(repoDir);

      assert.throws(
        () => runShadowLeague({ repo: repoDir }),
        /No tasks found/,
        "should throw on empty PROGRAM.md",
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("fewer than 8 tasks throws error with clear message", () => {
    const repoDir = join(TEST_ROOT, `repo-few-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    try {
      // Write only 5 tasks
      writeFileSync(join(repoDir, "PROGRAM.md"), generateProgramMd(5), "utf-8");
      writeFactoryYaml(repoDir);
      initGitRepo(repoDir);

      assert.throws(
        () => runShadowLeague({ repo: repoDir }),
        /Need 8 tasks but PROGRAM\.md only has 5/,
        "should throw with clear message about insufficient tasks",
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("minimum 8 tasks requirement is enforced via options", () => {
    const repoDir = join(TEST_ROOT, `repo-min-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    try {
      writeFileSync(
        join(repoDir, "PROGRAM.md"),
        generateProgramMd(10),
        "utf-8",
      );
      writeFactoryYaml(repoDir);
      initGitRepo(repoDir);

      // Requesting fewer than 8 tasks via options should fail
      assert.throws(
        () => runShadowLeague({ repo: repoDir, tasks: 5 }),
        /Minimum 8 tasks required for sign test\. Got: 5/,
        "should enforce minimum tasks in options",
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("invalid factory.yaml archetype throws error", () => {
    const repoDir = join(TEST_ROOT, `repo-badconfig-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    try {
      writeFileSync(join(repoDir, "PROGRAM.md"), generateProgramMd(8), "utf-8");
      writeFileSync(
        join(repoDir, "factory.yaml"),
        "archetype: invalid-type\n",
        "utf-8",
      );
      initGitRepo(repoDir);

      assert.throws(
        () => runShadowLeague({ repo: repoDir }),
        /Invalid factory\.yaml/,
        "should reject invalid archetype",
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
