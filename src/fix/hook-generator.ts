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
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
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
CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)
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
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"pid\":$$,\"event\":$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({'tool':d.get('tool_name',''),'truncated_input':str(d.get('tool_input',''))[:200]}))" 2>/dev/null || echo '{}')}" >> "$LOG_FILE"
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

export function generateHookFixes(result: XRayResult, repoRoot: string): Fix[] {
  const fixes: (Fix | undefined)[] = [
    generatePreToolUseHook(result, repoRoot),
    generatePostToolUseHook(result, repoRoot),
  ];
  return fixes.filter((f): f is Fix => f !== undefined);
}
