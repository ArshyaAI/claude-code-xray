/**
 * capability-fixer.ts — Fix generators for Capability dimension
 *
 * Generates fixes for:
 *   - Coordinator Mode: set CLAUDE_CODE_COORDINATOR_MODE=1 via env config
 *   - Unknown settings keys: remove unrecognised top-level keys
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Fix, XRayResult } from "../scan/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveSettingsTarget(repoRoot: string): string {
  const projectSettings = join(repoRoot, ".claude", "settings.json");
  if (existsSync(projectSettings)) return projectSettings;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error("HOME or USERPROFILE environment variable is required");
  }
  return join(home, ".claude", "settings.json");
}

function readSettingsJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─── Fix: Coordinator Mode ──────────────────────────────────────────────────

/**
 * Generate a fix to enable Coordinator Mode via the env block in settings.json.
 * Only fires when the "Coordinator available" check is failing.
 */
function fixCoordinatorMode(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const capDim = result.dimensions["capability"];
  if (!capDim) return undefined;

  const check = capDim.checks.find((c) => c.name === "Coordinator available");
  if (!check || check.passed) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);
  const existingEnv =
    typeof current.env === "object" &&
    current.env !== null &&
    !Array.isArray(current.env)
      ? (current.env as Record<string, unknown>)
      : {};

  const diff = JSON.stringify(
    {
      ...current,
      env: {
        ...existingEnv,
        CLAUDE_CODE_COORDINATOR_MODE: "1",
      },
    },
    null,
    2,
  );

  return {
    id: "capability/coordinator-mode",
    dimension: "capability",
    description:
      "Enable Coordinator Mode (CLAUDE_CODE_COORDINATOR_MODE=1) via settings.json env block",
    diff,
    impact_estimate: 12,
    security_relevant: false,
    why_safe:
      "Sets an environment variable in the settings env block. Coordinator Mode allows multi-agent orchestration but does not change any permissions or security boundaries. Workers inherit the same safety settings.",
    target_file: targetFile,
  };
}

// ─── Fix: Remove unknown settings keys ──────────────────────────────────────

/**
 * Generate a fix to remove unknown top-level keys from settings.json.
 * Uses the schema validation errors from the XRayResult.
 */
function fixUnknownKeys(result: XRayResult, repoRoot: string): Fix | undefined {
  const unknownErrors = result.settings_validation.errors.filter((e) =>
    e.message.includes("Unknown settings key"),
  );

  if (unknownErrors.length === 0) return undefined;

  // Group by scope to find the right target file
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error("HOME or USERPROFILE environment variable is required");
  }

  const scopeToPath: Record<string, string> = {
    user: join(home, ".claude", "settings.json"),
    "project-shared": join(repoRoot, ".claude", "settings.json"),
    "project-local": join(repoRoot, ".claude", "settings.local.json"),
  };

  // Find the first scope with unknown keys
  const firstError = unknownErrors[0]!;
  const targetFile =
    scopeToPath[firstError.scope] ?? resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);

  // Extract the unknown key names for this scope
  const keysToRemove = unknownErrors
    .filter((e) => e.scope === firstError.scope)
    .map((e) => {
      const match = e.message.match(/Unknown settings key "([^"]+)"/);
      return match ? match[1] : undefined;
    })
    .filter((k): k is string => k !== undefined);

  if (keysToRemove.length === 0) return undefined;

  // Build cleaned object
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!keysToRemove.includes(key)) {
      cleaned[key] = value;
    }
  }

  const diff = JSON.stringify(cleaned, null, 2);

  return {
    id: "capability/remove-unknown-keys",
    dimension: "capability",
    description: `Remove unknown settings keys: ${keysToRemove.join(", ")}`,
    diff,
    impact_estimate: 5,
    security_relevant: false,
    why_safe:
      "Only removes top-level keys that are not recognised by Claude Code. These are likely typos or stale config from older versions. All known keys are preserved unchanged.",
    target_file: targetFile,
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export function generateCapabilityFixes(
  result: XRayResult,
  repoRoot: string,
): Fix[] {
  const fixes: (Fix | undefined)[] = [
    fixCoordinatorMode(result, repoRoot),
    fixUnknownKeys(result, repoRoot),
  ];
  return fixes.filter((f): f is Fix => f !== undefined);
}
