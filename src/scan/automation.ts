/**
 * automation.ts — Automation & Workflow dimension scanner
 *
 * Weight: 0.25. Checks hook coverage across all settings scopes, dead hook
 * script paths, CLAUDE.md hierarchy completeness, and memory health.
 *
 * Strong hook coverage + complete CLAUDE.md hierarchy = the harness actually
 * runs automated behaviours vs relying on the model remembering instructions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckResult, DimensionScore } from "./types.js";
import { readJson, getHome, getSettingsLocations } from "./utils.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(getHome(), p.slice(2));
  }
  return p;
}

function getFileSizeKb(filePath: string): number {
  try {
    return statSync(filePath).size / 1024;
  } catch {
    return 0;
  }
}

function countFileLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// ─── Hook event definitions ───────────────────────────────────────────────────

// All 25 hook event names recognised by Claude Code (March 2026).
const ALL_HOOK_EVENTS: ReadonlyArray<string> = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "TaskCreated",
  "TaskCompleted",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
  "PermissionRequest",
  "SubagentResult",
  "SubagentError",
  "SubagentTimeout",
  "AgentStart",
  "AgentStop",
  "AgentError",
  "MemoryWrite",
  "MemoryRead",
  "FileChange",
  "BranchChange",
  "ConversationStart",
  "ConversationEnd",
];

// The 10 key events users most benefit from having covered.
const KEY_HOOK_EVENTS: ReadonlyArray<string> = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "TaskCreated",
  "TaskCompleted",
  "SubagentStart",
  "SubagentStop",
  "Notification",
];

// ─── Hook extraction utilities ────────────────────────────────────────────────

interface HookEntry {
  event: string;
  type: string;
  command?: string | undefined;
}

/**
 * Extract all individual hook handlers from a settings object.
 *
 * Settings shape:
 *   hooks: { [EventName]: Array<{ matcher?: string, hooks: Array<{ type, command?, ... }> }> }
 */
function extractHooks(settings: Record<string, unknown>): HookEntry[] {
  const hooksMap = settings.hooks as Record<string, unknown> | undefined;
  if (!hooksMap || typeof hooksMap !== "object") return [];

  const result: HookEntry[] = [];

  for (const [eventName, matchers] of Object.entries(hooksMap)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcherGroup of matchers) {
      const group = matcherGroup as Record<string, unknown> | undefined;
      if (!group) continue;
      const innerHooks = group.hooks;
      if (!Array.isArray(innerHooks)) continue;
      for (const hook of innerHooks) {
        const h = hook as Record<string, unknown> | undefined;
        if (!h) continue;
        const entry: HookEntry = {
          event: eventName,
          type: typeof h.type === "string" ? h.type : "unknown",
        };
        if (typeof h.command === "string") {
          entry.command = h.command;
        }
        result.push(entry);
      }
    }
  }

  return result;
}

// ─── Check 1: Hook coverage ───────────────────────────────────────────────────

function checkHookCoverage(
  settingsFiles: Record<string, unknown>[],
): CheckResult {
  const allHooks = settingsFiles.flatMap(extractHooks);

  const coveredAllEvents = new Set(allHooks.map((h) => h.event));
  const coveredKeyEvents = KEY_HOOK_EVENTS.filter((e) =>
    coveredAllEvents.has(e),
  );
  const missingKeyEvents = KEY_HOOK_EVENTS.filter(
    (e) => !coveredAllEvents.has(e),
  );

  const keyCount = coveredKeyEvents.length;
  const totalCount = ALL_HOOK_EVENTS.filter((e) =>
    coveredAllEvents.has(e),
  ).length;

  // Pass threshold: at least 5 of 10 key events covered
  const passed = keyCount >= 5;

  return {
    name: "Hook coverage",
    passed,
    value: `${keyCount}/10 key events, ${totalCount}/${ALL_HOOK_EVENTS.length} total`,
    target: "≥5/10 key events covered",
    source: "settings.json hooks (all scopes)",
    confidence: "verified",
    fix_available: !passed,
    points: 25,
    applicable: true,
    ...(missingKeyEvents.length > 0
      ? {
          detail: `Missing key events: ${missingKeyEvents.join(", ")}. Add handlers for automation workflows.`,
        }
      : {}),
  };
}

// ─── Check 2: Dead hook scripts ───────────────────────────────────────────────

function checkDeadHookScripts(
  settingsFiles: Record<string, unknown>[],
): CheckResult {
  const allHooks = settingsFiles.flatMap(extractHooks);

  // Only validate command-type hooks with a non-empty, non-inline command.
  // Inline shell expressions (containing &&, ||, ;, $) are not file paths.
  const commandHooks = allHooks.filter(
    (h) =>
      h.type === "command" &&
      typeof h.command === "string" &&
      h.command.trim().length > 0,
  );

  // Distinguish file-path commands vs inline shell expressions.
  // A command is a file path if it starts with / or ~/ and has no shell metacharacters.
  const filePathHooks = commandHooks.filter((h) => {
    const cmd = (h.command ?? "").trim();
    // Must look like a path (starts with / or ~/)
    if (!cmd.startsWith("/") && !cmd.startsWith("~/")) return false;
    // Reject if it contains shell metacharacters that indicate inline scripting
    if (/[;&|$`'"()]/.test(cmd)) return false;
    return true;
  });

  const deadScripts: string[] = [];

  for (const hook of filePathHooks) {
    const expanded = expandHome(hook.command ?? "");
    if (!existsSync(expanded)) {
      deadScripts.push(hook.command ?? "");
    }
  }

  const passed = deadScripts.length === 0;
  const noHooksAtAll = allHooks.length === 0;

  return {
    name: "Dead hook scripts",
    passed,
    value: passed
      ? `all ${filePathHooks.length} command scripts exist`
      : `${deadScripts.length} script(s) missing`,
    target: "all command-type hook scripts exist on disk",
    source: "settings.json hooks[*].hooks[*].command",
    confidence: "verified",
    fix_available: !passed,
    points: 15,
    applicable: !noHooksAtAll,
    ...(deadScripts.length > 0
      ? {
          detail: `Missing scripts: ${deadScripts.join(", ")}. These hooks are silently skipped or will error at runtime.`,
        }
      : {}),
  };
}

// ─── Check 3: Duplicate hooks ────────────────────────────────────────────────

/**
 * Key-order-independent JSON serialization for structural comparison.
 * Ensures {a:1, b:2} and {b:2, a:1} produce the same string.
 */
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

/**
 * Detect duplicate matcher groups within the same hook event.
 * Two entries are duplicates if they produce the same stable JSON (key-order independent).
 * Common cause: deepMerge bugs, manual copy-paste, settings sync corruption.
 */
function checkDuplicateHooks(
  settingsFiles: Record<string, unknown>[],
): CheckResult {
  let totalDuplicates = 0;
  const affectedEvents: string[] = [];

  for (const settings of settingsFiles) {
    const hooksMap = settings.hooks as Record<string, unknown> | undefined;
    if (!hooksMap || typeof hooksMap !== "object") continue;

    for (const [eventName, matchers] of Object.entries(hooksMap)) {
      if (!Array.isArray(matchers)) continue;
      const seen = new Set<string>();
      let eventDupes = 0;
      for (const entry of matchers) {
        const key = stableStringify(entry);
        if (seen.has(key)) {
          eventDupes++;
        } else {
          seen.add(key);
        }
      }
      if (eventDupes > 0) {
        totalDuplicates += eventDupes;
        if (!affectedEvents.includes(eventName)) {
          affectedEvents.push(eventName);
        }
      }
    }
  }

  const passed = totalDuplicates === 0;

  // N/A if no hooks exist at all across any settings file
  const anyHooksExist = settingsFiles.some((s) => {
    const hooksMap = s.hooks as Record<string, unknown> | undefined;
    return (
      hooksMap &&
      typeof hooksMap === "object" &&
      Object.keys(hooksMap).length > 0
    );
  });

  return {
    name: "Duplicate hooks",
    passed,
    value: passed ? "no duplicates" : `${totalDuplicates} duplicate(s)`,
    target: "zero duplicate hook entries",
    source: "settings.json hooks",
    confidence: "verified",
    fix_available: !passed,
    points: 10,
    applicable: anyHooksExist,
    detail: passed
      ? undefined
      : `${totalDuplicates} duplicate hook entries across ${affectedEvents.length} events: ${affectedEvents.join(", ")}. ` +
        `Each duplicate runs the same command twice per trigger, doubling latency. ` +
        `Likely caused by a settings merge or sync bug.`,
  };
}

// ─── Check 4: CLAUDE.md hierarchy ────────────────────────────────────────────

interface ClaudemdLevel {
  label: string;
  path: string;
}

function checkClaudemdHierarchy(repoRoot: string): CheckResult {
  const home = getHome();
  const resolved = resolve(repoRoot);

  const levels: ClaudemdLevel[] = [
    {
      label: "managed",
      path: "/Library/Application Support/ClaudeCode/CLAUDE.md",
    },
    { label: "user", path: join(home, ".claude", "CLAUDE.md") },
    { label: "project", path: join(resolved, "CLAUDE.md") },
    {
      label: "project (.claude/)",
      path: join(resolved, ".claude", "CLAUDE.md"),
    },
  ];

  const presentLevels = levels.filter((l) => existsSync(l.path));
  const missingLevels = levels.filter((l) => !existsSync(l.path));

  // Check for rules directory
  const rulesDir = join(resolved, ".claude", "rules");
  const hasRules =
    existsSync(rulesDir) &&
    (() => {
      try {
        return (
          readdirSync(rulesDir).filter((f) => f.endsWith(".md")).length > 0
        );
      } catch {
        return false;
      }
    })();

  // Total size of all present CLAUDE.md files
  const totalSizeKb = presentLevels.reduce(
    (sum, l) => sum + getFileSizeKb(l.path),
    0,
  );
  const sizeOk = totalSizeKb < 25;

  // Pass: user + project level both exist (the two that matter most)
  const hasUser = existsSync(join(home, ".claude", "CLAUDE.md"));
  const hasProject =
    existsSync(join(resolved, "CLAUDE.md")) ||
    existsSync(join(resolved, ".claude", "CLAUDE.md"));
  const passed = hasUser && hasProject;

  const details: string[] = [];
  if (!passed) {
    if (missingLevels.length > 0) {
      details.push(
        `Missing levels: ${missingLevels.map((l) => l.label).join(", ")}`,
      );
    }
  }
  if (!hasRules) {
    details.push(
      "No .claude/rules/*.md — rule fragments let you scope instructions",
    );
  }
  if (!sizeOk) {
    details.push(
      `Total CLAUDE.md size ${totalSizeKb.toFixed(1)}KB exceeds 25KB — split into rules/*.md`,
    );
  }

  return {
    name: "CLAUDE.md hierarchy",
    passed,
    value: `${presentLevels.length}/4 levels present${hasRules ? " + rules" : ""}${!sizeOk ? ` (${totalSizeKb.toFixed(1)}KB)` : ""}`,
    target: "user + project levels present, <25KB total, rules/ optional",
    source: "filesystem CLAUDE.md locations",
    confidence: "verified",
    fix_available: !passed,
    points: 30,
    applicable: true,
    ...(details.length > 0 ? { detail: details.join(". ") } : {}),
  };
}

// ─── Check 4: Memory health ───────────────────────────────────────────────────

function checkMemoryHealth(
  settingsFiles: Record<string, unknown>[],
  repoRoot: string,
): CheckResult {
  const home = getHome();

  // Scope to current repo: derive slug from repoRoot path
  // Claude Code uses the absolute path with / replaced by - as the project slug
  const slug = repoRoot.replace(/^\//, "").replace(/\//g, "-");
  const projectsDir = join(home, ".claude", "projects");
  let memoryPath: string | undefined;

  // First try exact slug match
  const exactCandidate = join(projectsDir, slug, "memory", "MEMORY.md");
  if (existsSync(exactCandidate)) {
    memoryPath = exactCandidate;
  }

  // Fallback: search project dirs for one containing our repo name
  if (!memoryPath && existsSync(projectsDir)) {
    const repoName = repoRoot.split("/").pop() ?? "";
    try {
      const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.includes(repoName))
        .map((d) => d.name);

      for (const dir of projectDirs) {
        const candidate = join(projectsDir, dir, "memory", "MEMORY.md");
        if (existsSync(candidate)) {
          memoryPath = candidate;
          break;
        }
      }
    } catch {
      // projectsDir not readable
    }
  }

  // Check autoMemoryEnabled — false only if EXPLICITLY set to false
  const autoMemoryDisabled = settingsFiles.some(
    (s) => s.autoMemoryEnabled === false,
  );

  if (!memoryPath) {
    return {
      name: "Memory health",
      passed: false,
      value: "no MEMORY.md found",
      target: "MEMORY.md present, <200 lines, autoMemory not disabled",
      source: "~/.claude/projects/*/memory/MEMORY.md",
      confidence: "verified",
      fix_available: true,
      points: 20,
      applicable: true,
      detail:
        "No MEMORY.md found in any project memory directory. Claude cannot persist context across sessions." +
        (autoMemoryDisabled
          ? " autoMemoryEnabled is explicitly false — re-enable it."
          : ""),
    };
  }

  const lineCount = countFileLines(memoryPath);
  const lineOk = lineCount <= 200;
  const passed = lineOk && !autoMemoryDisabled;

  const issues: string[] = [];
  if (!lineOk) {
    issues.push(
      `MEMORY.md is ${lineCount} lines (>200) — prune stale entries to keep retrieval accurate`,
    );
  }
  if (autoMemoryDisabled) {
    issues.push(
      "autoMemoryEnabled is explicitly false in settings — Claude will not auto-update memory",
    );
  }

  return {
    name: "Memory health",
    passed,
    value: `${lineCount} lines${autoMemoryDisabled ? ", autoMemory disabled" : ", autoMemory active"}`,
    target: "<200 lines, autoMemory not disabled",
    source: memoryPath,
    confidence: "verified",
    fix_available: !passed,
    points: 20,
    applicable: true,
    ...(issues.length > 0 ? { detail: issues.join(". ") } : {}),
  };
}

// ─── Score calculation ────────────────────────────────────────────────────────

function calculateAutomationScore(checks: CheckResult[]): number {
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

export function scanAutomation(repoRoot: string): DimensionScore {
  const locs = getSettingsLocations(resolve(repoRoot));

  const settingsFiles = [
    readJson(locs.user),
    readJson(locs.projectShared),
    readJson(locs.projectLocal),
  ].filter((s): s is Record<string, unknown> => s !== null);

  const checks: CheckResult[] = [
    checkHookCoverage(settingsFiles),
    checkDeadHookScripts(settingsFiles),
    checkDuplicateHooks(settingsFiles),
    checkClaudemdHierarchy(resolve(repoRoot)),
    checkMemoryHealth(settingsFiles, resolve(repoRoot)),
  ];

  const score = calculateAutomationScore(checks);

  return {
    name: "Automation & Workflow",
    score,
    weight: 0.25,
    checks,
  };
}
