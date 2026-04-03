/**
 * hook-generator.ts — Generates missing hook configurations
 *
 * Produces settings.json hook config diffs for:
 *   - PreToolUse: blocks destructive commands before they run
 *   - PostToolUse: audit logging of every tool invocation
 *
 * The generated configs use Claude Code's hook format:
 *   hooks.<EventName>[].matcher + .hooks[].type + .hooks[].command
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

function getHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const existing = settings.hooks;
  if (
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
  ) {
    return existing as Record<string, unknown>;
  }
  return {};
}

// ─── Destructive command patterns ────────────────────────────────────────────

/**
 * Inline bash script embedded in the hook command.
 * Reads the tool input JSON from stdin, extracts the command field,
 * and exits 1 (blocking the tool) if it matches a destructive pattern.
 *
 * Claude Code hook exit codes:
 *   0  → allow
 *   1  → block (tool is not executed; agent sees a hook rejection)
 *   2  → block + show hook output to user
 */
const BLOCK_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log((j.tool_input||{}).command||'')}catch{console.log('')}})" 2>/dev/null || true)
DESTRUCTIVE_PATTERNS=(
  'rm -rf'
  'rm -r /'
  'git push --force'
  'git push -f'
  'DROP TABLE'
  'DROP DATABASE'
  'DELETE FROM'
  'terraform destroy'
  'kubectl delete'
  'chmod -R 777'
  'mkfs'
  '> /dev/sd'
)
for PAT in "\${DESTRUCTIVE_PATTERNS[@]}"; do
  if echo "$CMD" | grep -qiF "$PAT"; then
    echo "BLOCKED by PreToolUse hook: destructive command detected: $PAT" >&2
    exit 2
  fi
done
exit 0`;

const AUDIT_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
LOG_DIR="\${HOME}/.claude/audit"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).jsonl"
INPUT=$(cat)
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"pid\":$$,\"event\":$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const ti=JSON.stringify(j.tool_input||'').slice(0,200).replace(/([A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|AUTH|CREDENTIAL)[A-Za-z0-9_]*)[=:]\\s*\\S+/gi,'\$1=[REDACTED]');console.log(JSON.stringify({tool:j.tool_name||'',truncated_input:ti}))}catch{console.log('{}')}})" 2>/dev/null || echo '{}')}" >> "$LOG_FILE"
exit 0`;

// ─── Fix generators ──────────────────────────────────────────────────────────

/**
 * Generate a PreToolUse hook that blocks destructive Bash commands.
 * Only generated when the check is failing (no PreToolUse hook present).
 */
export function generatePreToolUseHook(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const hookCheck = safetyDim.checks.find(
    (c) => c.name === "PreToolUse safety hook",
  );
  if (!hookCheck || hookCheck.passed) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);
  const hooks = getHooks(current);

  // Preserve any existing PreToolUse entries
  const existingPreToolUse = Array.isArray(hooks["PreToolUse"])
    ? (hooks["PreToolUse"] as unknown[])
    : [];

  const newEntry = {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        command: BLOCK_SCRIPT,
      },
    ],
  };

  const diff = JSON.stringify(
    {
      ...current,
      hooks: {
        ...hooks,
        PreToolUse: [...existingPreToolUse, newEntry],
      },
    },
    null,
    2,
  );

  return {
    id: "safety/hook-pre-tool-use",
    dimension: "safety",
    description:
      "Add PreToolUse hook to block rm -rf, git push --force, DROP TABLE, terraform destroy, and other destructive commands",
    diff,
    impact_estimate: 18,
    security_relevant: true,
    why_safe:
      "The hook only inspects the command string and exits 2 (blocking with explanation) when a known-destructive pattern matches. All other commands pass through unchanged. The pattern list is conservative — no legitimate development workflow uses these exact forms. Existing PreToolUse hooks are preserved.",
    target_file: targetFile,
  };
}

/**
 * Generate a PostToolUse hook for audit logging.
 * Generated unconditionally when no PostToolUse hook is present —
 * audit logging is always beneficial even if the dimension check passed.
 */
export function generatePostToolUseHook(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const safetyDim = result.dimensions["safety"];
  if (!safetyDim) return undefined;

  const targetFile = resolveSettingsTarget(repoRoot);
  const current = readSettingsJson(targetFile);
  const hooks = getHooks(current);

  // Skip if PostToolUse hook already exists
  const existingPostToolUse = Array.isArray(hooks["PostToolUse"])
    ? (hooks["PostToolUse"] as unknown[])
    : [];
  if (existingPostToolUse.length > 0) return undefined;

  const newEntry = {
    matcher: ".*",
    hooks: [
      {
        type: "command",
        command: AUDIT_SCRIPT,
      },
    ],
  };

  const diff = JSON.stringify(
    {
      ...current,
      hooks: {
        ...hooks,
        PostToolUse: [newEntry],
      },
    },
    null,
    2,
  );

  return {
    id: "safety/hook-post-tool-use",
    dimension: "safety",
    description:
      "Add PostToolUse audit log hook — writes every tool invocation to ~/.claude/audit/YYYY-MM-DD.jsonl",
    diff,
    impact_estimate: 8,
    security_relevant: true,
    why_safe:
      "PostToolUse hooks run after the tool completes and cannot block execution. The audit script only appends a JSONL line and truncates the tool input to 200 characters to avoid logging secrets. The log directory is created automatically under ~/.claude/audit/.",
    target_file: targetFile,
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

/**
 * Generate a fix that removes duplicate hook entries from settings.json.
 * Deduplicates by canonical JSON comparison within each event.
 */
function generateHookDedupFix(
  result: XRayResult,
  repoRoot: string,
): Fix | undefined {
  const dupCheck = Object.values(result.dimensions)
    .flatMap((d) => d.checks)
    .find((c) => c.name === "Duplicate hooks" && !c.passed);

  if (!dupCheck) return undefined;

  // Check all settings scopes (not just the first one found)
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return undefined;

  const candidates = [
    join(home, ".claude", "settings.json"),
    join(repoRoot, ".claude", "settings.json"),
    join(repoRoot, ".claude", "settings.local.json"),
  ];

  // Find the scope that actually has duplicates
  for (const settingsPath of candidates) {
    const settings = readSettingsJson(settingsPath);
    const hooksMap = settings.hooks as Record<string, unknown> | undefined;
    if (!hooksMap || typeof hooksMap !== "object") continue;

    const deduped: Record<string, unknown> = {};
    let removed = 0;

    for (const [event, matchers] of Object.entries(hooksMap)) {
      if (!Array.isArray(matchers)) {
        deduped[event] = matchers;
        continue;
      }
      const seen = new Set<string>();
      const unique: unknown[] = [];
      for (const entry of matchers) {
        const key = stableStringify(entry);
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(entry);
        } else {
          removed++;
        }
      }
      deduped[event] = unique;
    }

    if (removed === 0) continue;

    const fixed = { ...settings, hooks: deduped };

    return {
      id: "automation/deduplicate-hooks",
      dimension: "automation",
      description: `Remove ${removed} duplicate hook entries (every hook was running twice)`,
      diff: JSON.stringify(fixed, null, 2),
      impact_estimate: 12,
      security_relevant: false,
      why_safe:
        "Removes exact duplicates only (key-order independent comparison). " +
        "Every unique hook entry is preserved. " +
        "No hook behavior changes, just eliminates redundant executions that double latency.",
      target_file: settingsPath,
    };
  }

  return undefined;
}

/** Key-order-independent JSON for structural comparison. */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    sorted
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          stableStringify((obj as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

export function generateHookFixes(result: XRayResult, repoRoot: string): Fix[] {
  const fixes: (Fix | undefined)[] = [
    generateHookDedupFix(result, repoRoot),
    generatePreToolUseHook(result, repoRoot),
    generatePostToolUseHook(result, repoRoot),
  ];
  return fixes.filter((f): f is Fix => f !== undefined);
}
