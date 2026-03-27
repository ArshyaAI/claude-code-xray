/**
 * complexity.test.ts — Tests for cyclomatic complexity collection
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  collectComplexity,
  parseCircularOutput,
  parseTsComplexityOutput,
} from "../complexity.js";

const TEST_ROOT = join(__dirname, ".tmp-complexity-test");

function makeTempDir(): string {
  const dir = join(
    TEST_ROOT,
    `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("collectComplexity", () => {
  it("returns 1.0 when no tooling available", () => {
    const dir = makeTempDir();
    try {
      const score = collectComplexity(dir);
      assert.equal(score, 1.0, "should return default when tools unavailable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCircularOutput", () => {
  it("returns count of circular dependency chains", () => {
    const output = JSON.stringify([
      ["a.ts", "b.ts", "a.ts"],
      ["c.ts", "d.ts", "c.ts"],
    ]);
    assert.equal(parseCircularOutput(output), 2);
  });

  it("returns 0 for empty array (no circular deps)", () => {
    assert.equal(parseCircularOutput("[]"), 0);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseCircularOutput("not json"), null);
  });

  it("returns null for non-array JSON", () => {
    assert.equal(parseCircularOutput('{"key": "value"}'), null);
  });
});

describe("parseTsComplexityOutput", () => {
  it("parses top-level average field", () => {
    const output = JSON.stringify({ average: 4.5 });
    assert.equal(parseTsComplexityOutput(output), 4.5);
  });

  it("parses averageComplexity field", () => {
    const output = JSON.stringify({ averageComplexity: 3.2 });
    assert.equal(parseTsComplexityOutput(output), 3.2);
  });

  it("aggregates per-file complexity array", () => {
    const output = JSON.stringify([
      { file: "a.ts", complexity: 4 },
      { file: "b.ts", complexity: 6 },
    ]);
    assert.equal(parseTsComplexityOutput(output), 5);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseTsComplexityOutput("not json"), null);
  });

  it("returns null for empty object", () => {
    assert.equal(parseTsComplexityOutput("{}"), null);
  });

  it("returns null for empty array", () => {
    assert.equal(parseTsComplexityOutput("[]"), null);
  });
});
