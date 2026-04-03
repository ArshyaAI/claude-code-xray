import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consolidateMemory } from "../memory-consolidator.js";

const TMP = join(__dirname, ".tmp-test-memory-consolidator");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function makeLargeMemory(lineCount: number): string {
  const sections = [
    "# Project Memory\n",
    "## Section A\n",
    ...Array.from(
      { length: Math.floor(lineCount / 4) },
      (_, i) => `- Entry A${i}`,
    ),
    "\n## Section B\n",
    ...Array.from(
      { length: Math.floor(lineCount / 4) },
      (_, i) => `- Entry B${i}`,
    ),
    "\n## Section C\n",
    ...Array.from(
      { length: Math.floor(lineCount / 4) },
      (_, i) => `- Entry C${i}`,
    ),
    "\n## Section A\n", // Duplicate heading (different content goes here)
    ...Array.from(
      { length: Math.floor(lineCount / 4) },
      (_, i) => `- Entry A${i}`,
    ), // Duplicate lines
  ];
  return sections.join("\n");
}

describe("consolidateMemory", () => {
  it("returns no-file message when MEMORY.md does not exist", () => {
    const repo = join(TMP, "repo-none");
    mkdirSync(repo, { recursive: true });
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-none");
    mkdirSync(join(TMP, "fake-home-none"), { recursive: true });
    try {
      const result = consolidateMemory(repo, true);
      assert.equal(result.before, 0);
      assert.equal(result.after, 0);
      assert.ok(result.diff.includes("No MEMORY.md found"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("skips consolidation when under 200 lines", () => {
    const repo = join(TMP, "repo-small");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(
      join(repo, ".claude", "MEMORY.md"),
      "# Memory\n\n- Short entry\n",
      "utf-8",
    );
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-small");
    mkdirSync(join(TMP, "fake-home-small"), { recursive: true });
    try {
      const result = consolidateMemory(repo, true);
      assert.ok(result.before <= 200);
      assert.equal(result.before, result.after);
      assert.ok(result.diff.includes("No consolidation needed"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("deduplicates and consolidates large MEMORY.md (dry run)", () => {
    const repo = join(TMP, "repo-large");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const content = makeLargeMemory(300);
    const memPath = join(repo, ".claude", "MEMORY.md");
    writeFileSync(memPath, content, "utf-8");
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-large");
    mkdirSync(join(TMP, "fake-home-large"), { recursive: true });
    try {
      const result = consolidateMemory(repo, true);
      assert.ok(
        result.before > 200,
        `before should be > 200, got ${result.before}`,
      );
      assert.ok(
        result.after < result.before,
        "after should be < before (dedup)",
      );
      // File should NOT be modified in dry run
      const afterContent = readFileSync(memPath, "utf-8");
      assert.equal(
        afterContent,
        content,
        "file should be unchanged in dry run",
      );
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("writes consolidated content when not dry run", () => {
    const repo = join(TMP, "repo-write");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const content = makeLargeMemory(300);
    const memPath = join(repo, ".claude", "MEMORY.md");
    writeFileSync(memPath, content, "utf-8");
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-write");
    mkdirSync(join(TMP, "fake-home-write"), { recursive: true });
    try {
      const result = consolidateMemory(repo, false);
      assert.ok(result.after < result.before);
      // File should be modified
      const afterContent = readFileSync(memPath, "utf-8");
      const afterLines = afterContent.split("\n").length;
      assert.equal(afterLines, result.after);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("finds user-level MEMORY.md when project-level absent", () => {
    const repo = join(TMP, "repo-user-level");
    mkdirSync(repo, { recursive: true });
    const origHome = process.env.HOME;
    const fakeHome = join(TMP, "fake-home-user");
    process.env.HOME = fakeHome;
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    const content = makeLargeMemory(250);
    writeFileSync(join(fakeHome, ".claude", "MEMORY.md"), content, "utf-8");
    try {
      const result = consolidateMemory(repo, true);
      assert.ok(result.before > 200);
      assert.ok(result.diff.includes(join(fakeHome, ".claude", "MEMORY.md")));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("produces meaningful diff output", () => {
    const repo = join(TMP, "repo-diff");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const content = makeLargeMemory(300);
    writeFileSync(join(repo, ".claude", "MEMORY.md"), content, "utf-8");
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home-diff");
    mkdirSync(join(TMP, "fake-home-diff"), { recursive: true });
    try {
      const result = consolidateMemory(repo, true);
      // Diff should mention removed lines
      assert.ok(
        result.diff.includes("Removed") || result.diff.includes("No changes"),
        "diff should describe changes",
      );
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
