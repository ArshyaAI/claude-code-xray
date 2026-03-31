/**
 * tasks.ts — PROGRAM.md Task Parser
 *
 * Extracts task items from a PROGRAM.md file. Each top-level checkbox line
 * (`- [ ] description`) becomes one task. Nested items are context for the
 * parent task, not separate tasks.
 *
 * task_hash = SHA-256 of the trimmed description text, used to deduplicate
 * across runs.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Task {
  /** SHA-256 of the trimmed description text. */
  hash: string;
  /** The task description (trimmed checkbox text). */
  description: string;
  /** Nested context lines (indented items under this checkbox). */
  context: string[];
}

export interface ParseResult {
  tasks: Task[];
  /** Path to the source file that was parsed. */
  source: string;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a PROGRAM.md file and extract task items.
 *
 * Rules:
 * - Top-level `- [ ] description` lines become tasks
 * - Lines indented under a checkbox are context for that task
 * - Already-checked `- [x]` items are skipped (completed)
 * - Empty descriptions are skipped
 * - Duplicate hashes are deduplicated (first occurrence wins)
 *
 * @param filePath - Path to the PROGRAM.md (or configured task_source)
 * @throws If the file does not exist or contains no tasks
 */
export function parseTasks(filePath: string): ParseResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(
      `No tasks found: ${filePath} does not exist. Add tasks as \`- [ ]\` checkbox items.`,
    );
  }

  const lines = content.split("\n");
  const tasks: Task[] = [];
  const seenHashes = new Set<string>();

  let currentTask: Task | null = null;

  for (const line of lines) {
    // Top-level unchecked checkbox: `- [ ] description`
    const checkboxMatch = line.match(/^- \[ \] (.+)$/);
    if (checkboxMatch?.[1]) {
      // Save previous task if any
      if (currentTask) {
        if (!seenHashes.has(currentTask.hash)) {
          seenHashes.add(currentTask.hash);
          tasks.push(currentTask);
        }
      }

      const description = checkboxMatch[1].trim();
      const hash = createHash("sha256").update(description).digest("hex");

      currentTask = { hash, description, context: [] };
      continue;
    }

    // Skip completed checkboxes
    if (/^- \[x\] /i.test(line)) {
      // Flush current task before skipping
      if (currentTask) {
        if (!seenHashes.has(currentTask.hash)) {
          seenHashes.add(currentTask.hash);
          tasks.push(currentTask);
        }
        currentTask = null;
      }
      continue;
    }

    // Indented lines under a checkbox are context
    if (currentTask && /^\s+/.test(line) && line.trim().length > 0) {
      currentTask.context.push(line.trimEnd());
      continue;
    }

    // Non-indented, non-checkbox line: flush current task
    if (currentTask && !line.match(/^\s*$/)) {
      if (!seenHashes.has(currentTask.hash)) {
        seenHashes.add(currentTask.hash);
        tasks.push(currentTask);
      }
      currentTask = null;
    }
  }

  // Flush final task
  if (currentTask && !seenHashes.has(currentTask.hash)) {
    seenHashes.add(currentTask.hash);
    tasks.push(currentTask);
  }

  if (tasks.length === 0) {
    throw new Error(
      `No tasks found in ${filePath}. Add tasks as \`- [ ]\` checkbox items.`,
    );
  }

  return { tasks, source: filePath };
}

/**
 * Format a task as NIGHT-TASK.md content for agent injection.
 * Includes the description and any nested context.
 */
export function formatTaskForAgent(task: Task): string {
  const lines = [`# Task\n`, task.description, ""];

  if (task.context.length > 0) {
    lines.push("## Context\n");
    for (const ctx of task.context) {
      lines.push(ctx);
    }
    lines.push("");
  }

  return lines.join("\n");
}
