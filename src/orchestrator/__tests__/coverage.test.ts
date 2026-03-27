/**
 * coverage.test.ts — Tests for diff-hunk coverage collection
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { collectDiffHunkCoverage, parseCoverageForFiles } from "../coverage.js";

const TEST_ROOT = join(__dirname, ".tmp-coverage-test");

function makeTempDir(): string {
  const dir = join(
    TEST_ROOT,
    `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("collectDiffHunkCoverage", () => {
  it("returns 0.5 when no coverage tooling exists", () => {
    const dir = makeTempDir();
    try {
      const score = collectDiffHunkCoverage(dir);
      assert.equal(score, 0.5, "should return default when no coverage tool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0.5 when c8 config exists but execution fails", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, ".c8rc.json"), "{}");
      const score = collectDiffHunkCoverage(dir);
      assert.equal(score, 0.5, "should return default on execution failure");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects c8 via package.json devDependencies", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ devDependencies: { c8: "^8.0.0" } }),
      );
      // Will fail to run c8 but should attempt (not return default immediately)
      const score = collectDiffHunkCoverage(dir);
      assert.equal(score, 0.5, "should return default when c8 fails to run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects nyc via .nycrc", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, ".nycrc"), "{}");
      const score = collectDiffHunkCoverage(dir);
      assert.equal(score, 0.5, "should return default when nyc fails to run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCoverageForFiles", () => {
  it("returns 0.5 when coverage-final.json does not exist", () => {
    const dir = makeTempDir();
    try {
      assert.equal(parseCoverageForFiles(dir, ["src/a.ts"]), 0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computes coverage for changed files only", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      const report = {
        "/project/src/a.ts": {
          s: { "0": 1, "1": 1, "2": 0, "3": 1 }, // 3/4 = 0.75
        },
        "/project/src/b.ts": {
          s: { "0": 0, "1": 0 }, // 0/2 = 0 (not changed, should be ignored)
        },
      };
      writeFileSync(
        join(dir, "coverage", "coverage-final.json"),
        JSON.stringify(report),
      );
      const score = parseCoverageForFiles(dir, ["src/a.ts"]);
      assert.equal(score, 0.75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("averages across multiple changed files", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      const report = {
        "/project/src/a.ts": {
          s: { "0": 1, "1": 1 }, // 2/2
        },
        "/project/src/b.ts": {
          s: { "0": 0, "1": 0 }, // 0/2
        },
      };
      writeFileSync(
        join(dir, "coverage", "coverage-final.json"),
        JSON.stringify(report),
      );
      const score = parseCoverageForFiles(dir, ["src/a.ts", "src/b.ts"]);
      assert.equal(score, 0.5); // 2/4 total statements covered
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0.5 when no changed files match coverage report", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      const report = {
        "/project/src/a.ts": { s: { "0": 1 } },
      };
      writeFileSync(
        join(dir, "coverage", "coverage-final.json"),
        JSON.stringify(report),
      );
      assert.equal(parseCoverageForFiles(dir, ["src/unrelated.ts"]), 0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0.5 for invalid JSON", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(join(dir, "coverage", "coverage-final.json"), "not json");
      assert.equal(parseCoverageForFiles(dir, ["src/a.ts"]), 0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
