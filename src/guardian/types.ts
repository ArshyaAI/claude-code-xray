/**
 * types.ts — Guardian mascot data model
 *
 * Every X-Ray scan generates a Guardian creature that evolves with your score.
 * Species is determined by project archetype, stage by score, appearance
 * is deterministic from repo path.
 */

export const STAGES = ["exposed", "guarded", "fortified", "sentinel"] as const;
export type Stage = (typeof STAGES)[number]; // score < 30, < 60, < 80, 80+

export const SPECIES = [
  "shield",
  "owl",
  "dragon",
  "ghost",
  "crab",
  "fox",
] as const;
export type Species = (typeof SPECIES)[number];

export const EYES = ["\u00B7", "\u25C9", "\u00D7", "\u2605", "\u25C6"] as const;
export type Eye = (typeof EYES)[number];

export type GuardianBones = {
  species: Species;
  stage: Stage;
  eye: Eye;
  shiny: boolean; // 5% chance
};
