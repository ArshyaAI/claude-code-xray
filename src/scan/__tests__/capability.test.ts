import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanCapability } from "../capability.js";

const TMP = join(__dirname, ".tmp-test-capability");

function setup(): string {
  const repo = join(TMP, "repo");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  // Create a package.json so detect-archetype can find a project
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "test-project" }),
    "utf-8",
  );
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

describe("scanCapability", () => {
  it("returns a DimensionScore with name Capability", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanCapability(repo);
      assert.equal(result.name, "Capability");
      assert.equal(result.weight, 0.25);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("has 7 checks (features, schema, skills, coordinator, project settings, CLAUDE.md, MCP)", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanCapability(repo);
      assert.equal(result.checks.length, 7);
      const names = result.checks.map((c) => c.name);
      assert.ok(names.includes("Active features"));
      assert.ok(names.includes("Schema validity"));
      assert.ok(names.includes("Archetype skills"));
      assert.ok(names.includes("Coordinator available"));
      assert.ok(names.includes("Project-level settings"));
      assert.ok(names.includes("Project CLAUDE.md"));
      assert.ok(names.includes("MCP servers configured"));
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("detects unknown settings keys as schema failure", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {
        permissions: {},
        unknownKey123: true,
        anotherBadKey: "test",
      });
      const result = scanCapability(repo);
      const schemaCheck = result.checks.find(
        (c) => c.name === "Schema validity",
      );
      assert.ok(schemaCheck);
      assert.equal(schemaCheck.passed, false);
      assert.ok(
        String(schemaCheck.value).includes("unknownKey123"),
        "should mention unknown key",
      );
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("passes schema check when all keys are known", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, { permissions: {}, hooks: {}, model: "opus" });
      const result = scanCapability(repo);
      const schemaCheck = result.checks.find(
        (c) => c.name === "Schema validity",
      );
      assert.ok(schemaCheck);
      assert.equal(schemaCheck.passed, true);
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("coordinator check respects CLAUDE_CODE_COORDINATOR_MODE env", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });

    const origCoord = process.env.CLAUDE_CODE_COORDINATOR_MODE;
    try {
      writeProjectSettings(repo, {});

      // Test with coordinator enabled
      process.env.CLAUDE_CODE_COORDINATOR_MODE = "1";
      const enabled = scanCapability(repo);
      const coordEnabled = enabled.checks.find(
        (c) => c.name === "Coordinator available",
      );
      assert.ok(coordEnabled);
      assert.equal(coordEnabled.passed, true);

      // Test with coordinator disabled
      delete process.env.CLAUDE_CODE_COORDINATOR_MODE;
      const disabled = scanCapability(repo);
      const coordDisabled = disabled.checks.find(
        (c) => c.name === "Coordinator available",
      );
      assert.ok(coordDisabled);
      assert.equal(coordDisabled.passed, false);
    } finally {
      if (origCoord !== undefined) {
        process.env.CLAUDE_CODE_COORDINATOR_MODE = origCoord;
      } else {
        delete process.env.CLAUDE_CODE_COORDINATOR_MODE;
      }
      process.env.HOME = origHome;
      teardown();
    }
  });

  it("score is at least 10 when checks run", () => {
    const repo = setup();
    const origHome = process.env.HOME;
    process.env.HOME = join(TMP, "fake-home");
    mkdirSync(join(TMP, "fake-home", ".claude"), { recursive: true });
    try {
      writeProjectSettings(repo, {});
      const result = scanCapability(repo);
      assert.ok(
        result.score >= 10,
        `score should be >= 10 but was ${result.score}`,
      );
    } finally {
      process.env.HOME = origHome;
      teardown();
    }
  });
});
