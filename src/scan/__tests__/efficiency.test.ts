import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanEfficiency } from "../efficiency.js";

const TMP = join(__dirname, ".tmp-test-efficiency");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

/**
 * Create a mock session JSONL file with usage data.
 * Only includes message.usage (privacy-safe), never message.content.
 */
function writeSessionFile(
  dir: string,
  filename: string,
  entries: Array<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }>,
): void {
  const lines = entries.map((usage) => JSON.stringify({ message: { usage } }));
  writeFileSync(join(dir, filename), lines.join("\n") + "\n", "utf-8");
}

describe("scanEfficiency", () => {
  it("returns score 0 when no project directory exists", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home"), { recursive: true });
    try {
      const result = scanEfficiency(join(TMP, "nonexistent-repo"));
      assert.equal(result.score, 0);
      assert.equal(result.name, "Efficiency");
      assert.equal(result.weight, 0.2);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("returns score 0 when project directory exists but has no session files", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    // Create the project directory with the slug matching the repo
    const repoPath = join(TMP, "my-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      const result = scanEfficiency(repoPath);
      assert.equal(result.score, 0);
      assert.equal(result.checks.length, 1);
      assert.equal(result.checks[0]!.name, "Session data");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("computes cache hit ratio from session transcripts", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "cache-test-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      // Create 3+ session files with high cache hit ratios
      for (let i = 0; i < 4; i++) {
        writeSessionFile(projectDir, `session-${i}.jsonl`, [
          {
            input_tokens: 100,
            output_tokens: 200,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 800,
          },
        ]);
      }

      const result = scanEfficiency(repoPath);
      const cacheCheck = result.checks.find(
        (c) => c.name === "Cache hit ratio",
      );
      assert.ok(cacheCheck, "should have cache hit ratio check");
      // 800/(800+100+50) = ~84% per file, aggregated same ratio
      assert.equal(cacheCheck.passed, true, "high cache ratio should pass");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("fails cache hit ratio when it is below 60%", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "low-cache-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      for (let i = 0; i < 4; i++) {
        writeSessionFile(projectDir, `session-${i}.jsonl`, [
          {
            input_tokens: 800,
            output_tokens: 200,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
          },
        ]);
      }

      const result = scanEfficiency(repoPath);
      const cacheCheck = result.checks.find(
        (c) => c.name === "Cache hit ratio",
      );
      assert.ok(cacheCheck);
      // 50/(50+800+100) = ~5%
      assert.equal(cacheCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes session activity when 3+ sessions exist", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "active-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      for (let i = 0; i < 5; i++) {
        writeSessionFile(projectDir, `session-${i}.jsonl`, [
          { input_tokens: 100, output_tokens: 50 },
        ]);
      }

      const result = scanEfficiency(repoPath);
      const activityCheck = result.checks.find(
        (c) => c.name === "Session activity",
      );
      assert.ok(activityCheck);
      assert.equal(activityCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("fails session activity when fewer than 3 sessions exist", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "inactive-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      // Only 2 sessions
      for (let i = 0; i < 2; i++) {
        writeSessionFile(projectDir, `session-${i}.jsonl`, [
          { input_tokens: 100, output_tokens: 50 },
        ]);
      }

      const result = scanEfficiency(repoPath);
      const activityCheck = result.checks.find(
        (c) => c.name === "Session activity",
      );
      assert.ok(activityCheck);
      assert.equal(activityCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("includes cost trend check (always passes, informational)", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "cost-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      writeSessionFile(projectDir, "session-0.jsonl", [
        { input_tokens: 100, output_tokens: 50 },
      ]);

      const result = scanEfficiency(repoPath);
      const costCheck = result.checks.find(
        (c) => c.name === "Cost trend (total tokens)",
      );
      assert.ok(costCheck, "should have cost trend check");
      assert.equal(
        costCheck.passed,
        true,
        "cost trend is always informational",
      );
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("handles malformed JSONL lines gracefully", () => {
    mkdirSync(TMP, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");

    const repoPath = join(TMP, "malformed-repo");
    const slug = repoPath.replace(/\//g, "-");
    const projectDir = join(TMP, "fake-home", ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    try {
      // Write malformed + valid data
      const content = [
        "not-valid-json",
        "{}",
        JSON.stringify({
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        }),
        "",
      ].join("\n");
      writeFileSync(join(projectDir, "session-0.jsonl"), content, "utf-8");
      writeFileSync(join(projectDir, "session-1.jsonl"), content, "utf-8");
      writeFileSync(join(projectDir, "session-2.jsonl"), content, "utf-8");

      // Should not throw
      const result = scanEfficiency(repoPath);
      assert.ok(result.score >= 0);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
