/**
 * capability.ts — Capability dimension scanner
 *
 * Weight: 0.25. Checks how many activatable features are enabled, validates
 * settings schema keys, verifies archetype-recommended skills are installed,
 * and checks for Coordinator Mode availability.
 *
 * Each check returns a CheckResult and the dimension score is the ratio of
 * passed checks mapped onto 0-100.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectArchetype } from "../orchestrator/detect-archetype.js";
import { FEATURE_INVENTORY } from "./features.js";
import type { CheckResult, DimensionScore } from "./types.js";

// ─── Known top-level keys for settings.json (all scopes) ────────────────────
// Derived from Claude Code source intelligence (March 2026).

const KNOWN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  // Core behaviour
  "permissions",
  "env",
  "hooks",
  "sandbox",
  "model",
  "includeCoAuthoredBy",
  "enableAllProjectMcpServers",
  "autoUpdaterStatus",
  // MCP
  "mcpServers",
  // Feature flags
  "features",
  "featureFlags",
  // Misc observed keys
  "preferredNotifChannel",
  "theme",
  "verbosityLevel",
  "cleanupPeriodDays",
  "gitConfigAllowList",
]);

// ─── Archetype → recommended skill names ─────────────────────────────────────
// Skills are identified by the directory name under ~/.claude/skills/.
// These are skills that provide meaningful leverage for each archetype.

const ARCHETYPE_SKILLS: Record<string, string[]> = {
  "nextjs-app": [
    "next-best-practices",
    "vercel-react-best-practices",
    "shadcn-ui",
  ],
  "react-app": ["vercel-react-best-practices", "shadcn-ui"],
  "ts-lib": ["api-design-principles"],
  "rust-cli": [],
  "go-service": [],
  "python-app": [],
  "shopify-theme": ["shopify-liquid-themes", "liquid-theme-a11y"],
  "docker-service": [],
  unknown: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function getSettingsFiles(repoRoot: string): Record<string, unknown>[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  const paths = [
    join(home, ".claude", "settings.json"),
    join(repoRoot, ".claude", "settings.json"),
    join(repoRoot, ".claude", "settings.local.json"),
  ];
  return paths
    .map(readJson)
    .filter((s): s is Record<string, unknown> => s !== null);
}

function listInstalledSkills(): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  const skillsDir = join(home, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ─── Check: Active features ──────────────────────────────────────────────────

function checkActiveFeatures(): CheckResult {
  const activatable = FEATURE_INVENTORY.filter(
    (f) => f.status === "activatable",
  );
  const active = activatable.filter((f) => {
    if (!f.env_var) return false;
    // env_var format: "KEY=VALUE" or just "KEY"
    const key = f.env_var.split("=")[0];
    if (!key) return false;
    return process.env[key] !== undefined;
  });

  const passed = active.length >= 1;
  return {
    name: "Active features",
    passed,
    value: `${active.length}/${activatable.length} activatable`,
    target: `≥1 activatable feature enabled`,
    source: "process.env",
    confidence: "verified",
    fix_available: !passed,
    detail: passed
      ? `Active: ${active.map((f) => f.codename).join(", ")}`
      : `None of the ${activatable.length} activatable features have their env var set. ` +
        `Try: ${activatable[0]?.env_var ?? "CLAUDE_CODE_COORDINATOR_MODE=1"}`,
  };
}

// ─── Check: Schema validity ──────────────────────────────────────────────────

function checkSchemaValidity(repoRoot: string): CheckResult {
  const settingsFiles = getSettingsFiles(repoRoot);

  if (settingsFiles.length === 0) {
    return {
      name: "Schema validity",
      passed: false,
      value: "no settings files found",
      target: "settings.json present with known keys",
      source: "~/.claude/settings.json, .claude/settings.json",
      confidence: "verified",
      fix_available: true,
      detail:
        "No settings.json found at any scope. Create one to configure Claude Code.",
    };
  }

  const unknownKeys: string[] = [];
  for (const settings of settingsFiles) {
    for (const key of Object.keys(settings)) {
      if (!KNOWN_SETTINGS_KEYS.has(key)) {
        unknownKeys.push(key);
      }
    }
  }

  // De-duplicate
  const uniqueUnknown = [...new Set(unknownKeys)];
  const passed = uniqueUnknown.length === 0;

  return {
    name: "Schema validity",
    passed,
    value: passed
      ? `all keys known (${KNOWN_SETTINGS_KEYS.size} recognised)`
      : `${uniqueUnknown.length} unknown key(s): ${uniqueUnknown.join(", ")}`,
    target: "no unknown top-level keys",
    source: "settings.json top-level keys",
    confidence: "inferred",
    fix_available: !passed,
    detail: passed
      ? undefined
      : `Unknown keys may be typos or stale config: ${uniqueUnknown.join(", ")}`,
  };
}

// ─── Check: Archetype skills ─────────────────────────────────────────────────

function checkArchetypeSkills(repoRoot: string): CheckResult {
  const { archetype } = detectArchetype(resolve(repoRoot));
  const recommended = ARCHETYPE_SKILLS[archetype] ?? [];
  const installedSkills = listInstalledSkills();
  const installedSet = new Set(installedSkills);

  if (recommended.length === 0) {
    return {
      name: "Archetype skills",
      passed: true,
      value: `no skills recommended for ${archetype}`,
      target: "all recommended skills installed",
      source: "~/.claude/skills/",
      confidence: "inferred",
      fix_available: false,
      detail: `Archetype '${archetype}' has no specific skill recommendations.`,
    };
  }

  const missing = recommended.filter((s) => !installedSet.has(s));
  const installed = recommended.filter((s) => installedSet.has(s));
  const passed = missing.length === 0;

  return {
    name: "Archetype skills",
    passed,
    value: `${installed.length}/${recommended.length} skills installed for ${archetype}`,
    target: `all ${recommended.length} recommended skills installed`,
    source: "~/.claude/skills/",
    confidence: "inferred",
    fix_available: !passed,
    detail: passed
      ? undefined
      : `Missing skills for '${archetype}': ${missing.join(", ")}. Install via gstack or manually.`,
  };
}

// ─── Check: Coordinator available ────────────────────────────────────────────

function checkCoordinatorAvailable(): CheckResult {
  const envValue = process.env["CLAUDE_CODE_COORDINATOR_MODE"];
  const passed =
    envValue !== undefined && envValue !== "0" && envValue !== "false";

  return {
    name: "Coordinator available",
    passed,
    value: envValue ?? "unset",
    target: "CLAUDE_CODE_COORDINATOR_MODE=1",
    source: "process.env.CLAUDE_CODE_COORDINATOR_MODE",
    confidence: "verified",
    fix_available: !passed,
    detail: passed
      ? undefined
      : "Coordinator Mode is off. Multi-agent orchestration (one Claude spawning parallel workers) is not available. Set CLAUDE_CODE_COORDINATOR_MODE=1 in your shell profile.",
  };
}

// ─── Score calculation ────────────────────────────────────────────────────────

function calculateCapabilityScore(checks: CheckResult[]): number {
  if (checks.length === 0) return 0;
  const passed = checks.filter((c) => c.passed).length;
  const raw = Math.round((passed / checks.length) * 100);
  return Math.max(raw, checks.length > 0 ? 10 : 0);
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanCapability(repoRoot: string): DimensionScore {
  const checks: CheckResult[] = [
    checkActiveFeatures(),
    checkSchemaValidity(repoRoot),
    checkArchetypeSkills(repoRoot),
    checkCoordinatorAvailable(),
  ];

  const score = calculateCapabilityScore(checks);

  return {
    name: "Capability",
    score,
    weight: 0.25,
    checks,
  };
}
