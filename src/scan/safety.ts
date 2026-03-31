/**
 * safety.ts — Safety & Security dimension scanner
 *
 * Weight: 0.30 (highest). Checks permission mode, deny rules, sandbox,
 * MCP trust, and hook safety gates against actual Claude Code internals.
 *
 * Evidence: CVE-2025-59536 (RCE via hooks), rm -rf $HOME incidents,
 * terraform destroy on prod. This dimension catches real dangers.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckResult, DimensionScore, SecurityAlert } from "./types.js";

// ─── Settings file paths ────────────────────────────────────────────────────

interface SettingsLocations {
  user: string; // ~/.claude/settings.json
  projectShared: string; // .claude/settings.json
  projectLocal: string; // .claude/settings.local.json
  claudeJson: string; // ~/.claude.json (MCP servers, global config)
}

function getSettingsLocations(repoRoot: string): SettingsLocations {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return {
    user: join(home, ".claude", "settings.json"),
    projectShared: join(repoRoot, ".claude", "settings.json"),
    projectLocal: join(repoRoot, ".claude", "settings.local.json"),
    claudeJson: join(home, ".claude.json"),
  };
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Individual checks ──────────────────────────────────────────────────────

function checkPermissionMode(settings: Record<string, unknown>[]): CheckResult {
  const permissions = settings
    .map((s) => s.permissions as Record<string, unknown> | undefined)
    .filter(Boolean);

  const defaultMode = permissions
    .map((p) => p!.defaultMode as string | undefined)
    .find((m) => m !== undefined);

  const isBypass = defaultMode === "bypassPermissions";
  return {
    name: "Permission mode",
    passed: !isBypass,
    value: defaultMode ?? "default",
    target: "default or plan",
    source: "settings.json permissions.defaultMode",
    confidence: "verified",
    fix_available: isBypass,
    detail: isBypass
      ? "bypassPermissions lets the agent run ANY command without approval. A background agent with this setting can modify any file at 3am."
      : undefined,
  };
}

function checkDenyRules(settings: Record<string, unknown>[]): CheckResult {
  const permissions = settings
    .map((s) => s.permissions as Record<string, unknown> | undefined)
    .filter(Boolean);

  const denyRules = permissions.flatMap(
    (p) => (p!.deny as string[] | undefined) ?? [],
  );

  const sensitivePatterns = [
    ".env",
    "secrets",
    "credentials",
    ".pem",
    "id_rsa",
  ];
  const covered = sensitivePatterns.filter((pat) =>
    denyRules.some((rule) => rule.toLowerCase().includes(pat)),
  );

  const hasDenyRules = covered.length >= 4;
  return {
    name: "Deny rules for sensitive files",
    passed: hasDenyRules,
    value: `${covered.length}/${sensitivePatterns.length} patterns covered`,
    target: "All sensitive file patterns denied",
    source: "settings.json permissions.deny",
    confidence: "verified",
    fix_available: !hasDenyRules,
    detail: !hasDenyRules
      ? `Missing deny rules for: ${sensitivePatterns.filter((p) => !covered.includes(p)).join(", ")}`
      : undefined,
  };
}

function checkSandbox(settings: Record<string, unknown>[]): CheckResult {
  const sandboxEnabled = settings.some((s) => {
    const sandbox = s.sandbox as Record<string, unknown> | undefined;
    return sandbox?.enabled === true;
  });

  return {
    name: "Sandbox enabled",
    passed: sandboxEnabled,
    value: sandboxEnabled,
    target: true,
    source: "settings.json sandbox.enabled",
    confidence: "verified",
    fix_available: !sandboxEnabled,
    detail: !sandboxEnabled
      ? "No OS-level filesystem/network isolation. Read/Edit deny rules do NOT apply to Bash subprocesses."
      : undefined,
  };
}

function checkMcpTrust(settings: Record<string, unknown>[]): CheckResult {
  const enableAll = settings.some((s) => s.enableAllProjectMcpServers === true);

  return {
    name: "MCP server trust model",
    passed: !enableAll,
    value: enableAll ? "auto-trust all" : "per-server trust",
    target: "per-server trust",
    source: "settings.json enableAllProjectMcpServers",
    confidence: "verified",
    fix_available: enableAll,
    detail: enableAll
      ? "Every MCP server in every repo you clone is automatically trusted. A malicious .mcp.json in any cloned repo gets full access."
      : undefined,
  };
}

function checkPreToolUseHook(settings: Record<string, unknown>[]): CheckResult {
  const hooks = settings
    .map((s) => s.hooks as Record<string, unknown> | undefined)
    .filter(Boolean);

  const hasPreToolUse = hooks.some((h) => {
    const preToolUse = h!.PreToolUse;
    return Array.isArray(preToolUse) && preToolUse.length > 0;
  });

  return {
    name: "PreToolUse safety hook",
    passed: hasPreToolUse,
    value: hasPreToolUse,
    target: true,
    source: "settings.json hooks.PreToolUse",
    confidence: "verified",
    fix_available: !hasPreToolUse,
    detail: !hasPreToolUse
      ? "No safety gate on tool execution. Destructive commands (rm -rf, git push --force, DROP TABLE) execute without intervention."
      : undefined,
  };
}

function checkBashDenyGap(settings: Record<string, unknown>[]): CheckResult {
  const permissions = settings
    .map((s) => s.permissions as Record<string, unknown> | undefined)
    .filter(Boolean);

  const hasDenyRules = permissions.some(
    (p) => Array.isArray(p!.deny) && (p!.deny as string[]).length > 0,
  );

  const sandboxEnabled = settings.some((s) => {
    const sandbox = s.sandbox as Record<string, unknown> | undefined;
    return sandbox?.enabled === true;
  });

  const hasGap = hasDenyRules && !sandboxEnabled;
  return {
    name: "Bash subprocess deny gap",
    passed: !hasGap,
    value: hasGap ? "deny rules exist but sandbox off" : "covered",
    target: "sandbox enabled or no deny rules needed",
    source: "permissions/deny vs sandbox.enabled",
    confidence: "inferred",
    fix_available: hasGap,
    detail: hasGap
      ? "You have Read/Edit deny rules but sandbox is off. A Bash subprocess can still read denied files (cat .env). Enable sandbox for OS-level enforcement."
      : undefined,
  };
}

// ─── Score calculation ──────────────────────────────────────────────────────

function calculateSafetyScore(checks: CheckResult[]): number {
  // Each check has equal weight within the dimension
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  if (total === 0) return 0;

  // Floor at 10 if any check ran (never 0 for partial data)
  const raw = Math.round((passed / total) * 100);
  return Math.max(raw, checks.length > 0 ? 10 : 0);
}

// ─── Security alerts ────────────────────────────────────────────────────────

function generateAlerts(checks: CheckResult[]): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];

  for (const check of checks) {
    if (check.passed) continue;

    const severity =
      check.name === "Permission mode" ||
      check.name === "MCP server trust model"
        ? "critical"
        : check.name === "Sandbox enabled" ||
            check.name === "Deny rules for sensitive files"
          ? "high"
          : "medium";

    alerts.push({
      severity,
      check: check.name,
      description: check.detail ?? `${check.name} failed`,
      fix: `Run: npx claude-code-xray fix`,
      context:
        check.name === "Permission mode"
          ? "KAIROS (always-on background agent) will make this catastrophically worse"
          : check.name === "MCP server trust model"
            ? "Coordinator Mode spawns workers that inherit this trust setting"
            : undefined,
    });
  }

  return alerts;
}

// ─── Main scanner ───────────────────────────────────────────────────────────

export function scanSafety(repoRoot: string): {
  dimension: DimensionScore;
  alerts: SecurityAlert[];
} {
  const locs = getSettingsLocations(resolve(repoRoot));

  const settingsFiles = [
    readJson(locs.user),
    readJson(locs.projectShared),
    readJson(locs.projectLocal),
  ].filter(Boolean) as Record<string, unknown>[];

  if (settingsFiles.length === 0) {
    return {
      dimension: {
        name: "Safety & Security",
        score: 0,
        weight: 0.3,
        checks: [],
      },
      alerts: [
        {
          severity: "high",
          check: "no_settings",
          description:
            "No settings.json found at any scope. Cannot audit safety.",
          fix: "Create ~/.claude/settings.json or .claude/settings.json",
        },
      ],
    };
  }

  const checks: CheckResult[] = [
    checkPermissionMode(settingsFiles),
    checkDenyRules(settingsFiles),
    checkSandbox(settingsFiles),
    checkMcpTrust(settingsFiles),
    checkPreToolUseHook(settingsFiles),
    checkBashDenyGap(settingsFiles),
  ];

  const score = calculateSafetyScore(checks);
  const alerts = generateAlerts(checks);

  return {
    dimension: {
      name: "Safety & Security",
      score,
      weight: 0.3,
      checks,
    },
    alerts,
  };
}
