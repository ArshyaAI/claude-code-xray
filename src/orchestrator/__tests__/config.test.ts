import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.js";

const TMP = join(__dirname, ".tmp-test-config");

function setup() {
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

function writeYaml(content: string): void {
  writeFileSync(join(TMP, "factory.yaml"), content, "utf-8");
}

describe("loadConfig", () => {
  it("returns defaults when factory.yaml missing", () => {
    setup();
    try {
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.equal(result.config.archetype, "ts-lib");
      assert.equal(result.config.max_crews, 5);
      assert.equal(result.config.default_budget_usd, 50);
      assert.equal(result.config.task_source, "PROGRAM.md");
      assert.deepEqual(result.config.active_roles, [
        "builder",
        "reviewer",
        "qa",
      ]);
    } finally {
      teardown();
    }
  });

  it("parses valid factory.yaml", () => {
    setup();
    try {
      writeYaml(
        "archetype: nextjs-app\nmax_crews: 3\ndefault_budget_usd: 25\n",
      );
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.equal(result.config.archetype, "nextjs-app");
      assert.equal(result.config.max_crews, 3);
      assert.equal(result.config.default_budget_usd, 25);
    } finally {
      teardown();
    }
  });

  it("rejects invalid archetype", () => {
    setup();
    try {
      writeYaml("archetype: invalid-type\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("Invalid archetype")));
    } finally {
      teardown();
    }
  });

  it("rejects max_crews out of range", () => {
    setup();
    try {
      writeYaml("max_crews: 99\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("max_crews")));
    } finally {
      teardown();
    }
  });

  it("rejects negative budget", () => {
    setup();
    try {
      writeYaml("default_budget_usd: -10\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("default_budget_usd")));
    } finally {
      teardown();
    }
  });

  it("parses active_roles list", () => {
    setup();
    try {
      writeYaml("active_roles:\n  - builder\n  - qa\n");
      const result = loadConfig(TMP);
      assert.equal(result.valid, true);
      assert.deepEqual(result.config.active_roles, ["builder", "qa"]);
    } finally {
      teardown();
    }
  });
});
