/**
 * lineage.ts — Mutation History Visualization
 *
 * Queries evo.db for the genotype parent_id chain and renders an ASCII tree
 * with ANSI colors showing champion lineage and mutation diffs.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── ANSI colors ────────────────────────────────────────────────────────────

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};

// ─── DB helpers (mirrors shadow.ts pattern) ─────────────────────────────────

const DB_EXEC_OPTS: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  stdio: ["pipe", "pipe", "pipe"],
  timeout: 10_000,
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface GenotypeNode {
  id: string;
  parent_id: string | null;
  status: string;
  generation: number;
  yaml: string;
  utility: number | null;
  children: GenotypeNode[];
}

// ─── Query helpers ──────────────────────────────────────────────────────────

function getAllGenotypes(): GenotypeNode[] {
  const raw = dbQuery(
    `SELECT g.id, g.parent_id, g.status, g.generation, g.yaml, ` +
      `(SELECT e.utility FROM evaluations e WHERE e.genotype_id = g.id ORDER BY e.created_at DESC LIMIT 1) as utility ` +
      `FROM genotypes g ORDER BY g.generation ASC, g.created_at ASC`,
  );
  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const parts = line.split("|");
    return {
      id: parts[0] ?? "",
      parent_id: parts[1] || null,
      status: parts[2] ?? "",
      generation: parseInt(parts[3] ?? "0", 10),
      yaml: parts[4] ?? "",
      utility: parts[5] ? parseFloat(parts[5]) : null,
      children: [],
    };
  });
}

function buildTree(nodes: GenotypeNode[]): GenotypeNode[] {
  const byId = new Map<string, GenotypeNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const roots: GenotypeNode[] = [];
  for (const node of nodes) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ─── Mutation diff ──────────────────────────────────────────────────────────

function describeMutation(
  node: GenotypeNode,
  parentYaml: string | null,
): string {
  if (!parentYaml || !node.yaml) return "champion seed";

  try {
    const parent = JSON.parse(parentYaml);
    const child = JSON.parse(node.yaml);
    const diffs = findDiffs(parent, child, "");
    if (diffs.length === 0) return "no change";
    // Show the first meaningful diff
    const d = diffs[0]!;
    return `${d.path}: ${formatVal(d.from)}→${formatVal(d.to)}`;
  } catch {
    return "mutation";
  }
}

function formatVal(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

interface Diff {
  path: string;
  from: unknown;
  to: unknown;
}

function findDiffs(a: unknown, b: unknown, prefix: string): Diff[] {
  if (a === b) return [];
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return [{ path: prefix, from: a, to: b }];
  }
  // Skip id, parent_id, created_at — these always differ
  const skip = new Set(["id", "parent_id", "created_at"]);
  const diffs: Diff[] = [];
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    diffs.push(...findDiffs(aObj[key], bObj[key], path));
  }
  return diffs;
}

// ─── Render ASCII tree ──────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "champion":
      return `${ansi.green}★ champion${ansi.reset}`;
    case "cemetery":
      return `${ansi.red}✗ cemetery${ansi.reset}`;
    case "frontier":
      return `${ansi.dim}◇ frontier${ansi.reset}`;
    case "active":
      return `${ansi.dim}● active${ansi.reset}`;
    default:
      return status;
  }
}

function colorId(id: string, status: string): string {
  switch (status) {
    case "champion":
      return `${ansi.green}${ansi.bold}${id}${ansi.reset}`;
    case "cemetery":
      return `${ansi.red}${id}${ansi.reset}`;
    default:
      return `${ansi.dim}${id}${ansi.reset}`;
  }
}

function renderTree(
  node: GenotypeNode,
  parentYaml: string | null,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
): string[] {
  const lines: string[] = [];
  const connector = isRoot ? "" : isLast ? "└── " : "├── ";
  const mutation = describeMutation(node, parentYaml);
  const utilStr =
    node.utility !== null ? `U=${node.utility.toFixed(4)}` : "U=—";

  lines.push(
    `${prefix}${connector}${colorId(node.id, node.status)} (${mutation}) ${utilStr} ${statusIcon(node.status)}`,
  );

  const childPrefix = isRoot ? prefix : prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const childIsLast = i === node.children.length - 1;
    lines.push(
      ...renderTree(child, node.yaml, childPrefix, childIsLast, false),
    );
  }

  return lines;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function printLineage(): void {
  const nodes = getAllGenotypes();
  if (nodes.length === 0) {
    console.log("No genotypes found in evo.db.");
    return;
  }

  const roots = buildTree(nodes);

  console.log(
    `\n${ansi.bold}MUTATION LINEAGE${ansi.reset}  (${nodes.length} genotypes)\n`,
  );

  for (const root of roots) {
    const lines = renderTree(root, null, "", true, true);
    for (const line of lines) {
      console.log(line);
    }
  }

  console.log("");
}
