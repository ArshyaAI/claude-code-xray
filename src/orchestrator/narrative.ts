/**
 * narrative.ts — Human-readable mutation and scoring narratives
 *
 * Turns raw mutation diffs and score comparisons into plain English
 * so the terminal output tells a story, not just numbers.
 */

import type { MutationManifest } from "../genotype/mutate.js";
import type { ParetoDimensions } from "../evaluator/score.js";

// ─── Dimension labels ────────────────────────────────────────────────────────

const DIM_LABELS: Record<keyof ParetoDimensions, string> = {
  C: "Code Quality",
  R: "Test Reliability",
  H: "Human Approval",
  Q: "Convention Adherence",
  T: "Throughput",
  K: "Cost Efficiency",
  S: "Safety",
};

// ─── Mutation narrative ──────────────────────────────────────────────────────

/**
 * Describe a mutation in plain English.
 *
 * Examples:
 * - "Swapped builder model from claude-sonnet-4-6 to gpt-5.3-codex"
 * - "Tweaked explorer batch interval from 60min to 45min"
 * - "Toggled auto-merge from ON to OFF"
 */
export function describeMutation(manifest: MutationManifest): string {
  const { operator, diff } = manifest;

  switch (operator) {
    case "swap_model": {
      const role = diff.gene.replace("model_routing.", "");
      return `Swapped ${role} model from ${String(diff.from)} to ${String(diff.to)}`;
    }
    case "tweak_cadence": {
      const field = diff.gene.replace("cadence.", "").replace(/_/g, " ");
      return `Tweaked ${field} from ${String(diff.from)}min to ${String(diff.to)}min`;
    }
    case "swap_prompt": {
      const key = diff.gene.replace("prompt_policy.", "").replace(/_/g, " ");
      return `Swapped ${key} from ${String(diff.from)} to ${String(diff.to)}`;
    }
    case "adjust_threshold": {
      const field = diff.gene.split(".").pop()?.replace(/_/g, " ") ?? diff.gene;
      return `Adjusted ${field} from ${String(diff.from)} to ${String(diff.to)}`;
    }
    case "toggle_policy": {
      const field = diff.gene.split(".").pop()?.replace(/_/g, " ") ?? diff.gene;
      const fromStr = diff.from ? "ON" : "OFF";
      const toStr = diff.to ? "ON" : "OFF";
      return `Toggled ${field} from ${fromStr} to ${toStr}`;
    }
    case "adjust_budget": {
      const field = diff.gene.split(".").pop()?.replace(/_/g, " ") ?? diff.gene;
      return `Adjusted ${field} from $${String(diff.from)} to $${String(diff.to)}`;
    }
    default:
      return `Applied ${operator} to ${diff.gene}`;
  }
}

// ─── Score comparison narrative ──────────────────────────────────────────────

interface ScoreComparison {
  dimension: keyof ParetoDimensions;
  label: string;
  candidate: number;
  champion: number;
  delta: number;
  improved: boolean;
}

/**
 * Compare two score sets and describe the biggest changes.
 * Returns a narrative like:
 * "Gained +0.12 on Test Reliability, lost -0.08 on Cost Efficiency.
 *  Net utility: +0.04 (champion: 0.62, mutant: 0.66)"
 */
export function describeScoreComparison(
  candidateScores: ParetoDimensions,
  championScores: ParetoDimensions,
  candidateUtility: number,
  championUtility: number,
): string {
  const dims = Object.keys(DIM_LABELS) as (keyof ParetoDimensions)[];
  const comparisons: ScoreComparison[] = dims.map((d) => ({
    dimension: d,
    label: DIM_LABELS[d],
    candidate: candidateScores[d],
    champion: championScores[d],
    delta: candidateScores[d] - championScores[d],
    improved: candidateScores[d] > championScores[d],
  }));

  // Sort by absolute delta, biggest first
  comparisons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const lines: string[] = [];

  // Top 3 changes
  const significant = comparisons.filter((c) => Math.abs(c.delta) > 0.01);
  if (significant.length === 0) {
    lines.push("No significant dimension changes.");
  } else {
    const parts: string[] = [];
    for (const c of significant.slice(0, 3)) {
      const sign = c.delta > 0 ? "+" : "";
      const verb = c.improved ? "gained" : "lost";
      parts.push(`${verb} ${sign}${c.delta.toFixed(2)} on ${c.label}`);
    }
    lines.push(parts.join(", ") + ".");
  }

  // Net utility
  const utilDelta = candidateUtility - championUtility;
  const sign = utilDelta >= 0 ? "+" : "";
  lines.push(
    `Net utility: ${sign}${utilDelta.toFixed(4)} (champion: ${championUtility.toFixed(4)}, mutant: ${candidateUtility.toFixed(4)})`,
  );

  return lines.join(" ");
}

/**
 * Generate a one-line summary for the leaderboard.
 */
export function oneLinerResult(
  promoted: boolean,
  mutationDesc: string,
  pValue: number | null,
): string {
  if (promoted) {
    return `PROMOTED. ${mutationDesc}. Sign test p=${pValue?.toFixed(4) ?? "N/A"}.`;
  }
  return `Champion holds. ${mutationDesc} didn't reach significance${pValue !== null ? ` (p=${pValue.toFixed(4)})` : ""}.`;
}
