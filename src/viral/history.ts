/**
 * history.ts — Score-over-time tracking and sparkline display
 *
 * Stores scan results in ~/.xray/history.jsonl, renders ASCII sparkline.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HistoryEntry } from "../scan/types.js";

const XRAY_DIR = join(process.env.HOME ?? "/tmp", ".xray");
const HISTORY_FILE = join(XRAY_DIR, "history.jsonl");

export function appendHistory(entry: HistoryEntry): void {
  try {
    if (!existsSync(XRAY_DIR)) mkdirSync(XRAY_DIR, { recursive: true });
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort. Don't fail the scan.
  }
}

export function readHistory(limit: number = 20): HistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const lines = readFileSync(HISTORY_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    return lines.map((l) => JSON.parse(l) as HistoryEntry).slice(-limit);
  } catch {
    return [];
  }
}

export function renderHistory(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return "No history yet. Run 'npx claude-code-xray' to start tracking.";
  }

  const scores = entries.map((e) => e.overall_score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = Math.max(max - min, 10); // minimum range of 10

  const HEIGHT = 6;
  const lines: string[] = [];

  // Build sparkline grid
  const grid: string[][] = Array.from({ length: HEIGHT }, () =>
    Array(scores.length).fill(" "),
  );

  for (let i = 0; i < scores.length; i++) {
    const normalized = (scores[i]! - min) / range;
    const row = HEIGHT - 1 - Math.round(normalized * (HEIGHT - 1));
    grid[row]![i] = "*";
  }

  // Render with Y-axis labels
  for (let row = 0; row < HEIGHT; row++) {
    const yVal = max - Math.round((row / (HEIGHT - 1)) * range);
    const label = String(yVal).padStart(4);
    lines.push(`${label} | ${grid[row]!.join("  ")}`);
  }

  // X-axis
  const xAxis = "     +" + "---".repeat(scores.length);
  lines.push(xAxis);

  // Date labels (show first, mid, last)
  const dates = entries.map((e) => {
    const d = new Date(e.timestamp);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  if (dates.length <= 6) {
    lines.push("      " + dates.map((d) => d.padEnd(3)).join(""));
  } else {
    const first = dates[0];
    const last = dates[dates.length - 1];
    lines.push(
      `      ${first}${" ".repeat(Math.max(1, (dates.length - 2) * 3))}${last}`,
    );
  }

  return `\nClaude Code X-Ray — Score History\n\n${lines.join("\n")}\n`;
}
