/**
 * detect-archetype.ts — Auto-detect repo archetype from project files
 *
 * Inspects the repo root for well-known config files (package.json,
 * Cargo.toml, go.mod, etc.) and returns the most specific archetype match.
 * Falls back to 'unknown' when nothing matches.
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
 *   1. Shopify theme markers (theme.liquid, .theme, shopify/) → 'shopify-theme'
 *   2. package.json with 'next' dependency → 'nextjs-app'
 *   3. package.json with 'react' (no 'next') → 'react-app'
 *   4. package.json without react/next → 'ts-lib'
 *   5. Cargo.toml → 'rust-cli'
 *   6. go.mod → 'go-service'
 *   7. requirements.txt or pyproject.toml → 'python-app'
 *   8. Dockerfile or docker-compose.yml → 'docker-service'
 *   9. No recognized project files → 'unknown'
 */
export function detectArchetype(repoRoot: string): DetectionResult {
  // ── Shopify theme detection (before package.json — themes may have one) ──
  const shopifyMarkers = [
    join(repoRoot, "layout", "theme.liquid"),
    join(repoRoot, "config", "settings_schema.json"),
    join(repoRoot, "templates", "index.json"),
    join(repoRoot, "sections"),
    join(repoRoot, "snippets"),
  ];
  const shopifyHits = shopifyMarkers.filter((p) => existsSync(p));
  if (shopifyHits.length >= 2) {
    return {
      archetype: "shopify-theme",
      reason: `Shopify theme structure detected (${shopifyHits.length} markers)`,
    };
  }

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

  // ── Docker/container projects ───────────────────────────────────────
  if (
    existsSync(join(repoRoot, "Dockerfile")) ||
    existsSync(join(repoRoot, "docker-compose.yml")) ||
    existsSync(join(repoRoot, "docker-compose.yaml"))
  ) {
    return {
      archetype: "docker-service",
      reason: "Dockerfile or docker-compose found",
    };
  }

  // ── Fallback: unknown ──────────────────────────────────────────────
  return {
    archetype: "unknown",
    reason: "no recognized project files — unclassified directory",
  };
}
