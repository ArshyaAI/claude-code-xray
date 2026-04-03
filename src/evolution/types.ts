/**
 * evolution/types.ts — Types for the experiment engine
 *
 * Controlled before/after experiments that prove fixes actually work.
 */

export interface ExperimentResult {
  fix_id: string;
  fix_description: string;
  before_score: number;
  after_score: number;
  delta: number;
  dimension_deltas: Record<string, number>;
  checks_flipped: { name: string; from: boolean; to: boolean }[];
  timestamp: string;
}

export interface ExperimentRun {
  id: string;
  repo: string;
  started_at: string;
  finished_at: string;
  baseline_score: number;
  results: ExperimentResult[];
  combined_potential: number;
}
