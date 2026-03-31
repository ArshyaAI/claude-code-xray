/**
 * conventions.ts — Collect convention violation counts from eslint or biome
 *
 * Opt-in: projects with eslint or biome config get real counts.
 * Projects without a linter configured return 0.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const LINT_TIMEOUT_MS = 60_000; // 1 minute

const ESLINT_CONFIGS = [
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
];

/**
 * Collect convention violation count from a worktree using eslint or biome.
 * Returns total error + warning count. Falls back to 0 if no linter is configured.
 */
export function collectConventionViolations(worktreePath: string): number {
  if (hasEslintConfig(worktreePath)) {
    return runEslint(worktreePath);
  }

  if (existsSync(join(worktreePath, "biome.json"))) {
    return runBiome(worktreePath);
  }

  return 0;
}

function hasEslintConfig(worktreePath: string): boolean {
  return ESLINT_CONFIGS.some((cfg) => existsSync(join(worktreePath, cfg)));
}

function runEslint(worktreePath: string): number {
  try {
    const output = execSync("npx eslint . --format json 2>/dev/null", {
      cwd: worktreePath,
      timeout: LINT_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    return parseEslintOutput(typeof output === "string" ? output : "");
  } catch (err: unknown) {
    // eslint exits non-zero when it finds violations — stdout still has JSON
    const stderr =
      err && typeof err === "object" && "stdout" in err
        ? (err as { stdout: string }).stdout
        : "";
    if (typeof stderr === "string" && stderr.length > 0) {
      return parseEslintOutput(stderr);
    }
    return 0;
  }
}

export function parseEslintOutput(output: string): number {
  try {
    const results = JSON.parse(output) as Array<{
      errorCount?: number;
      warningCount?: number;
    }>;
    if (!Array.isArray(results)) return 0;

    return results.reduce((total, file) => {
      return total + (file.errorCount ?? 0) + (file.warningCount ?? 0);
    }, 0);
  } catch {
    return 0;
  }
}

function runBiome(worktreePath: string): number {
  try {
    const output = execSync("npx biome check . --reporter json 2>/dev/null", {
      cwd: worktreePath,
      timeout: LINT_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    return parseBiomeOutput(typeof output === "string" ? output : "");
  } catch (err: unknown) {
    // biome exits non-zero when it finds diagnostics — stdout still has JSON
    const stderr =
      err && typeof err === "object" && "stdout" in err
        ? (err as { stdout: string }).stdout
        : "";
    if (typeof stderr === "string" && stderr.length > 0) {
      return parseBiomeOutput(stderr);
    }
    return 0;
  }
}

export function parseBiomeOutput(output: string): number {
  try {
    const report = JSON.parse(output) as {
      diagnostics?: unknown[];
    };

    if (Array.isArray(report.diagnostics)) {
      return report.diagnostics.length;
    }

    return 0;
  } catch {
    return 0;
  }
}
