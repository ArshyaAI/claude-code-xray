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

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectArchetype } from "../orchestrator/detect-archetype.js";
import { FEATURE_INVENTORY } from "./features.js";
import type { CheckResult, DimensionScore } from "./types.js";
import { readJson, getHome } from "./utils.js";

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

/**
 * Check if an env var is set in process.env OR in any settings.json env block.
 * Claude Code's settings.json `env` field sets env vars for Claude sessions.
 */
function isEnvVarSet(key: string, repoRoot: string): boolean {
  if (process.env[key] !== undefined) return true;
  // Check settings.json env blocks
  for (const settings of getSettingsFiles(repoRoot)) {
    const envBlock = settings.env as Record<string, string> | undefined;
    if (envBlock && key in envBlock) return true;
  }
  return false;
}

function getSettingsFiles(repoRoot: string): Record<string, unknown>[] {
  const home = getHome();
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
  const home = getHome();
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

function checkActiveFeatures(repoRoot: string): CheckResult {
  const activatable = FEATURE_INVENTORY.filter(
    (f) => f.status === "activatable",
  );
  const active = activatable.filter((f) => {
    if (!f.env_var) return false;
    // env_var format: "KEY=VALUE" or just "KEY"
    const key = f.env_var.split("=")[0];
    if (!key) return false;
    return isEnvVarSet(key, repoRoot);
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
    points: 15,
    applicable: true,
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
      points: 15,
      applicable: true,
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
    points: 15,
    applicable: true,
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
      points: 10,
      applicable: false,
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
    points: 10,
    applicable: true,
  };
}

// ─── Check: Coordinator available ────────────────────────────────────────────

function checkCoordinatorAvailable(repoRoot: string): CheckResult {
  const envValue = process.env["CLAUDE_CODE_COORDINATOR_MODE"];
  const settingsHasIt = isEnvVarSet("CLAUDE_CODE_COORDINATOR_MODE", repoRoot);
  const passed =
    settingsHasIt ||
    (envValue !== undefined && envValue !== "0" && envValue !== "false");

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
    points: 10,
    applicable: true,
  };
}

// ─── Check: Project-level settings ──────────────────────────────────────────

function checkProjectSettings(repoRoot: string): CheckResult {
  const projectSettingsPath = join(repoRoot, ".claude", "settings.json");
  const projectLocalPath = join(repoRoot, ".claude", "settings.local.json");
  const hasProjectSettings = existsSync(projectSettingsPath);
  const hasLocalSettings = existsSync(projectLocalPath);

  const found: string[] = [];
  if (hasProjectSettings) found.push(".claude/settings.json");
  if (hasLocalSettings) found.push(".claude/settings.local.json");

  const passed = hasProjectSettings || hasLocalSettings;

  return {
    name: "Project-level settings",
    passed,
    value: found.length > 0 ? found.join(", ") : "none",
    target: ".claude/settings.json present",
    source: `${projectSettingsPath}, ${projectLocalPath}`,
    confidence: "verified",
    fix_available: !passed,
    detail: passed
      ? undefined
      : "No project-level settings.json. This repo inherits all config from user-level only. Add .claude/settings.json to customize permissions, hooks, or deny rules per project.",
    points: 20,
    applicable: true,
  };
}

// ─── Check: Project CLAUDE.md ───────────────────────────────────────────────

function checkProjectClaudeMd(repoRoot: string): CheckResult {
  const rootPath = join(repoRoot, "CLAUDE.md");
  const dotClaudePath = join(repoRoot, ".claude", "CLAUDE.md");
  const hasRoot = existsSync(rootPath);
  const hasDotClaude = existsSync(dotClaudePath);

  const found: string[] = [];
  if (hasRoot) found.push("CLAUDE.md");
  if (hasDotClaude) found.push(".claude/CLAUDE.md");

  const passed = hasRoot || hasDotClaude;

  return {
    name: "Project CLAUDE.md",
    passed,
    value: found.length > 0 ? found.join(", ") : "none",
    target: "CLAUDE.md at project root or .claude/",
    source: `${rootPath}, ${dotClaudePath}`,
    confidence: "verified",
    fix_available: !passed,
    detail: passed
      ? undefined
      : "No project-level CLAUDE.md. Claude Code has no project-specific instructions for this repo.",
    points: 25,
    applicable: true,
  };
}

// ─── Check: MCP servers configured ──────────────────────────────────────────

function checkMcpConfig(repoRoot: string): CheckResult {
  const mcpJsonPath = join(repoRoot, ".mcp.json");
  const hasMcpJson = existsSync(mcpJsonPath);

  let serverCount = 0;
  if (hasMcpJson) {
    const mcp = readJson(mcpJsonPath);
    if (mcp) {
      const servers = mcp["mcpServers"] as Record<string, unknown> | undefined;
      serverCount = servers ? Object.keys(servers).length : 0;
    }
  }

  const passed = hasMcpJson && serverCount > 0;

  return {
    name: "MCP servers configured",
    passed,
    value: hasMcpJson ? `${serverCount} server(s)` : "no .mcp.json",
    target: "≥1 MCP server in .mcp.json",
    source: mcpJsonPath,
    confidence: "verified",
    fix_available: false,
    detail: passed
      ? undefined
      : "No project-level .mcp.json with MCP servers. Tools like database access, browser, or custom APIs are not wired up for this project.",
    points: 5,
    applicable: true,
  };
}

// ─── Score calculation ────────────────────────────────────────────────────────

function calculateCapabilityScore(checks: CheckResult[]): number {
  const applicable = checks.filter((c) => c.applicable);
  if (applicable.length === 0) return 0;

  const maxPoints = applicable.reduce((sum, c) => sum + c.points, 0);
  const earned = applicable
    .filter((c) => c.passed)
    .reduce((sum, c) => sum + c.points, 0);

  const score = Math.round((earned / maxPoints) * 100);

  // Floor at 10 if any applicable check ran
  return Math.max(score, applicable.length > 0 ? 10 : 0);
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanCapability(repoRoot: string): DimensionScore {
  const checks: CheckResult[] = [
    checkActiveFeatures(repoRoot),
    checkSchemaValidity(repoRoot),
    checkArchetypeSkills(repoRoot),
    checkCoordinatorAvailable(repoRoot),
    checkProjectSettings(repoRoot),
    checkProjectClaudeMd(repoRoot),
    checkMcpConfig(repoRoot),
  ];

  const score = calculateCapabilityScore(checks);

  return {
    name: "Capability",
    score,
    weight: 0.25,
    checks,
  };
}
