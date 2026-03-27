/**
 * archetypes.ts — Archetype-specific scoring defaults
 *
 * Different repo archetypes have different throughput ceilings and
 * performance expectations. This module provides a lookup table
 * mapping archetypes to their normalization defaults.
 */

import type { Archetype } from "./config.js";

export interface ArchetypeDefaults {
  /** Items/hour ceiling for T (throughput) dimension normalization. */
  throughput_max: number;
  /** Typical build time in seconds. */
  expected_build_time_sec: number;
  /** Typical test suite time in seconds. */
  expected_test_time_sec: number;
  /** Relative cost vs ts-lib baseline. */
  cost_multiplier: number;
}

const ARCHETYPE_DEFAULTS: Record<Archetype, ArchetypeDefaults> = {
  "ts-lib": {
    throughput_max: 10,
    expected_build_time_sec: 30,
    expected_test_time_sec: 60,
    cost_multiplier: 1.0,
  },
  "nextjs-app": {
    throughput_max: 6,
    expected_build_time_sec: 120,
    expected_test_time_sec: 180,
    cost_multiplier: 1.5,
  },
  "react-app": {
    throughput_max: 8,
    expected_build_time_sec: 60,
    expected_test_time_sec: 120,
    cost_multiplier: 1.2,
  },
  "rust-cli": {
    throughput_max: 12,
    expected_build_time_sec: 180,
    expected_test_time_sec: 90,
    cost_multiplier: 0.8,
  },
  "go-service": {
    throughput_max: 15,
    expected_build_time_sec: 20,
    expected_test_time_sec: 30,
    cost_multiplier: 0.7,
  },
  "python-app": {
    throughput_max: 8,
    expected_build_time_sec: 10,
    expected_test_time_sec: 120,
    cost_multiplier: 1.0,
  },
};

/**
 * Get the scoring defaults for a given archetype.
 * Returns ts-lib defaults for unknown archetypes.
 */
export function getArchetypeDefaults(archetype: Archetype): ArchetypeDefaults {
  return ARCHETYPE_DEFAULTS[archetype];
}
