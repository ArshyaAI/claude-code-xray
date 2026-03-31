/**
 * crew-pipeline.ts — Multi-Agent Crew Pipeline
 *
 * Orchestrates the builder → reviewer → QA pipeline for each task.
 * Each role uses the genotype's model routing, prompt policy, and tool policy.
 *
 * Design doc: "Phase 1 uses only builder, reviewer, and qa roles from
 * the genotype's 12-role roster."
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Genotype,
  ModelRoute,
  ClaudeModel,
  CodexModel,
} from "../genotype/schema.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineResult {
  /** Builder agent output and success status. */
  builder: RoleResult;
  /** Reviewer agent output and review score. */
  reviewer: RoleResult;
  /** QA agent output and test results. */
  qa: RoleResult;
  /** Total cost across all roles. */
  total_cost_usd: number;
  /** Total duration across all roles. */
  total_duration_sec: number;
  /** Review score parsed from reviewer output (0-100 or undefined). */
  review_score: number | undefined;
}

export interface RoleResult {
  role: "builder" | "reviewer" | "qa";
  success: boolean;
  output: string;
  duration_sec: number;
  cost_usd: number;
}

export interface PipelineOptions {
  /** Path to the worktree where the task runs. */
  worktreePath: string;
  /** Timeout per role in seconds. */
  timeout_sec: number;
  /** Which roles to activate (from factory.yaml active_roles). */
  activeRoles: Array<"builder" | "reviewer" | "qa">;
}

// ─── Model CLI flag mapping ──────────────────────────────────────────────────

/**
 * Map genotype ToolName to Claude CLI tool names.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  write: "Write",
};

/**
 * Convert a genotype ModelRoute + tool policy to claude CLI flags.
 * Claude CLI uses --model for model selection and --allowedTools for restriction.
 */
function buildClaudeFlags(
  route: ModelRoute,
  tools?: readonly string[],
): string[] {
  const flags: string[] = [];

  // Model routing: only Claude models work with claude CLI
  if (isClaudeModel(route.model)) {
    flags.push("--model", route.model);
  }

  // Tool policy enforcement
  if (tools && tools.length > 0) {
    const cliTools = tools.map((t) => TOOL_NAME_MAP[t] ?? t).filter(Boolean);
    if (cliTools.length > 0) {
      flags.push("--allowedTools", cliTools.join(","));
    }
  }

  return flags;
}

function isClaudeModel(model: string): model is ClaudeModel {
  return model.startsWith("claude-");
}

/**
 * Build the system prompt for a role based on genotype prompt_policy.
 * In Phase 1, this returns role-specific instructions.
 * Phase 2 will load actual prompt variants from a prompt registry.
 */
function buildSystemPrompt(
  role: "builder" | "reviewer" | "qa",
  genotype: Genotype,
): string {
  switch (role) {
    case "builder":
      return [
        "You are a builder agent. Your job is to implement the task described in NIGHT-TASK.md.",
        "Work in the current directory. Make your changes, ensure they compile (tsc --noEmit), and commit.",
        `Prompt variant: ${genotype.prompt_policy.builder_system}`,
        `Budget: max $${genotype.budget.max_cost_per_task_usd} per task.`,
        `Max files: ${genotype.permissions.max_files_per_task}.`,
      ].join("\n");

    case "reviewer":
      return [
        "You are a code reviewer agent. Review the git diff in this worktree.",
        "Run: git diff HEAD~1 (or git diff if uncommitted changes)",
        "Evaluate code quality, correctness, test coverage, and conventions.",
        "At the end of your review, output exactly one line: SCORE: N",
        "where N is 0-100 (0=terrible, 50=acceptable, 80=good, 100=excellent).",
        `Prompt variant: ${genotype.prompt_policy.reviewer_system}`,
        `Minimum acceptable score: ${genotype.review_strategy.min_review_score}.`,
        genotype.review_strategy.require_cross_model
          ? "Cross-model review is required."
          : "",
      ]
        .filter(Boolean)
        .join("\n");

    case "qa":
      return [
        "You are a QA agent. Verify the builder's work in this worktree.",
        "1. Run the test suite (npm test or equivalent)",
        "2. Run type checking (tsc --noEmit)",
        "3. Check for any obvious regressions",
        "4. Report pass/fail with details",
        `Prompt variant: ${genotype.prompt_policy.qa_system}`,
      ].join("\n");
  }
}

// ─── Pipeline execution ──────────────────────────────────────────────────────

/**
 * Run the full crew pipeline for a single task.
 *
 * Pipeline: builder → reviewer → QA (sequential within a crew)
 * Each role uses the genotype's model routing and prompt policy.
 */
export function runCrewPipeline(
  taskContent: string,
  genotype: Genotype,
  options: PipelineOptions,
): PipelineResult {
  const results: PipelineResult = {
    builder: {
      role: "builder",
      success: false,
      output: "",
      duration_sec: 0,
      cost_usd: 0,
    },
    reviewer: {
      role: "reviewer",
      success: false,
      output: "",
      duration_sec: 0,
      cost_usd: 0,
    },
    qa: {
      role: "qa",
      success: false,
      output: "",
      duration_sec: 0,
      cost_usd: 0,
    },
    total_cost_usd: 0,
    total_duration_sec: 0,
    review_score: undefined,
  };

  const { worktreePath, timeout_sec, activeRoles } = options;

  // Step 1: Builder
  if (activeRoles.includes("builder")) {
    // Write task file for builder
    writeFileSync(join(worktreePath, "NIGHT-TASK.md"), taskContent, "utf-8");

    const builderRoute = genotype.model_routing.builder;
    const builderPrompt = buildSystemPrompt("builder", genotype);
    const builderTools = [...genotype.tool_policy.builder_tools] as string[];
    results.builder = runRole(
      "builder",
      builderRoute,
      builderTools,
      builderPrompt,
      worktreePath,
      timeout_sec,
    );
  }

  // Step 2: Reviewer (only if builder succeeded or produced changes)
  if (activeRoles.includes("reviewer") && results.builder.success) {
    const reviewerRoute = genotype.model_routing.reviewer;
    const reviewerPrompt = buildSystemPrompt("reviewer", genotype);
    // Reviewer uses read-only tools (enforced by genotype.tool_policy.reviewer_tools)
    const reviewerTools = [...genotype.tool_policy.reviewer_tools] as string[];
    results.reviewer = runRole(
      "reviewer",
      reviewerRoute,
      reviewerTools,
      reviewerPrompt,
      worktreePath,
      timeout_sec,
    );

    // Parse review score from reviewer output
    results.review_score = parseScore(results.reviewer.output);
  }

  // Step 3: QA (only if builder succeeded)
  if (activeRoles.includes("qa") && results.builder.success) {
    const qaRoute = genotype.model_routing.qa;
    const qaPrompt = buildSystemPrompt("qa", genotype);
    // QA gets same tools as builder (needs bash for running tests)
    const qaTools = [...genotype.tool_policy.builder_tools] as string[];
    results.qa = runRole(
      "qa",
      qaRoute,
      qaTools,
      qaPrompt,
      worktreePath,
      timeout_sec,
    );
  }

  // Totals
  results.total_cost_usd =
    results.builder.cost_usd + results.reviewer.cost_usd + results.qa.cost_usd;
  results.total_duration_sec =
    results.builder.duration_sec +
    results.reviewer.duration_sec +
    results.qa.duration_sec;

  return results;
}

// ─── Retry constants ────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BACKOFF_SECONDS = [5, 15, 45];
const RATE_LIMIT_PATTERNS = /rate_limit|429|overloaded/i;

function sleepSync(seconds: number): void {
  execSync(`sleep ${seconds}`, { stdio: "ignore" });
}

function isRateLimitError(stderr: string): boolean {
  return RATE_LIMIT_PATTERNS.test(stderr);
}

// ─── Role execution ──────────────────────────────────────────────────────────

function runRole(
  role: "builder" | "reviewer" | "qa",
  route: ModelRoute,
  tools: readonly string[] | undefined,
  systemPrompt: string,
  worktreePath: string,
  timeout_sec: number,
): RoleResult {
  const startTime = Date.now();
  let output = "";
  let success = false;

  const cliFlags = buildClaudeFlags(route, tools);
  const flagStr = cliFlags.length > 0 ? " " + cliFlags.join(" ") : "";

  // Write system prompt to a temp file for the agent
  const promptFile = join(worktreePath, `.factory-${role}-prompt.md`);
  const taskFile =
    role === "builder" ? "NIGHT-TASK.md" : `.factory-${role}-prompt.md`;

  if (role !== "builder") {
    writeFileSync(promptFile, systemPrompt, "utf-8");
  }

  // For builder: pipe NIGHT-TASK.md with system prompt prepended
  // For reviewer/QA: pipe the role-specific prompt
  let cmd: string;
  if (role === "builder") {
    const fullPrompt =
      systemPrompt + "\n\n---\n\n" + readTaskFile(worktreePath);
    writeFileSync(
      join(worktreePath, ".factory-builder-full.md"),
      fullPrompt,
      "utf-8",
    );
    cmd = `cat .factory-builder-full.md | claude -p --dangerously-skip-permissions${flagStr} --output-format json`;
  } else {
    cmd = `cat ${taskFile} | claude -p --dangerously-skip-permissions${flagStr} --output-format json`;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = execSync(cmd, {
        cwd: worktreePath,
        timeout: timeout_sec * 1000,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8" as BufferEncoding,
        env: { ...process.env },
      });

      output = typeof result === "string" ? result : "";
      success = true;
      break;
    } catch (e: unknown) {
      const err = e as {
        killed?: boolean;
        code?: string | number;
        stdout?: string;
        stderr?: string;
      };
      output = err.stdout ?? "";

      // Timeout — don't retry
      if (err.killed) {
        success = false;
        break;
      }

      // Exit code 0 means success despite throw (e.g. stderr output)
      if (err.code === 0 || err.code === "0") {
        success = true;
        break;
      }

      // Rate limit — retry with backoff
      const stderr = err.stderr ?? "";
      if (attempt < MAX_RETRIES && isRateLimitError(stderr)) {
        const delaySec = BACKOFF_SECONDS[attempt] ?? 45;
        console.error(
          `Rate limited on ${role} agent, retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        sleepSync(delaySec);
        continue;
      }

      // Non-retryable error
      success = false;
      break;
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const costUsd = estimateCost(output, durationSec, route);

  // Clean up temp files
  try {
    const cleanups = [`.factory-${role}-prompt.md`, ".factory-builder-full.md"];
    for (const f of cleanups) {
      const p = join(worktreePath, f);
      if (existsSync(p)) {
        execSync(`rm -f "${p}"`, { cwd: worktreePath, stdio: "ignore" });
      }
    }
  } catch {
    /* ignore cleanup errors */
  }

  return {
    role,
    success,
    output,
    duration_sec: durationSec,
    cost_usd: costUsd,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readTaskFile(worktreePath: string): string {
  const taskPath = join(worktreePath, "NIGHT-TASK.md");
  if (existsSync(taskPath)) {
    return readFileSync(taskPath, "utf-8");
  }
  return "";
}

function parseScore(output: string): number | undefined {
  const match = output.match(/SCORE:\s*(\d+)/i);
  if (!match?.[1]) return undefined;
  const score = parseInt(match[1], 10);
  if (score < 0 || score > 100) return undefined;
  return score;
}

function estimateCost(
  output: string,
  durationSec: number,
  route: ModelRoute,
): number {
  // Try to parse cost from JSON output
  try {
    const parsed = JSON.parse(output) as { cost_usd?: number };
    if (typeof parsed.cost_usd === "number") return parsed.cost_usd;
  } catch {
    /* not JSON */
  }

  // Cost estimate by model tier
  const minutes = durationSec / 60;
  const costPerMin = route.model.includes("opus")
    ? 0.1
    : route.model.includes("haiku")
      ? 0.005
      : 0.02; // sonnet default

  return Math.round(minutes * costPerMin * 100) / 100;
}
