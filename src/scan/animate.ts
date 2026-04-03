/**
 * animate.ts — Animated terminal output for X-Ray
 *
 * Pure ANSI escape codes. Zero dependencies.
 * Falls back to static render when stdout is not a TTY.
 */

import type { XRayResult, Fix } from "./types.js";

// ─── ANSI ──────────────────────────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function scoreColor(score: number): string {
  if (score >= 71) return GREEN;
  if (score >= 41) return YELLOW;
  return RED;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function write(text: string): void {
  process.stdout.write(text);
}

function writeln(text: string = ""): void {
  process.stdout.write(text + "\n");
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ─── Animation primitives ──────────────────────────────────────────────────

async function spinner(label: string, durationMs: number): Promise<void> {
  const frames = Math.floor(durationMs / 80);
  for (let i = 0; i < frames; i++) {
    write(
      `\r${CLEAR_LINE}  ${CYAN}${SPINNER[i % SPINNER.length]}${RESET} ${label}`,
    );
    await sleep(80);
  }
  write(`\r${CLEAR_LINE}`);
}

async function fillBar(
  label: string,
  score: number,
  width: number = 10,
  stepMs: number = 30,
): Promise<void> {
  const filled = Math.round((score / 100) * width);
  const color = scoreColor(score);
  const paddedLabel = label.padEnd(20);

  for (let i = 0; i <= filled; i++) {
    const bar = `${color}${"█".repeat(i)}${DIM}${"░".repeat(width - i)}${RESET}`;
    const scoreStr = i === filled ? `${score}/100`.padStart(7) : "";
    write(`\r${CLEAR_LINE}  ${paddedLabel} ${bar}  ${scoreStr}`);
    await sleep(stepMs);
  }

  const alert =
    score < 40 && label.trim().startsWith("Safety")
      ? `  ${RED}[!]${RESET}`
      : "";
  writeln(alert);
}

async function countUp(
  target: number,
  durationMs: number = 600,
): Promise<void> {
  const steps = Math.min(target, 30);
  const stepMs = durationMs / steps;
  const color = scoreColor(target);

  for (let i = 0; i <= steps; i++) {
    const current = Math.round((i / steps) * target);
    write(`\r${CLEAR_LINE}  ${BOLD}YOUR SCORE: ${color}${current}/100${RESET}`);
    await sleep(stepMs);
  }
  write(`  ${gradeFromScore(target)}`);
  writeln();
}

async function countTransition(
  from: number,
  to: number,
  durationMs: number = 800,
): Promise<void> {
  const steps = 20;
  const stepMs = durationMs / steps;
  const delta = to - from;

  for (let i = 0; i <= steps; i++) {
    const current = Math.round(from + (delta * i) / steps);
    const color = scoreColor(current);
    write(`\r${CLEAR_LINE}  ${BOLD}${from} → ${color}${current}${RESET}`);
    await sleep(stepMs);
  }

  const deltaStr =
    delta > 0
      ? ` ${GREEN}(+${delta})${RESET}`
      : delta < 0
        ? ` ${RED}(${delta})${RESET}`
        : "";
  write(`${deltaStr}`);
  writeln();
}

async function typewrite(text: string, charMs: number = 15): Promise<void> {
  for (const ch of text) {
    write(ch);
    await sleep(charMs);
  }
}

// ─── Animated scan reveal ──────────────────────────────────────────────────

export async function animateScan(result: XRayResult): Promise<void> {
  write(HIDE_CURSOR);

  try {
    // Header
    writeln();
    await typewrite(`${BOLD}${CYAN}Claude Code X-Ray${RESET}`);
    write(` ${"─".repeat(42)}`);
    writeln();
    writeln();

    // Scanning animation
    await spinner("Scanning your setup...", 600);

    // Score reveal
    await countUp(result.overall_score);
    writeln();

    // Dimensions scored
    const allDimKeys = [
      { key: "safety", label: "Safety" },
      { key: "capability", label: "Capability" },
      { key: "automation", label: "Automation" },
      { key: "efficiency", label: "Efficiency" },
    ];
    const skipped = allDimKeys.filter((d) => {
      const dim = result.dimensions[d.key];
      return !dim || dim.checks.length === 0;
    });
    if (skipped.length === 0) {
      writeln(
        `  ${BOLD}Scored: ${result.dimensions_scored}/4 dimensions${RESET}  ${GREEN}(all dimensions)${RESET}`,
      );
    } else {
      const skippedList = skipped
        .map((d) => {
          const dim = result.dimensions[d.key];
          return `${d.label} excluded — ${!dim ? "scanner failed" : "no data"}`;
        })
        .join("; ");
      writeln(
        `  ${BOLD}Scored: ${result.dimensions_scored}/4 dimensions${RESET}  ${DIM}(${skippedList})${RESET}`,
      );
    }
    writeln();

    // Dimension bars — fill one by one
    const dimOrder = ["safety", "capability", "automation", "efficiency"];
    for (const key of dimOrder) {
      const dim = result.dimensions[key];
      if (!dim || dim.checks.length === 0) continue;
      await fillBar(dim.name, dim.score);
      await sleep(100);
    }
    writeln();

    // Panels — print with slight delays
    await printPanels(result);

    // Beginner mode
    if (result.overall_score < 20 || result.dimensions_scored < 2) {
      await printBeginnerMode();
    }

    // Footer
    writeln(`  ${DIM}Badge: npx claude-code-xray badge${RESET}`);
    writeln(`  ${DIM}History: npx claude-code-xray history${RESET}`);
    writeln();
  } finally {
    write(SHOW_CURSOR);
  }
}

// ─── Animated fix flow ─────────────────────────────────────────────────────

export async function animateFix(
  before: XRayResult,
  after: XRayResult,
  fixes: Fix[],
  applied: number,
): Promise<void> {
  write(HIDE_CURSOR);

  try {
    writeln();

    // Show each fix being applied
    for (let i = 0; i < fixes.length; i++) {
      await spinner(`Applying: ${fixes[i]!.description}`, 300);
      writeln(`  ${GREEN}✓${RESET} ${fixes[i]!.description}`);
      await sleep(150);
    }

    writeln();

    // Score transition
    await spinner("Re-scanning...", 400);
    await countTransition(before.overall_score, after.overall_score);
    writeln();

    writeln(
      `  Applied ${BOLD}${applied}${RESET} fixes. Backups saved to each file's directory.`,
    );
    writeln();
  } finally {
    write(SHOW_CURSOR);
  }
}

// ─── Panel helpers ─────────────────────────────────────────────────────────

function getAllChecks(result: XRayResult) {
  return Object.values(result.dimensions).flatMap((d) => d.checks);
}

function formatValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

async function printPanels(result: XRayResult): Promise<void> {
  const w = 60;

  // Panel 1: What You Have
  writeln(`${BOLD}┌─ WHAT YOU HAVE ${"─".repeat(w - 16)}${RESET}`);
  await sleep(50);

  const passed = getAllChecks(result).filter((c) => c.passed);
  if (passed.length === 0) {
    writeln(`${DIM}│  (nothing detected)${RESET}`);
  } else {
    for (const check of passed.slice(0, 8)) {
      writeln(
        `│  ${GREEN}✓${RESET} ${check.name}: ${formatValue(check.value)}`,
      );
      await sleep(30);
    }
    if (passed.length > 8) {
      writeln(`│  ${DIM}... and ${passed.length - 8} more${RESET}`);
    }
  }
  writeln("│");

  // Panel 2: What You're Missing
  writeln(`${BOLD}├─ WHAT YOU'RE MISSING ${"─".repeat(w - 21)}${RESET}`);
  await sleep(50);

  for (const alert of result.security_alerts) {
    const icon =
      alert.severity === "critical"
        ? `${RED}[!]${RESET}`
        : alert.severity === "high"
          ? `${YELLOW}[!]${RESET}`
          : `${DIM}[i]${RESET}`;
    writeln(`│  ${icon} ${alert.description}`);
    if (alert.context) {
      writeln(`│     ${DIM}↳ ${alert.context}${RESET}`);
    }
    await sleep(30);
  }

  const failed = getAllChecks(result).filter(
    (c) => !c.passed && !result.security_alerts.some((a) => a.check === c.name),
  );
  for (const check of failed.slice(0, 6)) {
    writeln(`│  ${DIM}[ ]${RESET} ${check.name}`);
    if (check.detail) writeln(`│     ${DIM}${check.detail}${RESET}`);
    await sleep(30);
  }
  if (failed.length > 6) {
    writeln(`│  ${DIM}... and ${failed.length - 6} more${RESET}`);
  }

  if (result.security_alerts.length === 0 && failed.length === 0) {
    writeln(`│  ${GREEN}Everything looks good!${RESET}`);
  }
  writeln("│");

  // Panel 3: What To Do
  writeln(
    `${BOLD}├─ WHAT TO DO NEXT (ranked by impact) ${"─".repeat(w - 37)}${RESET}`,
  );
  await sleep(50);

  const fixable = getAllChecks(result).filter(
    (c) => !c.passed && c.fix_available,
  );
  if (fixable.length === 0) {
    writeln(`│  ${GREEN}No fixes needed. Your setup is solid.${RESET}`);
  } else {
    const safetyFixes = fixable.filter((c) =>
      result.dimensions.safety?.checks.includes(c),
    );
    const otherFixes = fixable.filter(
      (c) => !result.dimensions.safety?.checks.includes(c),
    );
    if (safetyFixes.length > 0) {
      writeln(
        `│  ${BOLD}+${safetyFixes.length * 5}-${safetyFixes.length * 12} pts${RESET}  Fix critical safety gaps       ${DIM}xray fix${RESET}`,
      );
    }
    if (otherFixes.length > 0) {
      writeln(
        `│  ${BOLD}+${otherFixes.length * 3}-${otherFixes.length * 8} pts${RESET}  Fix remaining gaps              ${DIM}xray fix${RESET}`,
      );
    }
    writeln("│");
    writeln(`│  ${BOLD}Fix all:${RESET} npx claude-code-xray fix`);
  }

  writeln(`└${"─".repeat(w)}`);
  writeln();
}

async function printBeginnerMode(): Promise<void> {
  const w = 60;
  writeln(`${BOLD}├─ GETTING STARTED ${"─".repeat(w - 18)}${RESET}`);
  writeln(`│  Your Claude Code setup is mostly defaults.`);
  writeln(`│  Quick wins to get started:`);
  writeln("│");
  writeln(`│  ${BOLD}1.${RESET} Run: ${CYAN}npx claude-code-xray fix${RESET}`);
  writeln(`│     Adds deny rules for secrets + enables sandbox`);
  writeln("│");
  writeln(
    `│  ${BOLD}2.${RESET} Create a ${CYAN}CLAUDE.md${RESET} in your project root`,
  );
  writeln(`│     Tells Claude about your codebase and conventions`);
  writeln("│");
  writeln(`│  ${BOLD}3.${RESET} Run this tool again to see your score improve`);
  writeln("│");
  writeln(`│  ${DIM}Most users go from ~15 to ~55 in under 5 minutes.${RESET}`);
  writeln(`└${"─".repeat(w)}`);
  writeln();
}

// ─── TTY detection ─────────────────────────────────────────────────────────

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}
