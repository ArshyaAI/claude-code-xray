/**
 * doc-coverage.test.ts — Tests for documentation coverage collection
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  collectDocCoverage,
  countDocumentedExports,
  parseTypedocOutput,
  tryJsdocHeuristic,
} from "../doc-coverage.js";

const TEST_ROOT = join(__dirname, ".tmp-doc-coverage-test");

function makeTempDir(): string {
  const dir = join(
    TEST_ROOT,
    `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("collectDocCoverage", () => {
  it("returns 0.3 when no tooling is available", () => {
    const dir = makeTempDir();
    try {
      const score = collectDocCoverage(dir);
      assert.equal(score, 0.3, "should return default when nothing available");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses JSDoc heuristic when src/ exists with .ts files", () => {
    const dir = makeTempDir();
    try {
      const srcDir = join(dir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, "index.ts"),
        [
          "/** Documented function */",
          "export function foo() {}",
          "",
          "export function bar() {}",
        ].join("\n"),
      );
      const score = collectDocCoverage(dir);
      assert.equal(score, 0.5, "1 of 2 exports documented = 0.5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("countDocumentedExports", () => {
  it("counts documented and undocumented exports", () => {
    const content = [
      "/** A documented function */",
      "export function documented() {}",
      "",
      "export function undocumented() {}",
      "",
      "/**",
      " * Multi-line JSDoc",
      " */",
      "export class MyClass {}",
    ].join("\n");
    const result = countDocumentedExports(content);
    assert.equal(result.total, 3);
    assert.equal(result.documented, 2);
  });

  it("returns zero for content with no exports", () => {
    const result = countDocumentedExports("const x = 1;\nfunction y() {}");
    assert.equal(result.total, 0);
    assert.equal(result.documented, 0);
  });

  it("handles all export types", () => {
    const content = [
      "/** doc */",
      "export const A = 1;",
      "/** doc */",
      "export let B = 2;",
      "/** doc */",
      "export type C = string;",
      "/** doc */",
      "export interface D {}",
      "/** doc */",
      "export enum E {}",
      "export var F = 3;",
    ].join("\n");
    const result = countDocumentedExports(content);
    assert.equal(result.total, 6);
    assert.equal(result.documented, 5);
  });

  it("skips regular comments (not JSDoc)", () => {
    const content = ["// just a comment", "export function foo() {}"].join(
      "\n",
    );
    const result = countDocumentedExports(content);
    assert.equal(result.total, 1);
    assert.equal(result.documented, 0);
  });

  it("handles blank lines between JSDoc and export", () => {
    const content = ["/** Documented */", "", "export function foo() {}"].join(
      "\n",
    );
    const result = countDocumentedExports(content);
    assert.equal(result.total, 1);
    assert.equal(result.documented, 1);
  });
});

describe("parseTypedocOutput", () => {
  it("computes coverage from children with comments", () => {
    const output = JSON.stringify({
      children: [
        { comment: { summary: [{ kind: "text", text: "desc" }] } },
        { comment: { summary: [] } },
        {},
      ],
    });
    const score = parseTypedocOutput(output);
    assert.ok(score !== null);
    assert.ok(Math.abs(score - 1 / 3) < 0.01);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseTypedocOutput("not json"), null);
  });

  it("returns null for empty children", () => {
    assert.equal(parseTypedocOutput(JSON.stringify({ children: [] })), null);
  });

  it("returns null for no children key", () => {
    assert.equal(parseTypedocOutput(JSON.stringify({})), null);
  });
});

describe("tryJsdocHeuristic", () => {
  it("returns null when no src/ directory exists", () => {
    const dir = makeTempDir();
    try {
      assert.equal(tryJsdocHeuristic(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when src/ has no .ts files", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "readme.md"), "# Hello");
      assert.equal(tryJsdocHeuristic(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans nested directories", () => {
    const dir = makeTempDir();
    try {
      const nested = join(dir, "src", "utils");
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(nested, "helpers.ts"),
        [
          "/** Helper */",
          "export function helper() {}",
          "/** Another */",
          "export function another() {}",
        ].join("\n"),
      );
      const score = tryJsdocHeuristic(dir);
      assert.equal(score, 1.0, "2/2 documented = 1.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
