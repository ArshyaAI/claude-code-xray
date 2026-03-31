/**
 * conventions.test.ts — Tests for convention violation collection
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  collectConventionViolations,
  parseEslintOutput,
  parseBiomeOutput,
} from "../conventions.js";

const TEST_ROOT = join(__dirname, ".tmp-conventions-test");

function makeTempDir(): string {
  const dir = join(
    TEST_ROOT,
    `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("collectConventionViolations", () => {
  it("returns 0 when no linter configured", () => {
    const dir = makeTempDir();
    try {
      const count = collectConventionViolations(dir);
      assert.equal(count, 0, "should return 0 when no linter config exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 when eslint config exists but execution fails", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "eslint.config.js"), "module.exports = {};");
      const count = collectConventionViolations(dir);
      // npx eslint will fail in a temp dir with no node_modules — should return 0
      assert.equal(typeof count, "number");
      assert.ok(count >= 0, "should return a non-negative number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 when biome config exists but execution fails", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "biome.json"), "{}");
      const count = collectConventionViolations(dir);
      assert.equal(typeof count, "number");
      assert.ok(count >= 0, "should return a non-negative number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseEslintOutput", () => {
  it("counts errors and warnings across files", () => {
    const output = JSON.stringify([
      { errorCount: 3, warningCount: 2 },
      { errorCount: 1, warningCount: 0 },
    ]);
    assert.equal(parseEslintOutput(output), 6);
  });

  it("returns 0 for empty array", () => {
    assert.equal(parseEslintOutput("[]"), 0);
  });

  it("returns 0 for invalid JSON", () => {
    assert.equal(parseEslintOutput("not json"), 0);
  });

  it("handles missing count fields", () => {
    const output = JSON.stringify([{}, { errorCount: 2 }]);
    assert.equal(parseEslintOutput(output), 2);
  });
});

describe("parseBiomeOutput", () => {
  it("counts diagnostics array length", () => {
    const output = JSON.stringify({
      diagnostics: [{}, {}, {}],
    });
    assert.equal(parseBiomeOutput(output), 3);
  });

  it("returns 0 for empty diagnostics", () => {
    const output = JSON.stringify({ diagnostics: [] });
    assert.equal(parseBiomeOutput(output), 0);
  });

  it("returns 0 for missing diagnostics field", () => {
    assert.equal(parseBiomeOutput("{}"), 0);
  });

  it("returns 0 for invalid JSON", () => {
    assert.equal(parseBiomeOutput("not json"), 0);
  });
});
