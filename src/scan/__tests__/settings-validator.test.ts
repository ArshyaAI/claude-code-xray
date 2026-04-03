import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { validateSettings, knownSettingsKeys } from "../settings-validator.js";

describe("validateSettings", () => {
  it("returns valid for an empty settings object", () => {
    const result = validateSettings({}, "user");
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("returns valid for known keys with correct types", () => {
    const result = validateSettings(
      {
        permissions: {
          allow: ["src/**"],
          deny: ["**/.env"],
          defaultMode: "default",
        },
        env: { NODE_ENV: "production" },
        hooks: { PreToolUse: [] },
        sandbox: { enabled: true },
        model: "claude-sonnet-4-20250514",
        enableAllProjectMcpServers: false,
        includeCoAuthoredBy: true,
        mcpServers: {},
        theme: "dark",
        verbosityLevel: "normal",
        cleanupPeriodDays: 30,
        autoMemoryEnabled: true,
      },
      "user",
    );
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("detects unknown top-level keys", () => {
    const result = validateSettings(
      {
        permissions: { allow: [] },
        unknownKey: "value",
        anotherBadKey: 42,
      },
      "project-shared",
    );
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors[0]!.message.includes("unknownKey"));
    assert.ok(result.errors[1]!.message.includes("anotherBadKey"));
    assert.equal(result.errors[0]!.scope, "project-shared");
  });

  it("detects top-level type mismatches", () => {
    const result = validateSettings(
      {
        permissions: "should-be-object",
        model: 42,
        enableAllProjectMcpServers: "yes",
      },
      "user",
    );
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 3);
    const msgs = result.errors.map((e) => e.message);
    assert.ok(
      msgs.some(
        (m) => m.includes("permissions") && m.includes("expected object"),
      ),
    );
    assert.ok(
      msgs.some((m) => m.includes("model") && m.includes("expected string")),
    );
    assert.ok(
      msgs.some(
        (m) =>
          m.includes("enableAllProjectMcpServers") &&
          m.includes("expected boolean"),
      ),
    );
  });

  it("detects invalid enum values for permissions.defaultMode", () => {
    const result = validateSettings(
      {
        permissions: { defaultMode: "turbo" },
      },
      "user",
    );
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]!.message.includes("turbo"));
    assert.ok(result.errors[0]!.message.includes("Allowed"));
    assert.equal(result.errors[0]!.path, "permissions.defaultMode");
  });

  it("passes for valid enum value", () => {
    const result = validateSettings(
      {
        permissions: { defaultMode: "plan" },
      },
      "user",
    );
    assert.equal(result.valid, true);
  });

  it("detects nested type mismatches", () => {
    const result = validateSettings(
      {
        permissions: { allow: "should-be-array", deny: 42 },
      },
      "project-local",
    );
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors[0]!.path.includes("permissions.allow"));
    assert.ok(result.errors[1]!.path.includes("permissions.deny"));
  });

  it("includes scope in all error objects", () => {
    const result = validateSettings({ badKey: true }, "my-scope");
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.scope, "my-scope");
  });
});

describe("knownSettingsKeys", () => {
  it("returns a non-empty set of known keys", () => {
    const keys = knownSettingsKeys();
    assert.ok(keys.size > 0);
    assert.ok(keys.has("permissions"));
    assert.ok(keys.has("hooks"));
    assert.ok(keys.has("sandbox"));
    assert.ok(keys.has("env"));
    assert.ok(keys.has("model"));
    assert.ok(keys.has("enableAllProjectMcpServers"));
    assert.ok(keys.has("autoMemoryEnabled"));
  });
});
