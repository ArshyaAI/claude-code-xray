/**
 * types.ts — Core data model for Claude Code X-Ray
 *
 * All interfaces used across scan, fix, and viral modules.
 */

// ─── Scan Results ───────────────────────────────────────────────────────────

export interface XRayResult {
  timestamp: string; // ISO 8601
  version: string; // X-Ray version
  repo: string; // repo path or slug
  archetype: string; // detected archetype
  overall_score: number; // 0-100 (weighted composite)
  dimensions_scored: number; // how many of 4 dimensions had data
  dimensions: Record<string, DimensionScore>;
  fixes_available: Fix[];
  security_alerts: SecurityAlert[];
  settings_validation: SchemaValidation;
}

export interface DimensionScore {
  name: string;
  score: number; // 0-100
  weight: number; // 0.0-1.0 (before renormalization)
  checks: CheckResult[];
}

export type Confidence = "verified" | "inferred";

export interface CheckResult {
  name: string;
  passed: boolean;
  value: string | number | boolean;
  target: string | number | boolean;
  source: string; // e.g., "settings.json permissions.deny"
  confidence: Confidence;
  fix_available: boolean;
  detail?: string | undefined; // human-readable explanation
}

// ─── Security ───────────────────────────────────────────────────────────────

export interface SecurityAlert {
  severity: "critical" | "high" | "medium";
  check: string;
  description: string;
  fix: string;
  context?: string | undefined; // e.g., "KAIROS will make this worse"
}

// ─── Schema Validation ──────────────────────────────────────────────────────

export interface SchemaValidation {
  valid: boolean;
  errors: SchemaError[];
}

export interface SchemaError {
  path: string; // JSON path to the invalid key
  message: string;
  scope: string; // which settings file
}

// ─── Fixes ──────────────────────────────────────────────────────────────────

export interface Fix {
  id: string; // unique identifier
  dimension: string;
  description: string;
  diff: string; // preview of change
  impact_estimate: number; // estimated score improvement
  security_relevant: boolean;
  why_safe: string; // explanation of why this fix is safe
  target_file: string; // file that would be modified
}

// ─── History ────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  timestamp: string;
  action: "scan" | "fix";
  repo: string;
  overall_score: number;
  dimensions_scored: number;
  fixes_applied?: string[];
  score_delta?: number;
}

// ─── Feature Inventory ──────────────────────────────────────────────────────

export type FeatureStatus =
  | "activatable" // can enable via env var today
  | "approximatable" // we can build an approximation
  | "compile_time" // locked behind compile-time flag
  | "shipped"; // officially shipped by Anthropic

export interface Feature {
  id: string;
  codename: string;
  name: string;
  description: string;
  status: FeatureStatus;
  env_var?: string; // if activatable, the env var to set
  prerequisites: string[]; // what must be true before this is safe
  confidence: Confidence;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  safety: number;
  capability: number;
  automation: number;
  efficiency: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  safety: 0.3,
  capability: 0.25,
  automation: 0.25,
  efficiency: 0.2,
};
