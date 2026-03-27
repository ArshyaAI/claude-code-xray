/**
 * detect-archetype.ts — Auto-detect repo archetype from project files
 *
 * Inspects the repo root for well-known config files (package.json,
 * Cargo.toml, go.mod, etc.) and returns the most specific archetype match.
 * Falls back to 'ts-lib' when nothing matches.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Archetype } from "./config.js";

export interface DetectionResult {
  archetype: Archetype;
  /** How the archetype was determined. */
  reason: string;
}

/**
 * Detect the repo archetype by reading project config files in `repoRoot`.
 *
 * Priority order:
 *   1. package.json with 'next' dependency → 'nextjs-app'
 *   2. package.json with 'react' (no 'next') → 'react-app'
 *   3. package.json without react/next → 'ts-lib'
 *   4. Cargo.toml → 'rust-cli'
 *   5. go.mod → 'go-service'
 *   6. requirements.txt or pyproject.toml → 'python-app'
 *   7. Fallback → 'ts-lib'
 */
export function detectArchetype(repoRoot: string): DetectionResult {
  // ── package.json detection ──────────────────────────────────────────
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps["next"]) {
        return {
          archetype: "nextjs-app",
          reason: "package.json contains 'next' dependency",
        };
      }
      if (allDeps["react"]) {
        return {
          archetype: "react-app",
          reason: "package.json contains 'react' dependency (no 'next')",
        };
      }
      return {
        archetype: "ts-lib",
        reason: "package.json found without react/next",
      };
    } catch {
      return {
        archetype: "ts-lib",
        reason: "package.json found but failed to parse",
      };
    }
  }

  // ── Cargo.toml ──────────────────────────────────────────────────────
  if (existsSync(join(repoRoot, "Cargo.toml"))) {
    return { archetype: "rust-cli", reason: "Cargo.toml found" };
  }

  // ── go.mod ──────────────────────────────────────────────────────────
  if (existsSync(join(repoRoot, "go.mod"))) {
    return { archetype: "go-service", reason: "go.mod found" };
  }

  // ── Python ──────────────────────────────────────────────────────────
  if (existsSync(join(repoRoot, "requirements.txt"))) {
    return { archetype: "python-app", reason: "requirements.txt found" };
  }
  if (existsSync(join(repoRoot, "pyproject.toml"))) {
    return { archetype: "python-app", reason: "pyproject.toml found" };
  }

  // ── Fallback ────────────────────────────────────────────────────────
  return {
    archetype: "ts-lib",
    reason: "no recognized project files — using default",
  };
}
