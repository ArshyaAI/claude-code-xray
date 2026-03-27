/**
 * mutation-testing.test.ts — Tests for Stryker mutation score collection
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  collectMutationScore,
  parseStrykerOutput,
} from "../mutation-testing.js";

const TEST_ROOT = join(__dirname, ".tmp-mutation-test");

function makeTempDir(): string {
  const dir = join(
    TEST_ROOT,
    `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("collectMutationScore", () => {
  it("returns 0.5 when no stryker config exists", () => {
    const dir = makeTempDir();
    try {
      const score = collectMutationScore(dir);
      assert.equal(score, 0.5, "should return default when no config");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0.5 when stryker execution fails", () => {
    const dir = makeTempDir();
    try {
      // Create a stryker config so it tries to run, but npx stryker will fail
      writeFileSync(join(dir, "stryker.conf.js"), "module.exports = {};");
      const score = collectMutationScore(dir);
      assert.equal(score, 0.5, "should return default on execution failure");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseStrykerOutput", () => {
  it("parses top-level mutationScore", () => {
    const output = JSON.stringify({ mutationScore: 85.7 });
    assert.equal(parseStrykerOutput(output), 0.857);
  });

  it("aggregates per-file scores", () => {
    const output = JSON.stringify({
      files: {
        "src/a.ts": { mutationScore: 80 },
        "src/b.ts": { mutationScore: 60 },
      },
    });
    assert.equal(parseStrykerOutput(output), 0.7);
  });

  it("returns default for invalid JSON", () => {
    assert.equal(parseStrykerOutput("not json"), 0.5);
  });

  it("returns default for empty object", () => {
    assert.equal(parseStrykerOutput("{}"), 0.5);
  });

  it("clamps score above 100 to 1.0", () => {
    const output = JSON.stringify({ mutationScore: 150 });
    assert.equal(parseStrykerOutput(output), 1.0);
  });

  it("clamps negative score to 0", () => {
    const output = JSON.stringify({ mutationScore: -10 });
    assert.equal(parseStrykerOutput(output), 0);
  });
});
