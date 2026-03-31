/**
 * coverage.ts — Collect diff-hunk test coverage via c8/nyc
 *
 * Opt-in: projects with c8 or nyc/istanbul config get real coverage.
 * Projects without coverage tooling get the default 0.5.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_COVERAGE = 0.5;
const COVERAGE_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Collect test coverage for changed files only (diff-hunk coverage).
 * Returns a value in [0, 1]. Falls back to 0.5 if no coverage tool is configured or it fails.
 */
export function collectDiffHunkCoverage(worktreePath: string): number {
  if (!hasCoverageTool(worktreePath)) {
    return DEFAULT_COVERAGE;
  }

  try {
    // Run tests with c8 JSON reporter
    execSync("npx c8 --reporter=json npm test 2>/dev/null", {
      cwd: worktreePath,
      timeout: COVERAGE_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8" as BufferEncoding,
    });

    // Get changed files from git diff
    const changedFiles = getChangedFiles(worktreePath);
    if (changedFiles.length === 0) {
      return DEFAULT_COVERAGE;
    }

    // Parse coverage report and filter to changed files
    return parseCoverageForFiles(worktreePath, changedFiles);
  } catch {
    return DEFAULT_COVERAGE;
  }
}

/**
 * Check whether c8 or nyc/istanbul config exists in the worktree.
 */
function hasCoverageTool(worktreePath: string): boolean {
  // c8 config locations
  if (existsSync(join(worktreePath, ".c8rc.json"))) return true;
  if (existsSync(join(worktreePath, ".c8rc"))) return true;

  // nyc/istanbul config locations
  if (existsSync(join(worktreePath, ".nycrc"))) return true;
  if (existsSync(join(worktreePath, ".nycrc.json"))) return true;
  if (existsSync(join(worktreePath, ".nycrc.yml"))) return true;

  // Check package.json for c8 or nyc config/dependency
  try {
    const pkgPath = join(worktreePath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        c8?: unknown;
        nyc?: unknown;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      if (pkg.c8 || pkg.nyc) return true;
      if (pkg.devDependencies?.["c8"] || pkg.dependencies?.["c8"]) return true;
      if (pkg.devDependencies?.["nyc"] || pkg.dependencies?.["nyc"])
        return true;
    }
  } catch {
    // Malformed package.json — skip
  }

  return false;
}

/**
 * Get the list of changed source files via git diff.
 */
function getChangedFiles(worktreePath: string): string[] {
  try {
    const output = execSync("git diff --name-only HEAD 2>/dev/null", {
      cwd: worktreePath,
      encoding: "utf-8" as BufferEncoding,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const raw = typeof output === "string" ? output : "";
    return raw
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && /\.[tj]sx?$/.test(f));
  } catch {
    return [];
  }
}

/**
 * Parse c8 JSON coverage output and compute average line coverage
 * across the specified changed files.
 */
export function parseCoverageForFiles(
  worktreePath: string,
  changedFiles: string[],
): number {
  const coveragePath = join(worktreePath, "coverage", "coverage-final.json");
  if (!existsSync(coveragePath)) {
    return DEFAULT_COVERAGE;
  }

  try {
    const raw = readFileSync(coveragePath, "utf-8");
    const report = JSON.parse(raw) as Record<
      string,
      { s?: Record<string, number> }
    >;

    let totalStatements = 0;
    let coveredStatements = 0;
    let matchedFiles = 0;

    for (const [filePath, fileData] of Object.entries(report)) {
      // Match if any changed file is a suffix of the coverage file path
      const isChanged = changedFiles.some(
        (cf) => filePath.endsWith(cf) || filePath.endsWith(`/${cf}`),
      );
      if (!isChanged) continue;

      matchedFiles++;
      if (fileData.s) {
        for (const count of Object.values(fileData.s)) {
          totalStatements++;
          if (count > 0) coveredStatements++;
        }
      }
    }

    if (matchedFiles === 0 || totalStatements === 0) {
      return DEFAULT_COVERAGE;
    }

    return Math.max(0, Math.min(1, coveredStatements / totalStatements));
  } catch {
    return DEFAULT_COVERAGE;
  }
}
