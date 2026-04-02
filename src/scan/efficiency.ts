/**
 * efficiency.ts — Efficiency dimension scanner
 *
 * Weight: 0.20. Checks cache hit ratio from session transcripts, session
 * activity volume, and cost trend from ~/.claude.json.
 *
 * PRIVACY RULE: ONLY reads message.usage fields from transcripts.
 * message.content is NEVER accessed.
 *
 * Transcripts: ~/.claude/projects/<project-slug>/*.jsonl
 * Global config: ~/.claude.json (lastTotal* token fields per project)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, DimensionScore } from "./types.js";
import { readJson, getHome } from "./utils.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AggregatedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  lineCount: number;
}

interface CostSummaryFields {
  lastTotalInputTokens?: number;
  lastTotalOutputTokens?: number;
  lastTotalCacheCreationInputTokens?: number;
  lastTotalCacheReadInputTokens?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a project slug from the repo root path (mirrors Claude Code convention). */
function repoToSlug(repoRoot: string): string {
  // Claude Code stores projects as the absolute path with slashes replaced by dashes,
  // e.g. /Users/arshya/my-repo → -Users-arshya-my-repo
  return repoRoot.replace(/\//g, "-");
}

/** Find the project directory under ~/.claude/projects/ for this repo. */
function findProjectDir(repoRoot: string): string | null {
  const home = getHome();
  const projectsDir = join(home, ".claude", "projects");
  if (!existsSync(projectsDir)) return null;

  const slug = repoToSlug(repoRoot);

  // Try exact slug first
  const exactPath = join(projectsDir, slug);
  if (existsSync(exactPath)) return exactPath;

  // Fall back: scan for a directory whose name ends with the slug suffix
  // (handles edge cases where Claude Code normalises differently)
  try {
    const entries = readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === slug) {
        return join(projectsDir, entry.name);
      }
    }
    // Last resort: find directory whose name contains the last path segment
    const lastSegment = repoRoot.split("/").filter(Boolean).pop() ?? "";
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        lastSegment.length > 0 &&
        entry.name.endsWith(`-${lastSegment}`)
      ) {
        return join(projectsDir, entry.name);
      }
    }
  } catch {
    // readdirSync failed — no project dir found
  }

  return null;
}

/** List all *.jsonl session files in a project directory. */
function listSessionFiles(projectDir: string): string[] {
  try {
    const files = readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(projectDir, f));
    // Cap at 20 most recent files to avoid OOM on power users
    return files
      .map((f) => ({ path: f, mtime: statSync(f).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20)
      .map((f) => f.path);
  } catch {
    return [];
  }
}

/**
 * Parse a single JSONL file and accumulate usage-only fields.
 * PRIVACY: reads ONLY message.usage — never message.content.
 */
function parseSessionUsage(filePath: string): AggregatedUsage {
  const result: AggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    lineCount: 0,
  };

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;

    // Only inspect the message field; ignore everything else
    const msg = record["message"];
    if (typeof msg !== "object" || msg === null) continue;
    const message = msg as Record<string, unknown>;

    // PRIVACY: access ONLY message.usage, never message.content
    const usageRaw = message["usage"];
    if (typeof usageRaw !== "object" || usageRaw === null) continue;
    const usage = usageRaw as UsageFields;

    result.lineCount++;
    result.inputTokens += usage.input_tokens ?? 0;
    result.outputTokens += usage.output_tokens ?? 0;
    result.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    result.cacheRead += usage.cache_read_input_tokens ?? 0;
  }

  return result;
}

// ─── Individual checks ───────────────────────────────────────────────────────

function checkCacheHitRatio(aggregated: AggregatedUsage): CheckResult {
  const { inputTokens, cacheCreation, cacheRead } = aggregated;
  const denominator = cacheRead + inputTokens + cacheCreation;

  if (denominator === 0) {
    return {
      name: "Cache hit ratio",
      passed: false,
      value: "no data",
      target: ">60%",
      source: "session transcripts message.usage",
      confidence: "verified",
      fix_available: false,
      detail:
        "No token usage data found in transcripts. Cannot compute cache hit ratio.",
    };
  }

  const ratio = cacheRead / denominator;
  const pct = Math.round(ratio * 100);
  const passed = ratio >= 0.6;
  const isWarning = ratio >= 0.3 && ratio < 0.6;

  return {
    name: "Cache hit ratio",
    passed,
    value: `${pct}%`,
    target: ">60%",
    source: "session transcripts message.usage",
    confidence: "verified",
    fix_available: !passed,
    detail: passed
      ? undefined
      : isWarning
        ? `Cache hit ratio is ${pct}% (warning: 30–60%). Add a large CLAUDE.md or persistent system prompt to seed the cache.`
        : `Cache hit ratio is ${pct}% (fail: <30%). Most tokens are being billed at full price. Seed the prompt cache with project context.`,
  };
}

function checkSessionActivity(sessionCount: number): CheckResult {
  const isActive = sessionCount > 10;
  const isModerate = sessionCount >= 3 && sessionCount <= 10;
  const level = isActive ? "active" : isModerate ? "moderate" : "low data";

  return {
    name: "Session activity",
    passed: sessionCount >= 3,
    value: `${sessionCount} sessions (${level})`,
    target: ">=3 sessions",
    source: "~/.claude/projects/<slug>/*.jsonl",
    confidence: "verified",
    fix_available: false,
    detail:
      sessionCount < 3
        ? "Fewer than 3 sessions recorded. Not enough data for reliable efficiency analysis."
        : undefined,
  };
}

function checkCostTrend(costData: CostSummaryFields | null): CheckResult {
  if (
    costData === null ||
    (costData.lastTotalInputTokens === undefined &&
      costData.lastTotalOutputTokens === undefined)
  ) {
    return {
      name: "Cost trend (total tokens)",
      passed: true,
      value: "no data",
      target: "informational",
      source: "~/.claude.json projects section",
      confidence: "inferred",
      fix_available: false,
      detail: "No per-project token summary found in ~/.claude.json.",
    };
  }

  const input = costData.lastTotalInputTokens ?? 0;
  const output = costData.lastTotalOutputTokens ?? 0;
  const creation = costData.lastTotalCacheCreationInputTokens ?? 0;
  const read = costData.lastTotalCacheReadInputTokens ?? 0;
  const total = input + output + creation + read;

  const fmt = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${Math.round(n / 1_000)}K`
        : String(n);

  return {
    name: "Cost trend (total tokens)",
    passed: true,
    value: fmt(total),
    target: "informational",
    source: "~/.claude.json projects section",
    confidence: "verified",
    fix_available: false,
    detail: `Input: ${fmt(input)}, Output: ${fmt(output)}, Cache creation: ${fmt(creation)}, Cache read: ${fmt(read)}`,
  };
}

// ─── Cost summary lookup ─────────────────────────────────────────────────────

function readCostSummary(repoRoot: string): CostSummaryFields | null {
  const home = getHome();
  const claudeJson = readJson(join(home, ".claude.json"));
  if (claudeJson === null) return null;

  // ~/.claude.json stores per-project data under a "projects" key keyed by path
  const projects = claudeJson["projects"];
  if (typeof projects !== "object" || projects === null) return null;

  const projectsMap = projects as Record<string, unknown>;

  // Try repoRoot as key directly (absolute path)
  let projectEntry = projectsMap[repoRoot];

  // Fall back: try slug
  if (projectEntry === undefined) {
    projectEntry = projectsMap[repoToSlug(repoRoot)];
  }

  if (typeof projectEntry !== "object" || projectEntry === null) return null;
  const entry = projectEntry as Record<string, unknown>;

  const result: CostSummaryFields = {};

  const extractNum = (key: string): number | undefined => {
    const v = entry[key];
    return typeof v === "number" ? v : undefined;
  };

  const inp = extractNum("lastTotalInputTokens");
  const out = extractNum("lastTotalOutputTokens");
  const cre = extractNum("lastTotalCacheCreationInputTokens");
  const red = extractNum("lastTotalCacheReadInputTokens");

  if (inp !== undefined) result.lastTotalInputTokens = inp;
  if (out !== undefined) result.lastTotalOutputTokens = out;
  if (cre !== undefined) result.lastTotalCacheCreationInputTokens = cre;
  if (red !== undefined) result.lastTotalCacheReadInputTokens = red;

  const hasAny =
    inp !== undefined ||
    out !== undefined ||
    cre !== undefined ||
    red !== undefined;
  return hasAny ? result : null;
}

// ─── Score calculation ────────────────────────────────────────────────────────

function calculateEfficiencyScore(
  checks: CheckResult[],
  sessionCount: number,
): number {
  if (sessionCount === 0) return 0;

  // Cache hit ratio: weighted 70% of score
  // Session activity: weighted 30% of score
  // Cost trend is informational — always passes, not included in scoring
  const cacheCheck = checks.find((c) => c.name === "Cache hit ratio");
  const activityCheck = checks.find((c) => c.name === "Session activity");

  let cacheScore = 0;
  if (cacheCheck !== undefined) {
    const val = cacheCheck.value;
    if (typeof val === "string" && val.endsWith("%")) {
      const pct = parseInt(val, 10);
      if (!isNaN(pct)) {
        cacheScore = pct >= 60 ? 100 : pct >= 30 ? 50 : 20;
      }
    }
  }

  let activityScore = 0;
  if (activityCheck !== undefined) {
    activityScore = activityCheck.passed ? (sessionCount > 10 ? 100 : 70) : 30;
  }

  return Math.round(cacheScore * 0.7 + activityScore * 0.3);
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export function scanEfficiency(repoRoot: string): DimensionScore {
  const projectDir = findProjectDir(repoRoot);

  if (projectDir === null) {
    return {
      name: "Efficiency",
      score: 0,
      weight: 0.2,
      checks: [
        {
          name: "Session data",
          passed: false,
          value: "not found",
          target: "session files present",
          source: "~/.claude/projects/",
          confidence: "verified",
          fix_available: false,
          detail:
            "No session data found. Start using Claude Code in this project to collect efficiency metrics.",
        },
      ],
    };
  }

  const sessionFiles = listSessionFiles(projectDir);
  const sessionCount = sessionFiles.length;

  if (sessionCount === 0) {
    return {
      name: "Efficiency",
      score: 0,
      weight: 0.2,
      checks: [
        {
          name: "Session data",
          passed: false,
          value: "no sessions",
          target: "session files present",
          source: projectDir,
          confidence: "verified",
          fix_available: false,
          detail:
            "No session data found. Start using Claude Code in this project to collect efficiency metrics.",
        },
      ],
    };
  }

  // Aggregate usage across ALL session files (usage fields only)
  const aggregated: AggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    lineCount: 0,
  };

  for (const file of sessionFiles) {
    const usage = parseSessionUsage(file);
    aggregated.inputTokens += usage.inputTokens;
    aggregated.outputTokens += usage.outputTokens;
    aggregated.cacheCreation += usage.cacheCreation;
    aggregated.cacheRead += usage.cacheRead;
    aggregated.lineCount += usage.lineCount;
  }

  const costData = readCostSummary(repoRoot);

  const checks: CheckResult[] = [
    checkCacheHitRatio(aggregated),
    checkSessionActivity(sessionCount),
    checkCostTrend(costData),
  ];

  const score = calculateEfficiencyScore(checks, sessionCount);

  return {
    name: "Efficiency",
    score,
    weight: 0.2,
    checks,
  };
}
