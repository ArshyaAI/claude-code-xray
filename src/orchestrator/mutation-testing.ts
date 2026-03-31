/**
 * mutation-testing.ts — Collect mutation testing scores via Stryker
 *
 * Opt-in: projects with stryker.conf.js or stryker.config.js get real scores.
 * Projects without Stryker configuration get the default 0.5.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MUTATION_SCORE = 0.5;
const STRYKER_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Collect mutation score from a worktree using Stryker.
 * Returns a value in [0, 1]. Falls back to 0.5 if Stryker is not configured or fails.
 */
export function collectMutationScore(worktreePath: string): number {
  const hasConfig =
    existsSync(join(worktreePath, "stryker.conf.js")) ||
    existsSync(join(worktreePath, "stryker.config.js"));

  if (!hasConfig) {
    return DEFAULT_MUTATION_SCORE;
  }

  try {
    const output = execSync("npx stryker run --reporters json 2>/dev/null", {
      cwd: worktreePath,
      timeout: STRYKER_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    return parseStrykerOutput(typeof output === "string" ? output : "");
  } catch {
    return DEFAULT_MUTATION_SCORE;
  }
}

/**
 * Parse Stryker JSON output for the mutation score percentage.
 * Expected shape: { "mutationScore": 85.7, ... } or nested under files.
 */
export function parseStrykerOutput(output: string): number {
  try {
    const report = JSON.parse(output) as {
      mutationScore?: number;
      files?: Record<string, { mutationScore?: number }>;
    };

    // Top-level score
    if (typeof report.mutationScore === "number") {
      return clampScore(report.mutationScore / 100);
    }

    // Aggregate from per-file scores
    if (report.files) {
      const scores = Object.values(report.files)
        .map((f) => f.mutationScore)
        .filter((s): s is number => typeof s === "number");
      if (scores.length > 0) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        return clampScore(avg / 100);
      }
    }

    return DEFAULT_MUTATION_SCORE;
  } catch {
    return DEFAULT_MUTATION_SCORE;
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}
