import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanAutomation } from "../automation.js";

const TMP = join(__dirname, ".tmp-test-automation");

function setup(): string {
  const repo = join(TMP, "repo");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  return repo;
}

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function writeProjectSettings(repo: string, data: unknown): void {
  writeFileSync(
    join(repo, ".claude", "settings.json"),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

describe("scanAutomation", () => {
  it("returns a DimensionScore with name Automation & Workflow", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanAutomation(repo);
      assert.equal(result.name, "Automation & Workflow");
      assert.equal(result.weight, 0.25);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("has 4 checks (hooks, dead scripts, claude.md, memory)", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanAutomation(repo);
      assert.equal(result.checks.length, 4);
      const names = result.checks.map((c) => c.name);
      assert.ok(names.includes("Hook coverage"));
      assert.ok(names.includes("Dead hook scripts"));
      assert.ok(names.includes("CLAUDE.md hierarchy"));
      assert.ok(names.includes("Memory health"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes hook coverage when enough key events are covered", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      // Cover 5 key events: PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit
      const hooks: Record<string, unknown[]> = {};
      for (const event of [
        "PreToolUse",
        "PostToolUse",
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
      ]) {
        hooks[event] = [
          {
            matcher: ".*",
            hooks: [{ type: "command", command: "echo ok" }],
          },
        ];
      }
      writeProjectSettings(repo, { hooks });
      const result = scanAutomation(repo);
      const hookCheck = result.checks.find((c) => c.name === "Hook coverage");
      assert.ok(hookCheck);
      assert.equal(hookCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("fails hook coverage when fewer than 5 key events covered", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        hooks: {
          PreToolUse: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "echo ok" }],
            },
          ],
        },
      });
      const result = scanAutomation(repo);
      const hookCheck = result.checks.find((c) => c.name === "Hook coverage");
      assert.ok(hookCheck);
      assert.equal(hookCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes dead hook scripts when command scripts exist", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      // Use an inline shell expression (not a file path) so it won't be
      // validated as a file
      writeProjectSettings(repo, {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo hello && echo world" }],
            },
          ],
        },
      });
      const result = scanAutomation(repo);
      const deadCheck = result.checks.find(
        (c) => c.name === "Dead hook scripts",
      );
      assert.ok(deadCheck);
      assert.equal(deadCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects dead hook scripts pointing to non-existent files", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "/nonexistent/path/to/script.sh",
                },
              ],
            },
          ],
        },
      });
      const result = scanAutomation(repo);
      const deadCheck = result.checks.find(
        (c) => c.name === "Dead hook scripts",
      );
      assert.ok(deadCheck);
      assert.equal(deadCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes CLAUDE.md hierarchy when user and project levels exist", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      // Create user-level and project-level CLAUDE.md
      writeFileSync(
        join(TMP, "fake-home", ".claude", "CLAUDE.md"),
        "# User CLAUDE.md",
        "utf-8",
      );
      writeFileSync(join(repo, "CLAUDE.md"), "# Project CLAUDE.md", "utf-8");

      const result = scanAutomation(repo);
      const mdCheck = result.checks.find(
        (c) => c.name === "CLAUDE.md hierarchy",
      );
      assert.ok(mdCheck);
      assert.equal(mdCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("fails CLAUDE.md hierarchy when project-level is missing", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      // Only create user-level, not project-level
      writeFileSync(
        join(TMP, "fake-home", ".claude", "CLAUDE.md"),
        "# User CLAUDE.md",
        "utf-8",
      );

      const result = scanAutomation(repo);
      const mdCheck = result.checks.find(
        (c) => c.name === "CLAUDE.md hierarchy",
      );
      assert.ok(mdCheck);
      assert.equal(mdCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("score is at least 10 when checks exist", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanAutomation(repo);
      assert.ok(result.score >= 10);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
