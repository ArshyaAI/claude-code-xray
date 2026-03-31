/**
 * fix/index.ts — Fix orchestrator for Claude Code X-Ray
 *
 * Takes an XRayResult, runs all fix generators, and returns a sorted Fix[].
 * Also provides applyFix() with dry-run and live modes.
 *
 * Live mode:
 *   1. Backs up target_file to <target_file>.xray-backup.<timestamp>
 *   2. Applies the diff (replaces entire file content with the diff JSON)
 *   3. Verifies the result parses as valid JSON
 *   4. Reports success or rolls back on failure
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { Fix, XRayResult } from "../scan/types.js";
import { generateSafetyFixes } from "./safety-fixer.js";
import { generateHookFixes } from "./hook-generator.js";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all fix generators against the XRayResult.
 * Returns fixes sorted by impact_estimate descending (highest first).
 */
export function generateFixes(
  result: XRayResult,
  repoRoot: string = ".",
): Fix[] {
  const root = resolve(repoRoot);

  const all: Fix[] = [
    ...generateSafetyFixes(result, root),
    ...generateHookFixes(result, root),
  ];

  // Sort highest impact first
  return all.sort((a, b) => b.impact_estimate - a.impact_estimate);
}

/**
 * Apply or preview a single fix.
 *
 * dryRun = true  → prints the diff to stdout, no files changed
 * dryRun = false → backs up the target file, writes the diff, verifies JSON
 */
export function applyFix(fix: Fix, dryRun: boolean): void {
  if (dryRun) {
    console.log(`\n[DRY RUN] Fix: ${fix.id}`);
    console.log(`  Description : ${fix.description}`);
    console.log(`  Target file : ${fix.target_file}`);
    console.log(`  Why safe    : ${fix.why_safe}`);
    console.log(`  Impact      : +${fix.impact_estimate} pts`);
    console.log(`  Diff preview:\n`);
    console.log(indentBlock(fix.diff, "    "));
    return;
  }

  // ── Live mode ──────────────────────────────────────────────────────────────

  const targetPath = fix.target_file;

  // 1. Validate the diff is valid JSON before touching anything
  let parsed: unknown;
  try {
    parsed = JSON.parse(fix.diff);
  } catch (err) {
    throw new Error(
      `Fix ${fix.id}: diff is not valid JSON — refusing to apply. Error: ${String(err)}`,
    );
  }

  // 2. Backup the existing file (if it exists)
  let backupPath: string | undefined;
  if (existsSync(targetPath)) {
    backupPath = `${targetPath}.xray-backup.${Date.now()}`;
    copyFileSync(targetPath, backupPath);
    console.log(`  Backed up: ${targetPath} → ${backupPath}`);
  }

  // 3. Write the new content
  const newContent = JSON.stringify(parsed, null, 2) + "\n";
  try {
    writeFileSync(targetPath, newContent, "utf-8");
  } catch (err) {
    throw new Error(
      `Fix ${fix.id}: failed to write ${targetPath}. Error: ${String(err)}`,
    );
  }

  // 4. Verify the written file parses correctly
  try {
    const written = readFileSync(targetPath, "utf-8");
    JSON.parse(written);
  } catch (err) {
    // Roll back if we have a backup
    if (backupPath !== undefined && existsSync(backupPath)) {
      copyFileSync(backupPath, targetPath);
      throw new Error(
        `Fix ${fix.id}: written file failed JSON validation — rolled back from ${backupPath}. Error: ${String(err)}`,
      );
    }
    throw new Error(
      `Fix ${fix.id}: written file failed JSON validation and no backup found. Error: ${String(err)}`,
    );
  }

  console.log(`  Applied fix : ${fix.id} → ${targetPath}`);
  console.log(`  ${fix.description}`);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/**
 * Find existing backup files for a given path, sorted oldest → newest.
 * Used for rollback when the primary backup reference is missing.
 */
export function findBackups(targetPath: string): string[] {
  const dir = dirname(targetPath);
  const base = basename(targetPath);

  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.xray-backup.`))
      .sort()
      .map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
}
