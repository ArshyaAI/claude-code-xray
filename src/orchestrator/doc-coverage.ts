/**
 * doc-coverage.ts — Collect documentation coverage metrics
 *
 * Opt-in: projects with typedoc config get real scores from typedoc JSON output.
 * Projects without typedoc get a JSDoc heuristic (documented exports / total exports).
 * Falls back to 0.3 if nothing works.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_DOC_COVERAGE = 0.3;
const TYPEDOC_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Collect documentation coverage from a worktree.
 * Returns a value in [0, 1]. Falls back to 0.3 if no tooling is available.
 */
export function collectDocCoverage(worktreePath: string): number {
  // Try typedoc first
  const typedocScore = tryTypedoc(worktreePath);
  if (typedocScore !== null) return typedocScore;

  // Fall back to JSDoc heuristic
  const jsdocScore = tryJsdocHeuristic(worktreePath);
  if (jsdocScore !== null) return jsdocScore;

  return DEFAULT_DOC_COVERAGE;
}

/**
 * Check for typedoc config and run it if available.
 */
function tryTypedoc(worktreePath: string): number | null {
  const hasTypedocJson = existsSync(join(worktreePath, "typedoc.json"));

  let hasTypedocInTsconfig = false;
  if (!hasTypedocJson) {
    try {
      const tsconfig = readFileSync(
        join(worktreePath, "tsconfig.json"),
        "utf-8",
      );
      hasTypedocInTsconfig = tsconfig.includes('"typedocOptions"');
    } catch {
      // no tsconfig or unreadable
    }
  }

  if (!hasTypedocJson && !hasTypedocInTsconfig) return null;

  try {
    const output = execSync(
      "npx typedoc --validation --json /dev/stdout 2>/dev/null",
      {
        cwd: worktreePath,
        timeout: TYPEDOC_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8" as BufferEncoding,
      },
    );

    return parseTypedocOutput(typeof output === "string" ? output : "");
  } catch {
    return null;
  }
}

/**
 * Parse typedoc JSON output and compute coverage as documented / total children.
 */
export function parseTypedocOutput(output: string): number | null {
  try {
    const doc = JSON.parse(output) as {
      children?: Array<{ comment?: { summary?: unknown[] } }>;
    };
    if (!doc.children || doc.children.length === 0) return null;

    const total = doc.children.length;
    const documented = doc.children.filter(
      (c) => c.comment?.summary && (c.comment.summary as unknown[]).length > 0,
    ).length;

    return clamp(documented / total);
  } catch {
    return null;
  }
}

/**
 * Count JSDoc comments before export declarations as a rough proxy.
 * Scans .ts and .tsx files in src/ for `export` preceded by `/** `.
 */
export function tryJsdocHeuristic(worktreePath: string): number | null {
  const srcDir = join(worktreePath, "src");
  if (!existsSync(srcDir)) return null;

  const files = collectTsFiles(srcDir);
  if (files.length === 0) return null;

  let totalExports = 0;
  let documentedExports = 0;

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const result = countDocumentedExports(content);
      totalExports += result.total;
      documentedExports += result.documented;
    } catch {
      // skip unreadable files
    }
  }

  if (totalExports === 0) return null;
  return clamp(documentedExports / totalExports);
}

/**
 * Count export declarations and how many are preceded by JSDoc comments.
 */
export function countDocumentedExports(content: string): {
  total: number;
  documented: number;
} {
  const lines = content.split("\n");
  let total = 0;
  let documented = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      /^export\s+(function|class|const|let|var|type|interface|enum)\b/.test(
        line,
      )
    ) {
      total++;
      // Look backwards for JSDoc closing */ within the previous 20 lines
      let hasJsdoc = false;
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const prev = lines[j]!.trim();
        if (prev === "") continue; // skip blank lines
        if (prev.endsWith("*/")) {
          // Verify it's a JSDoc (starts with /**)
          for (let k = j; k >= Math.max(0, j - 50); k--) {
            if (lines[k]!.trim().startsWith("/**")) {
              hasJsdoc = true;
              break;
            }
          }
        }
        break; // only check the first non-blank line above
      }
      if (hasJsdoc) documented++;
    }
  }

  return { total, documented };
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        results.push(...collectTsFiles(fullPath));
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".test.ts")
      ) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
