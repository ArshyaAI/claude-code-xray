/**
 * diff.ts — Compare current scan against the most recent history entry
 *
 * Shows regressions, improvements, and unchanged checks at a glance.
 */

import type {
  XRayResult,
  HistoryEntry,
  CheckResult,
  DiffResult,
  DimensionDelta,
  CheckDelta,
} from "./types.js";

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

// ─── Core diff logic ───────────────────────────────────────────────────────

/**
 * Compute a structured diff between the current scan and a previous entry.
 * If previousChecks is provided, also diffs individual check pass/fail status.
 */
export function computeDiff(
  current: XRayResult,
  previous: HistoryEntry,
  previousChecks?: CheckResult[],
): DiffResult {
  const delta = current.overall_score - previous.overall_score;

  // Dimension-level deltas
  const dimKeys = ["safety", "capability", "automation", "efficiency"];
  const dimensionDeltas: DimensionDelta[] = [];
  for (const key of dimKeys) {
    const cur = current.dimensions[key];
    const prev = previous.dimensions?.[key];
    if (cur && prev) {
      dimensionDeltas.push({
        name: cur.name,
        previous: prev.score,
        current: cur.score,
        delta: cur.score - prev.score,
      });
    } else if (cur && !prev) {
      dimensionDeltas.push({
        name: cur.name,
        previous: 0,
        current: cur.score,
        delta: cur.score,
      });
    }
  }

  // Check-level deltas (only if we have previous checks)
  const regressed: CheckDelta[] = [];
  const improved: CheckDelta[] = [];
  let unchangedCount = 0;

  if (previousChecks && previousChecks.length > 0) {
    const currentChecks = flattenChecks(current);
    const prevMap = new Map<string, boolean>();
    for (const c of previousChecks) {
      prevMap.set(c.name, c.passed);
    }

    for (const c of currentChecks) {
      const wasPassing = prevMap.get(c.name);
      if (wasPassing === undefined) {
        // New check, not a regression or improvement
        continue;
      }
      if (wasPassing && !c.passed) {
        regressed.push({ name: c.name, detail: c.detail });
      } else if (!wasPassing && c.passed) {
        improved.push({ name: c.name, detail: c.detail });
      } else {
        unchangedCount++;
      }
      prevMap.delete(c.name);
    }
    // Remaining in prevMap are checks that no longer exist — treat as removed, not regression
  } else {
    // No check-level data, just count all current checks as unchanged
    unchangedCount = flattenChecks(current).length;
  }

  return {
    previous_score: previous.overall_score,
    current_score: current.overall_score,
    delta,
    regressed,
    improved,
    unchanged_count: unchangedCount,
    dimension_deltas: dimensionDeltas,
  };
}

/**
 * Render a human-readable diff report for the terminal.
 */
export function renderDiff(diff: DiffResult): string {
  const lines: string[] = [];
  const arrow = diff.delta >= 0 ? "\u2192" : "\u2192";
  const deltaStr =
    diff.delta > 0
      ? `(+${diff.delta})`
      : diff.delta < 0
        ? `(${diff.delta})`
        : "(no change)";
  const deltaColor = diff.delta > 0 ? GREEN : diff.delta < 0 ? RED : DIM;

  lines.push("");
  lines.push(
    `${BOLD}${CYAN}X-Ray Diff${RESET} ${BOLD}${diff.previous_score} ${arrow} ${diff.current_score}${RESET} ${deltaColor}${deltaStr}${RESET}`,
  );
  lines.push("");

  // Dimension breakdown
  if (diff.dimension_deltas.length > 0) {
    for (const d of diff.dimension_deltas) {
      const dDelta =
        d.delta > 0
          ? `${GREEN}+${d.delta}${RESET}`
          : d.delta < 0
            ? `${RED}${d.delta}${RESET}`
            : `${DIM}0${RESET}`;
      lines.push(
        `  ${d.name.padEnd(22)} ${d.previous} \u2192 ${d.current}  (${dDelta})`,
      );
    }
    lines.push("");
  }

  // Regressed checks
  if (diff.regressed.length > 0) {
    lines.push(`  ${BOLD}${RED}REGRESSED:${RESET}`);
    for (const r of diff.regressed) {
      lines.push(
        `    ${RED}[-]${RESET} ${r.name}${r.detail ? ` ${DIM}(${r.detail})${RESET}` : ""}`,
      );
    }
    lines.push("");
  }

  // Improved checks
  if (diff.improved.length > 0) {
    lines.push(`  ${BOLD}${GREEN}IMPROVED:${RESET}`);
    for (const imp of diff.improved) {
      lines.push(
        `    ${GREEN}[+]${RESET} ${imp.name}${imp.detail ? ` ${DIM}(${imp.detail})${RESET}` : ""}`,
      );
    }
    lines.push("");
  }

  // Unchanged
  if (diff.unchanged_count > 0) {
    lines.push(`  ${DIM}UNCHANGED: ${diff.unchanged_count} checks${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function flattenChecks(result: XRayResult): CheckResult[] {
  return Object.values(result.dimensions).flatMap((d) => d.checks);
}
