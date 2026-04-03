/**
 * memory-consolidator.ts — Local-only MEMORY.md deduplication and cleanup
 *
 * Separate opt-in command (not bundled in `xray fix`).
 * Reads MEMORY.md, deduplicates entries, removes short/stale lines,
 * sorts by topic heading, and shows before/after line count with diff.
 *
 * Does NOT require an API key — pure local text processing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConsolidateResult {
  before: number;
  after: number;
  diff: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getHome(): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  if (!home) {
    throw new Error("HOME or USERPROFILE environment variable is required");
  }
  return home;
}

function findMemoryFile(repoRoot: string): string | undefined {
  // Check project-level first, then user-level
  const candidates = [
    join(repoRoot, ".claude", "memory", "MEMORY.md"),
    join(repoRoot, ".claude", "MEMORY.md"),
    join(getHome(), ".claude", "projects", "MEMORY.md"),
    join(getHome(), ".claude", "memory", "MEMORY.md"),
    join(getHome(), ".claude", "MEMORY.md"),
  ];
  return candidates.find((p) => existsSync(p));
}

// ─── Section parsing ────────────────────────────────────────────────────────

interface Section {
  heading: string;
  lines: string[];
}

function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line, lines: [] };
    } else if (line.startsWith("# ") && !line.startsWith("## ")) {
      // Top-level heading — treat as a section too
      if (current) sections.push(current);
      current = { heading: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Content before any heading
      if (!current) {
        current = { heading: "", lines: [] };
      }
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicateLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    // Keep empty lines and short separators
    if (normalized === "" || normalized.startsWith("---")) {
      result.push(line);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(line);
    }
  }

  return result;
}

// ─── Stale entry removal ───────────────────────────────────────────────────

/**
 * Remove lines that are too short to be useful (< 10 chars after trim),
 * excluding blank lines, list markers, and headings.
 */
function removeShortEntries(lines: string[]): string[] {
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === "") return true; // Keep blank lines
    if (trimmed.startsWith("#")) return true; // Keep headings
    if (trimmed.startsWith("---")) return true; // Keep separators
    if (trimmed.startsWith("- ") && trimmed.length < 10) return false;
    return true;
  });
}

// ─── Consolidation ─────────────────────────────────────────────────────────

function consolidateContent(content: string): string {
  const rawSections = parseSections(content);

  // Merge sections with the same heading
  const mergedMap = new Map<string, Section>();
  const headingOrder: string[] = [];
  for (const section of rawSections) {
    const key = section.heading.trim().toLowerCase();
    const existing = mergedMap.get(key);
    if (existing) {
      existing.lines.push(...section.lines);
    } else {
      mergedMap.set(key, {
        heading: section.heading,
        lines: [...section.lines],
      });
      headingOrder.push(key);
    }
  }
  const sections = headingOrder
    .map((key) => mergedMap.get(key))
    .filter((s): s is Section => s !== undefined);

  // Process each section: deduplicate and clean
  const processed: Section[] = [];
  for (const section of sections) {
    const deduped = deduplicateLines(section.lines);
    const cleaned = removeShortEntries(deduped);
    // Remove trailing blank lines within a section
    while (cleaned.length > 0 && cleaned[cleaned.length - 1]!.trim() === "") {
      cleaned.pop();
    }
    processed.push({ heading: section.heading, lines: cleaned });
  }

  // Sort sections alphabetically by heading (keeping top-level heading first)
  const topLevel = processed.filter(
    (s) => s.heading.startsWith("# ") && !s.heading.startsWith("## "),
  );
  const subSections = processed.filter(
    (s) => s.heading.startsWith("## ") || s.heading === "",
  );
  subSections.sort((a, b) => a.heading.localeCompare(b.heading));

  // Reassemble
  const output: string[] = [];
  for (const section of [...topLevel, ...subSections]) {
    if (section.heading) {
      output.push(section.heading);
    }
    if (section.lines.length > 0) {
      output.push(...section.lines);
    }
    output.push(""); // blank line between sections
  }

  // Clean up multiple consecutive blank lines
  const final: string[] = [];
  let lastBlank = false;
  for (const line of output) {
    const isBlank = line.trim() === "";
    if (isBlank && lastBlank) continue;
    final.push(line);
    lastBlank = isBlank;
  }

  // Trim trailing whitespace
  while (final.length > 0 && final[final.length - 1]!.trim() === "") {
    final.pop();
  }

  return final.join("\n") + "\n";
}

// ─── Diff generation ────────────────────────────────────────────────────────

function generateSimpleDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const afterSet = new Set(afterLines.map((l) => l.trim()));
  const beforeSet = new Set(beforeLines.map((l) => l.trim()));

  const removed = beforeLines.filter(
    (l) => l.trim() !== "" && !afterSet.has(l.trim()),
  );
  const added = afterLines.filter(
    (l) => l.trim() !== "" && !beforeSet.has(l.trim()),
  );

  const parts: string[] = [];
  if (removed.length > 0) {
    parts.push(`Removed ${removed.length} line(s):`);
    for (const line of removed.slice(0, 10)) {
      parts.push(`  - ${line.trim()}`);
    }
    if (removed.length > 10) {
      parts.push(`  ... and ${removed.length - 10} more`);
    }
  }
  if (added.length > 0) {
    parts.push(`Added ${added.length} line(s):`);
    for (const line of added.slice(0, 10)) {
      parts.push(`  + ${line.trim()}`);
    }
    if (added.length > 10) {
      parts.push(`  ... and ${added.length - 10} more`);
    }
  }
  if (parts.length === 0) {
    parts.push("No changes detected.");
  }
  return parts.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Consolidate a MEMORY.md file: deduplicate, remove stale entries, sort.
 *
 * @param repoRoot - Repository root (searches project-level then user-level)
 * @param dryRun - If true, does not write changes
 * @returns Before/after line counts and a human-readable diff
 */
export function consolidateMemory(
  repoRoot: string,
  dryRun: boolean,
): ConsolidateResult {
  const memoryPath = findMemoryFile(repoRoot);

  if (!memoryPath) {
    return {
      before: 0,
      after: 0,
      diff: "No MEMORY.md found at project or user level.",
    };
  }

  const original = readFileSync(memoryPath, "utf-8");
  const beforeCount = original.split("\n").length;

  if (beforeCount <= 200) {
    return {
      before: beforeCount,
      after: beforeCount,
      diff: `MEMORY.md is ${beforeCount} lines (threshold: 200). No consolidation needed.`,
    };
  }

  const consolidated = consolidateContent(original);
  const afterCount = consolidated.split("\n").length;
  const diff = generateSimpleDiff(original, consolidated);

  if (!dryRun) {
    writeFileSync(memoryPath, consolidated, "utf-8");
  }

  return {
    before: beforeCount,
    after: afterCount,
    diff: `${memoryPath}\n${diff}`,
  };
}
