/**
 * render.ts — Terminal renderer for X-Ray results
 *
 * Produces the 3-panel output: Score + What You Have / What You're Missing / What To Do
 */

import type {
  XRayResult,
  DimensionScore,
  SecurityAlert,
  CheckResult,
} from "./types.js";

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

function scoreColor(score: number): string {
  if (score >= 71) return GREEN;
  if (score >= 41) return YELLOW;
  return RED;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function progressBar(score: number, width: number = 10): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = scoreColor(score);
  return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
}

function alertIcon(severity: SecurityAlert["severity"]): string {
  if (severity === "critical") return `${RED}[!]${RESET}`;
  if (severity === "high") return `${YELLOW}[!]${RESET}`;
  return `${DIM}[i]${RESET}`;
}

// ─── Main render ────────────────────────────────────────────────────────────

export function renderResult(result: XRayResult): string {
  const lines: string[] = [];
  const w = 60; // content width

  // Header
  lines.push("");
  lines.push(`${BOLD}${CYAN}Claude Code X-Ray${RESET} ${"─".repeat(w - 18)}`);
  lines.push("");

  // Overall score
  const color = scoreColor(result.overall_score);
  const grade = gradeFromScore(result.overall_score);
  lines.push(
    `  ${BOLD}YOUR SCORE: ${color}${result.overall_score}/100${RESET}  ${DIM}(${result.dimensions_scored}/4 dimensions scored)${RESET}`,
  );
  lines.push("");

  // Dimension bars
  const dimOrder = ["safety", "capability", "automation", "efficiency"];
  for (const key of dimOrder) {
    const dim = result.dimensions[key];
    if (!dim || dim.checks.length === 0) continue;

    const bar = progressBar(dim.score);
    const label = dim.name.padEnd(20);
    const scoreStr = `${dim.score}/100`.padStart(7);
    const alert =
      dim.score < 40 && key === "safety" ? `  ${RED}[!]${RESET}` : "";
    lines.push(`  ${label} ${bar}  ${scoreStr}${alert}`);
  }

  lines.push("");

  // ─── Panel 1: What You Have ───────────────────────────────────────────
  lines.push(`${BOLD}┌─ WHAT YOU HAVE ${"─".repeat(w - 16)}${RESET}`);

  const passed = getAllChecks(result).filter((c) => c.passed);
  if (passed.length === 0) {
    lines.push(`${DIM}│  (nothing detected)${RESET}`);
  } else {
    for (const check of passed.slice(0, 8)) {
      lines.push(
        `│  ${GREEN}✓${RESET} ${check.name}: ${formatValue(check.value)}`,
      );
    }
    if (passed.length > 8) {
      lines.push(`│  ${DIM}... and ${passed.length - 8} more${RESET}`);
    }
  }
  lines.push("│");

  // ─── Panel 2: What You're Missing ─────────────────────────────────────
  lines.push(`${BOLD}├─ WHAT YOU'RE MISSING ${"─".repeat(w - 21)}${RESET}`);

  // Security alerts first
  for (const alert of result.security_alerts) {
    lines.push(`│  ${alertIcon(alert.severity)} ${alert.description}`);
    if (alert.context) {
      lines.push(`│     ${DIM}↳ ${alert.context}${RESET}`);
    }
  }

  // Failed non-security checks
  const failed = getAllChecks(result).filter(
    (c) => !c.passed && !result.security_alerts.some((a) => a.check === c.name),
  );
  for (const check of failed.slice(0, 6)) {
    lines.push(`│  ${DIM}[ ]${RESET} ${check.name}`);
    if (check.detail) {
      lines.push(`│     ${DIM}${check.detail}${RESET}`);
    }
  }
  if (failed.length > 6) {
    lines.push(`│  ${DIM}... and ${failed.length - 6} more${RESET}`);
  }

  if (result.security_alerts.length === 0 && failed.length === 0) {
    lines.push(`│  ${GREEN}Everything looks good!${RESET}`);
  }
  lines.push("│");

  // ─── Panel 3: What To Do Next ─────────────────────────────────────────
  lines.push(
    `${BOLD}├─ WHAT TO DO NEXT (ranked by impact) ${"─".repeat(w - 37)}${RESET}`,
  );

  const fixable = getAllChecks(result).filter(
    (c) => !c.passed && c.fix_available,
  );
  if (fixable.length === 0) {
    lines.push(`│  ${GREEN}No fixes needed. Your setup is solid.${RESET}`);
  } else {
    // Group by dimension for impact estimate
    const safetyFixes = fixable.filter((c) =>
      result.dimensions.safety?.checks.includes(c),
    );
    const otherFixes = fixable.filter(
      (c) => !result.dimensions.safety?.checks.includes(c),
    );

    if (safetyFixes.length > 0) {
      lines.push(
        `│  ${BOLD}+${safetyFixes.length * 5}-${safetyFixes.length * 12} pts${RESET}  Fix critical safety gaps       ${DIM}xray fix${RESET}`,
      );
    }
    if (otherFixes.length > 0) {
      lines.push(
        `│  ${BOLD}+${otherFixes.length * 3}-${otherFixes.length * 8} pts${RESET}  Fix remaining gaps              ${DIM}xray fix${RESET}`,
      );
    }
    lines.push("│");
    lines.push(`│  ${BOLD}Fix all:${RESET} npx claude-code-xray fix`);
  }

  lines.push(`└${"─".repeat(w)}`);
  lines.push("");

  // Badge suggestion
  lines.push(`  ${DIM}Badge: npx claude-code-xray badge${RESET}`);
  lines.push(`  ${DIM}History: npx claude-code-xray history${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAllChecks(result: XRayResult): CheckResult[] {
  return Object.values(result.dimensions).flatMap((d) => d.checks);
}

function formatValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
