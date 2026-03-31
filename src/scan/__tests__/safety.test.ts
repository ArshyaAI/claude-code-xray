import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanSafety } from "../safety.js";

const TMP = join(__dirname, ".tmp-test-safety");

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

describe("scanSafety", () => {
  it("returns zero score and alert when no settings files exist", () => {
    mkdirSync(TMP, { recursive: true });
    try {
      // Use a path that definitely has no settings
      const emptyRepo = join(TMP, "empty-repo");
      mkdirSync(emptyRepo, { recursive: true });

      // Override HOME to avoid picking up real user settings
      const origHome = process.env.HOME;
      process.env.HOME = join(TMP, "fake-home");
      mkdirSync(join(TMP, "fake-home"), { recursive: true });
      try {
        const result = scanSafety(emptyRepo);
        assert.equal(result.dimension.score, 0);
        assert.equal(result.dimension.checks.length, 0);
        assert.ok(result.alerts.length > 0);
        assert.equal(result.alerts[0]!.check, "no_settings");
      } finally {
        process.env.HOME = origHome;
      }
    } finally {
      teardown();
    }
  });

  it("detects bypassPermissions mode as failing", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: { defaultMode: "bypassPermissions" },
      });
      const result = scanSafety(repo);
      const modeCheck = result.dimension.checks.find(
        (c) => c.name === "Permission mode",
      );
      assert.ok(modeCheck, "should have permission mode check");
      assert.equal(modeCheck.passed, false);
      assert.equal(modeCheck.fix_available, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes permission mode check for default mode", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: { defaultMode: "default" },
      });
      const result = scanSafety(repo);
      const modeCheck = result.dimension.checks.find(
        (c) => c.name === "Permission mode",
      );
      assert.ok(modeCheck);
      assert.equal(modeCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects missing deny rules", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { permissions: { deny: [] } });
      const result = scanSafety(repo);
      const denyCheck = result.dimension.checks.find(
        (c) => c.name === "Deny rules for sensitive files",
      );
      assert.ok(denyCheck);
      assert.equal(denyCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes deny rules when sufficient patterns are covered", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: {
          deny: [
            "**/.env",
            "**/secrets/**",
            "**/credentials/**",
            "**/*.pem",
            "**/id_rsa",
          ],
        },
      });
      const result = scanSafety(repo);
      const denyCheck = result.dimension.checks.find(
        (c) => c.name === "Deny rules for sensitive files",
      );
      assert.ok(denyCheck);
      assert.equal(denyCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects sandbox disabled", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { sandbox: { enabled: false } });
      const result = scanSafety(repo);
      const sandboxCheck = result.dimension.checks.find(
        (c) => c.name === "Sandbox enabled",
      );
      assert.ok(sandboxCheck);
      assert.equal(sandboxCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes sandbox check when enabled", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { sandbox: { enabled: true } });
      const result = scanSafety(repo);
      const sandboxCheck = result.dimension.checks.find(
        (c) => c.name === "Sandbox enabled",
      );
      assert.ok(sandboxCheck);
      assert.equal(sandboxCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects MCP auto-trust as failing", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { enableAllProjectMcpServers: true });
      const result = scanSafety(repo);
      const mcpCheck = result.dimension.checks.find(
        (c) => c.name === "MCP server trust model",
      );
      assert.ok(mcpCheck);
      assert.equal(mcpCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects missing PreToolUse hook", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { hooks: {} });
      const result = scanSafety(repo);
      const hookCheck = result.dimension.checks.find(
        (c) => c.name === "PreToolUse safety hook",
      );
      assert.ok(hookCheck);
      assert.equal(hookCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes PreToolUse hook when present", () => {
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
              hooks: [{ type: "command", command: "echo ok" }],
            },
          ],
        },
      });
      const result = scanSafety(repo);
      const hookCheck = result.dimension.checks.find(
        (c) => c.name === "PreToolUse safety hook",
      );
      assert.ok(hookCheck);
      assert.equal(hookCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects bash deny gap (deny rules without sandbox)", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: { deny: ["**/.env"] },
      });
      const result = scanSafety(repo);
      const gapCheck = result.dimension.checks.find(
        (c) => c.name === "Bash subprocess deny gap",
      );
      assert.ok(gapCheck);
      assert.equal(gapCheck.passed, false);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("generates security alerts for failing checks", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: { defaultMode: "bypassPermissions" },
        enableAllProjectMcpServers: true,
      });
      const result = scanSafety(repo);
      assert.ok(result.alerts.length > 0);
      const severities = result.alerts.map((a) => a.severity);
      assert.ok(severities.includes("critical"), "should have critical alerts");
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("calculates score with floor of 10 when any checks run", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      // All checks will fail but score should be at least 10
      writeProjectSettings(repo, {
        permissions: { defaultMode: "bypassPermissions", deny: [] },
        enableAllProjectMcpServers: true,
      });
      const result = scanSafety(repo);
      assert.ok(result.dimension.score >= 10);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("dimension name is Safety & Security with weight 0.3", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanSafety(repo);
      assert.equal(result.dimension.name, "Safety & Security");
      assert.equal(result.dimension.weight, 0.3);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
