/**
 * scoring.ts — Weighted composite scoring engine
 *
 * Computes overall X-Ray score from 4 dimensions. Dimensions with no
 * data (score 0 and no checks) are excluded, remaining weights renormalized.
 */

import type { DimensionScore, ScoringWeights, XRayResult } from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

/**
 * Compute the overall weighted score from dimension results.
 * Excludes dimensions with no data (empty checks array) and
 * renormalizes weights across remaining dimensions.
 */
export function computeScore(
  dimensions: Record<string, DimensionScore>,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): { overall: number; scored: number } {
  // Use dimension keys directly instead of display names
  const active = Object.entries(dimensions).filter(
    ([, d]) => d.checks.length > 0,
  );

  if (active.length === 0) {
    return { overall: 0, scored: 0 };
  }

  const totalWeight = active.reduce(
    (sum, [key]) => sum + (weights[key as keyof ScoringWeights] ?? 0),
    0,
  );

  if (totalWeight === 0) {
    return { overall: 0, scored: active.length };
  }

  const weighted = active.reduce((sum, [key, d]) => {
    const w = weights[key as keyof ScoringWeights] ?? 0;
    return sum + d.score * (w / totalWeight);
  }, 0);

  return {
    overall: Math.round(weighted),
    scored: active.length,
  };
}
