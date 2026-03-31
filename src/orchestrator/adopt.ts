/**
 * adopt.ts — Import an external genotype JSON into the evo.db frontier.
 *
 * Usage: factory adopt --from genotype.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync, type ExecSyncOptions } from "node:child_process";
import { homedir } from "node:os";
import {
  validateGenotype,
  SEED_GENOTYPE,
  type Genotype,
} from "../genotype/schema.js";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

// ─── DB helpers (same pattern as shadow.ts) ──────────────────────────────────

const DB_EXEC_OPTS: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  stdio: ["pipe", "pipe", "pipe"],
};

export function getDbPath(): string {
  return process.env.FACTORY_DB ?? join(homedir(), ".factory", "evo.db");
}

function dbQuery(sql: string): string {
  const db = getDbPath();
  if (!existsSync(db)) throw new Error(`evo.db not found at ${db}`);
  const escaped = sql.replace(/'/g, "'\\''");
  const result = execSync(`sqlite3 '${db}' '${escaped}'`, DB_EXEC_OPTS);
  return (typeof result === "string" ? result : "").trim();
}

function dbExec(sql: string): boolean {
  const db = getDbPath();
  if (!existsSync(db)) return false;
  const escaped = sql.replace(/'/g, "'\\''");
  try {
    execSync(`sqlite3 '${db}' '${escaped}'`, DB_EXEC_OPTS);
    return true;
  } catch {
    return false;
  }
}

// ─── Champion loading ────────────────────────────────────────────────────────

function loadChampion(): { genotype: Genotype; generation: number } {
  try {
    const raw = dbQuery(
      'SELECT yaml FROM genotypes WHERE status="champion" LIMIT 1',
    );
    if (!raw) return { genotype: SEED_GENOTYPE, generation: 0 };

    const parsed: unknown = JSON.parse(raw);
    const validation = validateGenotype(parsed);
    if (!validation.valid) return { genotype: SEED_GENOTYPE, generation: 0 };

    const genRaw = dbQuery(
      `SELECT generation FROM genotypes WHERE status="champion" LIMIT 1`,
    );
    const generation = genRaw ? parseInt(genRaw, 10) : 0;

    return { genotype: parsed as Genotype, generation };
  } catch {
    return { genotype: SEED_GENOTYPE, generation: 0 };
  }
}

// ─── Diff display ────────────────────────────────────────────────────────────

type FlatRecord = Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ""): FlatRecord {
  const result: FlatRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

export function showDiff(champion: Genotype, imported: Genotype): string[] {
  const champFlat = flatten(champion as unknown as Record<string, unknown>);
  const importFlat = flatten(imported as unknown as Record<string, unknown>);
  const lines: string[] = [];

  const allKeys = new Set([
    ...Object.keys(champFlat),
    ...Object.keys(importFlat),
  ]);

  for (const key of [...allKeys].sort()) {
    const champVal = JSON.stringify(champFlat[key]);
    const importVal = JSON.stringify(importFlat[key]);

    if (champVal === importVal) {
      lines.push(`${c.dim}  ${key}: ${champVal}${c.reset}`);
    } else {
      lines.push(`${c.green}  ${key}: ${champVal} → ${importVal}${c.reset}`);
    }
  }

  return lines;
}

// ─── Main adopt logic ────────────────────────────────────────────────────────

export function adopt(fromPath: string): void {
  // 1. Read and validate the genotype JSON
  if (!existsSync(fromPath)) {
    console.error(`File not found: ${fromPath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(fromPath, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${fromPath}: ${err}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON in ${fromPath}: ${err}`);
    process.exit(1);
  }

  const validation = validateGenotype(parsed);
  if (!validation.valid) {
    console.error("Genotype validation failed:");
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const imported = parsed as Genotype;

  // 2. Show diff against current champion
  const { genotype: champion, generation: champGen } = loadChampion();

  console.log(
    `\n${c.bold}${c.cyan}Adopting ${imported.id} (comparing to champion ${champion.id})${c.reset}\n`,
  );

  const diffLines = showDiff(champion, imported);
  for (const line of diffLines) {
    console.log(line);
  }

  const changedCount = diffLines.filter((l) => l.includes("→")).length;
  console.log(
    `\n${c.bold}${changedCount} field(s) differ from champion${c.reset}\n`,
  );

  // 3. Insert into evo.db as frontier
  const newGen = champGen + 1;
  const yaml = JSON.stringify(imported).replace(/"/g, '""');
  const now = new Date().toISOString();
  const ok = dbExec(
    `INSERT OR IGNORE INTO genotypes (id, parent_id, yaml, created_at, status, generation) VALUES ("${imported.id}", "${imported.parent_id}", "${yaml}", "${now}", "frontier", ${newGen})`,
  );

  if (ok) {
    console.log(
      `${c.green}${c.bold}✓ Inserted ${imported.id} as frontier (generation ${newGen})${c.reset}`,
    );
  } else {
    console.error("Failed to insert genotype into evo.db");
    process.exit(1);
  }
}
