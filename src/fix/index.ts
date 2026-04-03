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
  mkdirSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { Fix, XRayResult } from "../scan/types.js";

/**
 * Deep merge two objects. Arrays use SOURCE value (not concatenated),
 * because fix generators already produce the complete merged array.
 * Concatenating would duplicate every entry.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const tv = target[key];
    const sv = source[key];
    if (
      tv &&
      sv &&
      typeof tv === "object" &&
      typeof sv === "object" &&
      !Array.isArray(tv) &&
      !Array.isArray(sv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      // Arrays and primitives: source wins (fix already has the correct value)
      result[key] = sv;
    }
  }
  return result;
}
import { generateSafetyFixes } from "./safety-fixer.js";
import { generateHookFixes } from "./hook-generator.js";
import { generateCapabilityFixes } from "./capability-fixer.js";
import { generateContextFixes } from "./context-generator.js";

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
    ...generateCapabilityFixes(result, root),
    ...generateContextFixes(result, root),
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
export function applyFix(
  fix: Fix,
  dryRun: boolean,
  silent: boolean = false,
): void {
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
  const isJsonTarget = targetPath.endsWith(".json");

  // Ensure parent directory exists
  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  if (isJsonTarget) {
    // ── JSON target: parse, merge, verify ──
    let parsed: unknown;
    try {
      parsed = JSON.parse(fix.diff);
    } catch (err) {
      throw new Error(
        `Fix ${fix.id}: diff is not valid JSON — refusing to apply. Error: ${String(err)}`,
      );
    }

    let backupPath: string | undefined;
    if (existsSync(targetPath)) {
      backupPath = `${targetPath}.xray-backup.${Date.now()}`;
      copyFileSync(targetPath, backupPath);
      if (!silent) console.log(`  Backed up: ${targetPath} → ${backupPath}`);
    }

    let merged: unknown;
    if (existsSync(targetPath)) {
      try {
        const current = JSON.parse(readFileSync(targetPath, "utf-8"));
        merged = deepMerge(current, parsed as Record<string, unknown>);
      } catch {
        merged = parsed;
      }
    } else {
      merged = parsed;
    }

    const newContent = JSON.stringify(merged, null, 2) + "\n";
    try {
      writeFileSync(targetPath, newContent, "utf-8");
    } catch (err) {
      throw new Error(
        `Fix ${fix.id}: failed to write ${targetPath}. Error: ${String(err)}`,
      );
    }

    try {
      const written = readFileSync(targetPath, "utf-8");
      JSON.parse(written);
    } catch (err) {
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
  } else {
    // ── Non-JSON target (e.g. .md): write content directly ──
    let backupPath: string | undefined;
    if (existsSync(targetPath)) {
      backupPath = `${targetPath}.xray-backup.${Date.now()}`;
      copyFileSync(targetPath, backupPath);
      if (!silent) console.log(`  Backed up: ${targetPath} → ${backupPath}`);
    }

    try {
      writeFileSync(targetPath, fix.diff, "utf-8");
    } catch (err) {
      throw new Error(
        `Fix ${fix.id}: failed to write ${targetPath}. Error: ${String(err)}`,
      );
    }
  }

  if (!silent) {
    console.log(`  Applied fix : ${fix.id} → ${targetPath}`);
    console.log(`  ${fix.description}`);
  }
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
