/**
 * history.ts — Factory history: trend lines across Shadow League runs
 *
 * Queries evo.db for completed shadow_runs and evaluations,
 * renders a compact summary table with ASCII sparklines.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

// ─── DB helpers ──────────────────────────────────────────────────────────────

const DB_EXEC_OPTS: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  stdio: ["pipe", "pipe", "pipe"],
};

function getDbPath(): string {
  return process.env.FACTORY_DB ?? join(homedir(), ".factory", "evo.db");
}

function dbQuery(sql: string): string {
  const db = getDbPath();
  if (!existsSync(db)) {
    throw new Error(`evo.db not found at ${db}`);
  }
  const escaped = sql.replace(/'/g, "'\\''");
  const result = execSync(`sqlite3 '${db}' '${escaped}'`, DB_EXEC_OPTS);
  return (typeof result === "string" ? result : "").trim();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunSummary {
  id: string;
  crews: number;
  tasks: number;
  avg_utility: number;
  cost: number;
  status: string;
  champion_id: string;
}

// ─── Query ───────────────────────────────────────────────────────────────────

export function queryRunHistory(): RunSummary[] {
  const raw = dbQuery(`
    SELECT
      sr.id,
      sr.crew_count,
      sr.task_count,
      sr.actual_cost,
      sr.status
    FROM shadow_runs sr
    WHERE sr.status != 'running'
    ORDER BY sr.started_at ASC
  `);

  if (!raw) return [];

  const runs: RunSummary[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [id, crews, tasks, cost, status] = line.split("|");
    if (!id) continue;

    // Avg utility across all evaluations for this run's genotypes
    const utilRaw = dbQuery(`
      SELECT AVG(e.utility)
      FROM evaluations e
      JOIN shadow_attempts sa ON sa.evaluation_id = e.id
      WHERE sa.run_id = "${id}"
    `);
    const avgUtility = utilRaw ? parseFloat(utilRaw) : 0;

    // Champion: genotype with highest avg utility in this run
    const champRaw = dbQuery(`
      SELECT sa.genotype_id
      FROM shadow_attempts sa
      JOIN evaluations e ON e.id = sa.evaluation_id
      WHERE sa.run_id = "${id}"
      GROUP BY sa.genotype_id
      ORDER BY AVG(e.utility) DESC
      LIMIT 1
    `);

    runs.push({
      id: id,
      crews: parseInt(crews ?? "0", 10),
      tasks: parseInt(tasks ?? "0", 10),
      avg_utility: Math.round((avgUtility || 0) * 10000) / 10000,
      cost: Math.round(parseFloat(cost ?? "0") * 100) / 100,
      status: status ?? "unknown",
      champion_id: champRaw || "—",
    });
  }

  return runs;
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[idx];
    })
    .join("");
}

function trendLabel(values: number[]): string {
  if (values.length < 2) return "";
  const first = values.slice(0, Math.ceil(values.length / 2));
  const second = values.slice(Math.ceil(values.length / 2));
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
  if (avgSecond > avgFirst * 1.05) return "(trending up)";
  if (avgSecond < avgFirst * 0.95) return "(trending down)";
  return "(stable)";
}

// ─── Render ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return c.green;
    case "budget_exceeded":
      return c.yellow;
    case "failed":
      return c.red;
    default:
      return c.dim;
  }
}

export function renderHistory(
  runs: RunSummary[],
  promotionCount?: number,
): string {
  if (runs.length === 0) {
    return "No completed runs found.";
  }

  const lines: string[] = [];
  const line = "─".repeat(80);

  lines.push(`${c.bold}${c.cyan}${line}${c.reset}`);
  lines.push(`${c.bold}  FACTORY HISTORY${c.reset}`);
  lines.push(`${c.cyan}${line}${c.reset}`);
  lines.push("");

  // Table header
  const hdr = `  ${"Run".padEnd(20)} ${"Crews".padEnd(6)} ${"Tasks".padEnd(6)} ${"Avg U".padEnd(8)} ${"Cost".padEnd(8)} ${"Status".padEnd(16)} Champion`;
  lines.push(`${c.bold}${hdr}${c.reset}`);
  lines.push(`  ${c.dim}${"─".repeat(78)}${c.reset}`);

  for (const run of runs) {
    const sc = statusColor(run.status);
    const statusPad = run.status.padEnd(16 - (sc.length + c.reset.length) + 16);
    lines.push(
      `  ${run.id.padEnd(20)} ${String(run.crews).padEnd(6)} ${String(run.tasks).padEnd(6)} ${run.avg_utility.toFixed(4).padEnd(8)} ${"$" + run.cost.toFixed(2).padEnd(7)} ${sc}${statusPad}${c.reset} ${run.champion_id}`,
    );
  }

  lines.push("");

  // Sparklines
  const utilities = runs.map((r) => r.avg_utility);
  const costs = runs.map((r) => r.cost);

  lines.push(`  Utility: ${sparkline(utilities)} ${trendLabel(utilities)}`);
  lines.push(`  Cost:    ${sparkline(costs)} ${trendLabel(costs)}`);
  lines.push("");

  // Promotion rate
  const promoCount = promotionCount ?? 0;
  const totalRuns = runs.length;
  const promoRate =
    totalRuns > 0 ? Math.round((promoCount / totalRuns) * 100) : 0;
  lines.push(`  Promotions: ${promoCount}/${totalRuns} runs (${promoRate}%)`);

  lines.push("");
  lines.push(`${c.cyan}${line}${c.reset}`);

  return lines.join("\n");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function queryPromotionCount(): number {
  try {
    const raw = dbQuery(
      `SELECT COUNT(DISTINCT p.winner_id) FROM promotions p WHERE p.winner_id != p.loser_id`,
    );
    return parseInt(raw || "0", 10);
  } catch {
    return 0;
  }
}

export function showHistory(): void {
  const runs = queryRunHistory();
  const promoCount = queryPromotionCount();
  console.log(renderHistory(runs, promoCount));
}
