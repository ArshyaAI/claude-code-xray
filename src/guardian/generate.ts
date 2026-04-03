/**
 * generate.ts — Deterministic guardian generation from repo path + score
 *
 * Species is mapped from project archetype, stage from score,
 * eye and shiny are derived from FNV-1a hash of repo path so the
 * same repo always produces the same guardian personality.
 */

import type { GuardianBones, Species, Stage, Eye } from "./types.js";
import { EYES } from "./types.js";

// ─── FNV-1a hash ──────────────────────────────────────────────────────────

function fnv1a(str: string): number {
  const bytes = new TextEncoder().encode(str);
  let h = 2166136261;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Archetype → Species mapping ──────────────────────────────────────────

const ARCHETYPE_SPECIES: Record<string, Species> = {
  "ts-lib": "owl",
  "nextjs-app": "owl",
  "react-app": "owl",
  "python-app": "dragon",
  "rust-cli": "crab",
  "go-service": "ghost",
  "shopify-theme": "fox",
  "docker-service": "ghost",
  unknown: "fox",
};

function speciesFromArchetype(archetype: string): Species {
  return ARCHETYPE_SPECIES[archetype] ?? "shield";
}

// ─── Score → Stage mapping ────────────────────────────────────────────────

function stageFromScore(score: number): Stage {
  if (score >= 80) return "sentinel";
  if (score >= 60) return "fortified";
  if (score >= 30) return "guarded";
  return "exposed";
}

// ─── Eye from hash ────────────────────────────────────────────────────────

function eyeFromHash(hash: number): Eye {
  return EYES[hash % EYES.length]!;
}

// ─── Main generator ───────────────────────────────────────────────────────

/**
 * Generate a deterministic guardian from repo path, score, and archetype.
 * Same repo path always produces the same eye and shiny status.
 */
export function generateGuardian(
  repoRoot: string,
  score: number,
  archetype: string,
): GuardianBones {
  const hash = fnv1a(repoRoot);

  return {
    species: speciesFromArchetype(archetype),
    stage: stageFromScore(score),
    eye: eyeFromHash(hash),
    shiny: hash % 20 === 0, // 5% chance
  };
}
