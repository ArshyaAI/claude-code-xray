/**
 * evolution/experiment.ts — Controlled before/after experiment engine
 *
 * Proves fixes actually work by:
 * 1. Running a baseline scan
 * 2. For each fix: snapshot -> apply -> re-scan -> rollback -> record
 * 3. Rendering results with delta table
 */

import { resolve } from "node:path";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runXRay } from "../scan/index.js";
import { generateFixes, applyFix } from "../fix/index.js";
import { takeSnapshot, restoreSnapshot, cleanupSnapshot } from "./snapshot.js";
import type { ExperimentResult, ExperimentRun } from "./types.js";
import type { Fix, XRayResult } from "../scan/types.js";

const XRAY_DIR = join(process.env.HOME ?? "/tmp", ".xray");
const EXPERIMENTS_DIR = join(XRAY_DIR, "experiments");
const HISTORY_FILE = join(EXPERIMENTS_DIR, "history.jsonl");

// ─── Core API ───────────────────────────────────────────────────────────────

/**
 * Run a controlled experiment for each fix (or a specific one).
 * Each fix is applied in isolation with full snapshot/rollback.
 */
export function runExperiment(
  repoRoot: string,
  fixId?: string,
): ExperimentResult[] {
  const root = resolve(repoRoot);

  // 1. Baseline scan
  const baseline = runXRay(root);
  const fixes = generateFixes(baseline, root);

  // Filter to specific fix if requested
  const targetFixes = fixId ? fixes.filter((f) => f.id === fixId) : fixes;

  if (targetFixes.length === 0) {
    if (fixId) {
      console.error(`[experiment] No fix found with id: ${fixId}`);
      console.error(
        `  Available: ${fixes.map((f) => f.id).join(", ") || "(none)"}`,
      );
    }
    return [];
  }

  const results: ExperimentResult[] = [];

  for (const fix of targetFixes) {
    const result = runSingleExperiment(root, baseline, fix);
    results.push(result);
  }

  // Persist results
  persistResults(results);

  return results;
}

/**
 * Run a single fix experiment with full isolation.
 */
function runSingleExperiment(
  repoRoot: string,
  baseline: XRayResult,
  fix: Fix,
): ExperimentResult {
  const snapshotId = `exp-${fix.id}-${Date.now()}`;

  // a. Snapshot current state
  const snapshot = takeSnapshot(repoRoot, snapshotId);

  try {
    // b. Apply the fix (live mode)
    applyFix(fix, false);

    // c. Re-scan (measure)
    const after = runXRay(repoRoot);

    // d. Compute deltas
    const dimensionDeltas: Record<string, number> = {};
    for (const [key, dim] of Object.entries(after.dimensions)) {
      const beforeDim = baseline.dimensions[key];
      if (beforeDim) {
        dimensionDeltas[key] = dim.score - beforeDim.score;
      }
    }

    // Find checks that flipped
    const checksFlipped = findFlippedChecks(baseline, after);

    return {
      fix_id: fix.id,
      fix_description: fix.description,
      before_score: baseline.overall_score,
      after_score: after.overall_score,
      delta: after.overall_score - baseline.overall_score,
      dimension_deltas: dimensionDeltas,
      checks_flipped: checksFlipped,
      timestamp: new Date().toISOString(),
    };
  } finally {
    // d. Always rollback, even on error
    restoreSnapshot(snapshot);
    cleanupSnapshot(snapshotId);
  }
}

/**
 * Find checks that changed state between two scans.
 */
function findFlippedChecks(
  before: XRayResult,
  after: XRayResult,
): { name: string; from: boolean; to: boolean }[] {
  const flipped: { name: string; from: boolean; to: boolean }[] = [];

  const beforeChecks = new Map<string, boolean>();
  for (const dim of Object.values(before.dimensions)) {
    for (const check of dim.checks) {
      beforeChecks.set(check.name, check.passed);
    }
  }

  for (const dim of Object.values(after.dimensions)) {
    for (const check of dim.checks) {
      const wasPassing = beforeChecks.get(check.name);
      if (wasPassing !== undefined && wasPassing !== check.passed) {
        flipped.push({
          name: check.name,
          from: wasPassing,
          to: check.passed,
        });
      }
    }
  }

  return flipped;
}

// ─── History ────────────────────────────────────────────────────────────────

/**
 * Persist experiment results to history.jsonl
 */
function persistResults(results: ExperimentResult[]): void {
  try {
    if (!existsSync(EXPERIMENTS_DIR)) {
      mkdirSync(EXPERIMENTS_DIR, { recursive: true });
    }
    for (const result of results) {
      appendFileSync(HISTORY_FILE, JSON.stringify(result) + "\n");
    }
  } catch {
    // Best-effort persistence
  }
}

/**
 * Read all experiment history.
 */
export function readExperimentHistory(): ExperimentResult[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const lines = readFileSync(HISTORY_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    return lines.map((l) => JSON.parse(l) as ExperimentResult);
  } catch {
    return [];
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Render experiment results as an ASCII table.
 */
export function renderExperimentResults(results: ExperimentResult[]): string {
  if (results.length === 0) {
    return "No experiment results. Run 'xray experiment' to test fixes.";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("X-Ray Experiment Results");
  lines.push("\u2550".repeat(48));

  // Header
  const header = padRow("Fix", "Before", "After", "Delta");
  lines.push(header);
  lines.push(
    padRow(
      "\u2500".repeat(28),
      "\u2500".repeat(6),
      "\u2500".repeat(5),
      "\u2500".repeat(5),
    ),
  );

  // Sort by delta descending
  const sorted = [...results].sort((a, b) => b.delta - a.delta);

  for (const r of sorted) {
    const deltaStr = r.delta >= 0 ? `+${r.delta}` : String(r.delta);
    const desc = truncate(r.fix_description, 28);
    lines.push(
      padRow(desc, String(r.before_score), String(r.after_score), deltaStr),
    );
  }

  // Combined potential
  lines.push("\u2500".repeat(48));
  const baseline = sorted[0]?.before_score ?? 0;
  const totalDelta = sorted.reduce((sum, r) => sum + r.delta, 0);
  const combined = baseline + totalDelta;
  const combinedDeltaStr =
    totalDelta >= 0 ? `+${totalDelta}` : String(totalDelta);
  lines.push(
    padRow(
      "Combined potential:",
      String(baseline),
      String(combined),
      combinedDeltaStr,
    ),
  );

  lines.push("");
  return lines.join("\n");
}

function padRow(
  col1: string,
  col2: string,
  col3: string,
  col4: string,
): string {
  return (
    col1.padEnd(30) +
    col2.padStart(6) +
    "  " +
    col3.padStart(5) +
    "  " +
    col4.padStart(5)
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

// Re-export types for convenience
export type { ExperimentResult, ExperimentRun } from "./types.js";
