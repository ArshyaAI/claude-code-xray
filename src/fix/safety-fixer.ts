/**
 * safety-fixer.ts — Fix generators for Safety & Security dimension
 *
 * Each generator inspects an XRayResult and returns a Fix object that
 * describes the exact JSON change needed to resolve a failing check.
 *
 * Coverage:
 *   - Missing deny rules for .env, secrets, credentials, .pem, id_rsa
 *   - Missing sandbox config
 *   - bypassPermissions mode → "default"
 *   - enableAllProjectMcpServers → false
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

function getPermissions(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const existing = settings.permissions;
  if (
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
  ) {
    return existing as Record<string, unknown>;
  }
  return {};
}

// ─── Fix generators ──────────────────────────────────────────────────────────

/**
 * Generate deny rules covering the five sensitive file patterns that
 * safety.ts checks: .env, secrets, credentials, .pem, id_rsa.
 */
export function fixDenyRules(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const denyCheck = safetyDim.checks.find(
    (c) => c.name === "Deny rules for sensitive files",
  );
  if (!denyCheck || denyCheck.passed) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);
  const permissions = getPermissions(current);

  const existingDeny = Array.isArray(permissions["deny"])
    ? (permissions["deny"] as string[])
    : [];

  const requiredPatterns = [
    "**/.env",
    "**/.env.*",
    "**/secrets/**",
    "**/credentials/**",
    "**/*.pem",
    "**/id_rsa",
    "**/id_rsa.*",
  ];

  // Merge without duplicates
  const merged = [
    ...existingDeny,
    ...requiredPatterns.filter(
      (p) =>
        !existingDeny.some((r) =>
          r
            .toLowerCase()
            .includes(
              p.replace("**/", "").replace("/**", "").replace(".*", ""),
            ),
        ),
    ),
  ];

  const diff = JSON.stringify(
    {
      ...current,
      permissions: {
        ...permissions,
        deny: merged,
      },
    },
    null,
    2,
  );

  return {
    id: "safety/deny-rules",
    dimension: "safety",
    description:
      "Add deny rules for .env, secrets, credentials, .pem, and id_rsa files",
    diff,
    impact_estimate: 15,
    security_relevant: true,
    why_safe:
      "Deny rules are additive — they only restrict which files the agent can read or edit. No existing behaviour is removed. Existing allow rules are preserved.",
    target_file: targetFile,
  };
}

/**
 * Generate a sandbox config block with safe defaults:
 *   - allowWrite to the project directory only
 *   - denyWrite for .env and secrets paths
 *   - allowedDomains restricted to api.anthropic.com
 */
export function fixSandboxConfig(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const sandboxCheck = safetyDim.checks.find(
    (c) => c.name === "Sandbox enabled",
  );
  if (!sandboxCheck || sandboxCheck.passed) return undefined;

  // Sandbox config should go in PROJECT settings, not user settings.
  // Reason: allowWrite paths are project-specific. Writing to user-level
  // settings would break other projects.
  const projectSettings = join(repoRoot, ".claude", "settings.json");
  const targetFile = projectSettings;
  const current = readSettingsJson(targetFile);
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error("HOME or USERPROFILE environment variable is required");
  }

  const diff = JSON.stringify(
    {
      ...current,
      sandbox: {
        enabled: true,
        filesystem: {
          allowWrite: [repoRoot, join(home, ".xray"), "/tmp"],
          denyWrite: [
            "**/.env",
            "**/.env.*",
            "**/secrets/**",
            "**/*.pem",
            "**/id_rsa",
          ],
        },
        network: {
          allowedDomains: ["api.anthropic.com", "img.shields.io"],
        },
      },
    },
    null,
    2,
  );

  return {
    id: "safety/sandbox-config",
    dimension: "safety",
    description:
      "Enable sandbox with OS-level filesystem and network isolation (project-scoped)",
    diff,
    impact_estimate: 20,
    security_relevant: true,
    why_safe:
      "Sandbox config targets PROJECT settings (.claude/settings.json), not user-level. allowWrite includes the project dir + /tmp. denyWrite blocks .env and secrets. This only affects this project.",
    target_file: targetFile,
  };
}

/**
 * Fix bypassPermissions mode — switch to "default" mode.
 */
export function fixBypassPermissions(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const modeCheck = safetyDim.checks.find((c) => c.name === "Permission mode");
  if (!modeCheck || modeCheck.passed) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);
  const permissions = getPermissions(current);

  const diff = JSON.stringify(
    {
      ...current,
      permissions: {
        ...permissions,
        defaultMode: "default",
      },
    },
    null,
    2,
  );

  return {
    id: "safety/permission-mode",
    dimension: "safety",
    description:
      'Switch permissions.defaultMode from "bypassPermissions" to "default"',
    diff,
    impact_estimate: 25,
    security_relevant: true,
    why_safe:
      '"default" mode still allows the agent to work normally — it simply requires approval for destructive or sensitive actions. bypassPermissions is intended only for fully-trusted automated pipelines and should never be used in interactive or background-agent contexts.',
    target_file: targetFile,
  };
}

/**
 * Fix enableAllProjectMcpServers — set to false.
 */
export function fixMcpTrust(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const mcpCheck = safetyDim.checks.find(
    (c) => c.name === "MCP server trust model",
  );
  if (!mcpCheck || mcpCheck.passed) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);

  const diff = JSON.stringify(
    {
      ...current,
      enableAllProjectMcpServers: false,
    },
    null,
    2,
  );

  return {
    id: "safety/mcp-trust",
    dimension: "safety",
    description: "Disable auto-trust for all project MCP servers",
    diff,
    impact_estimate: 20,
    security_relevant: true,
    why_safe:
      "Setting enableAllProjectMcpServers to false does not disable any MCP server — it only requires each server to be explicitly approved before it receives full access. Servers you have already approved continue to work without any changes.",
    target_file: targetFile,
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

export function generateSafetyFixes(
  result: XRayResult,
  repoRoot: string,
): Fix[] {
  const fixes: (Fix | undefined)[] = [
    fixBypassPermissions(result, repoRoot),
    fixMcpTrust(result, repoRoot),
    fixSandboxConfig(result, repoRoot),
    fixDenyRules(result, repoRoot),
  ];
  return fixes.filter((f): f is Fix => f !== undefined);
}
