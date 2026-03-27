/**
 * complexity.ts — Collect cyclomatic complexity metrics from a worktree
 *
 * Opt-in: tries madge (circular deps) and ts-complexity if available.
 * Returns raw complexity number (higher = more complex). Falls back to 1.0.
 */

import { execSync } from "node:child_process";

const DEFAULT_COMPLEXITY = 1.0;
const TOOL_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Collect cyclomatic complexity from a worktree.
 * Combines circular dependency count (via madge) and average cyclomatic
 * complexity (via ts-complexity) into a single raw number.
 * Returns 1.0 if no tooling is available.
 */
export function collectComplexity(worktreePath: string): number {
  const circularCount = collectCircularDeps(worktreePath);
  const avgCyclomatic = collectTsComplexity(worktreePath);

  // Both failed → default
  if (circularCount === null && avgCyclomatic === null) {
    return DEFAULT_COMPLEXITY;
  }

  // Combine: base cyclomatic avg + penalty per circular dep
  const base = avgCyclomatic ?? DEFAULT_COMPLEXITY;
  const circularPenalty = (circularCount ?? 0) * 2;
  return Math.max(DEFAULT_COMPLEXITY, base + circularPenalty);
}

/**
 * Detect circular dependencies via madge.
 * Returns the count of circular dependency chains, or null if madge is unavailable.
 */
export function collectCircularDeps(worktreePath: string): number | null {
  try {
    const output = execSync("npx madge --circular --json . 2>/dev/null", {
      cwd: worktreePath,
      timeout: TOOL_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    return parseCircularOutput(typeof output === "string" ? output : "");
  } catch {
    return null;
  }
}

/**
 * Parse madge --circular --json output.
 * Expected shape: array of arrays (each inner array is a circular chain).
 */
export function parseCircularOutput(output: string): number | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Collect average cyclomatic complexity via ts-complexity.
 * Returns the average complexity across files, or null if unavailable.
 */
export function collectTsComplexity(worktreePath: string): number | null {
  try {
    const output = execSync("npx ts-complexity --json src/ 2>/dev/null", {
      cwd: worktreePath,
      timeout: TOOL_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    return parseTsComplexityOutput(typeof output === "string" ? output : "");
  } catch {
    return null;
  }
}

/**
 * Parse ts-complexity JSON output for average cyclomatic complexity.
 * Handles both array-of-objects and top-level summary shapes.
 */
export function parseTsComplexityOutput(output: string): number | null {
  try {
    const parsed = JSON.parse(output) as unknown;

    // Shape: { average: number } or { averageComplexity: number }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.average === "number") return obj.average;
      if (typeof obj.averageComplexity === "number")
        return obj.averageComplexity;
    }

    // Shape: [{ complexity: number, file: string }, ...]
    if (Array.isArray(parsed)) {
      const values = parsed
        .map((entry: Record<string, unknown>) => entry.complexity)
        .filter((c): c is number => typeof c === "number");
      if (values.length > 0) {
        return values.reduce((a, b) => a + b, 0) / values.length;
      }
    }

    return null;
  } catch {
    return null;
  }
}
