/**
 * features.ts — 44-feature inventory from Claude Code source intelligence
 *
 * Each feature catalogued from the March 2026 npm sourcemap leak.
 * Status: activatable (env var), approximatable (we build it),
 *         compile_time (locked), shipped (officially available).
 */

import type { Feature } from "./types.js";

export const FEATURE_INVENTORY: Feature[] = [
  // ── Activatable Today (env var) ───────────────────────────────────────────
  {
    id: "coordinator",
    codename: "Coordinator",
    name: "Coordinator Mode",
    description:
      "Multi-agent orchestration. One Claude spawns and directs parallel workers.",
    status: "activatable",
    env_var: "CLAUDE_CODE_COORDINATOR_MODE=1",
    prerequisites: ["task_tools_available", "worktree_support"],
    confidence: "verified",
  },
  {
    id: "undercover",
    codename: "Undercover",
    name: "Undercover Mode",
    description: "Strips AI identifiers from commits and PRs.",
    status: "activatable",
    env_var: "CLAUDE_CODE_UNDERCOVER=1",
    prerequisites: [],
    confidence: "verified",
  },
  {
    id: "disable_anti_distillation",
    codename: "Anti-Distillation",
    name: "Disable Anti-Distillation",
    description:
      "Disables fake tool injection that poisons competitor training data.",
    status: "activatable",
    env_var: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1",
    prerequisites: [],
    confidence: "verified",
  },
  {
    id: "disable_attestation",
    codename: "Attestation",
    name: "Disable Client Attestation",
    description: "Disables the cch hash header that verifies official binary.",
    status: "activatable",
    env_var: "CLAUDE_CODE_ATTRIBUTION_HEADER=0",
    prerequisites: [],
    confidence: "verified",
  },

  // ── Approximatable (we can build) ─────────────────────────────────────────
  {
    id: "kairos",
    codename: "KAIROS",
    name: "Always-On Background Agent",
    description:
      "Daemon-mode agent that works while you're idle. Checks PRs, CI, issues.",
    status: "approximatable",
    prerequisites: [
      "sandbox_enabled",
      "pretooluse_hook",
      "deny_rules_exist",
      "safe_permission_mode",
    ],
    confidence: "inferred",
  },
  {
    id: "autodream",
    codename: "autoDream",
    name: "Memory Consolidation",
    description:
      "4-phase algorithm: Orient, Gather, Consolidate, Prune. Keeps MEMORY.md healthy.",
    status: "approximatable",
    prerequisites: ["memory_exists", "auto_memory_enabled"],
    confidence: "inferred",
  },
  {
    id: "coordinator_orchestration",
    codename: "Coordinator+",
    name: "Multi-Agent Task Orchestration",
    description:
      "Parallel workers with worktree isolation and task distribution templates.",
    status: "approximatable",
    prerequisites: ["coordinator_mode_enabled", "worktree_support"],
    confidence: "inferred",
  },

  // ── Compile-Time Only (prepare, cannot activate) ──────────────────────────
  {
    id: "kairos_native",
    codename: "KAIROS",
    name: "KAIROS (Official)",
    description:
      "Native daemon with 15s blocking budget, daily logs, webhook subscriptions.",
    status: "compile_time",
    prerequisites: ["sandbox_enabled", "pretooluse_hook", "deny_rules_exist"],
    confidence: "inferred",
  },
  {
    id: "buddy",
    codename: "BUDDY",
    name: "Terminal Pet",
    description:
      "Tamagotchi-style pet. 18 species, rarity tiers, 5 stats. April launch window.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "ultraplan",
    codename: "ULTRAPLAN",
    name: "Cloud Compute Planning",
    description:
      "Offloads planning to remote Opus container. 30-minute thinking window.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "voice_mode",
    codename: "VOICE_MODE",
    name: "Voice Mode",
    description: "Push-to-talk voice interface. Fully implemented, gated.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "bridge_mode",
    codename: "BRIDGE",
    name: "IDE Integration",
    description:
      "JWT-authenticated bidirectional channels for VS Code / JetBrains.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "auto_dream_native",
    codename: "autoDream",
    name: "autoDream (Official)",
    description:
      "Native forked subagent with 3-gate trigger and consolidation lock.",
    status: "compile_time",
    prerequisites: ["memory_exists", "auto_memory_enabled"],
    confidence: "inferred",
  },
  {
    id: "penguin_mode",
    codename: "Penguin",
    name: "Fast Mode (Official)",
    description: "Penguin mode fast output. Already shipped as /fast toggle.",
    status: "shipped",
    prerequisites: [],
    confidence: "verified",
  },
  // Additional compile-time features (less documented, grouped)
  {
    id: "task_budgets",
    codename: "task-budgets",
    name: "Task Budget Limits",
    description: "API beta: budget limits per task. Beta dated 2026-03-13.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "afk_mode",
    codename: "afk-mode",
    name: "AFK Mode",
    description:
      "API beta: away-from-keyboard mode. KAIROS dependency. Beta dated 2026-01-31.",
    status: "compile_time",
    prerequisites: ["sandbox_enabled", "pretooluse_hook"],
    confidence: "inferred",
  },
  {
    id: "advisor_tool",
    codename: "advisor-tool",
    name: "Advisor Tool",
    description: "API beta: advisory tool calling. Beta dated 2026-03-01.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "structured_outputs",
    codename: "structured-outputs",
    name: "Structured Outputs",
    description:
      "API beta: structured output enforcement. Beta dated 2025-12-15.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "advanced_tool_use",
    codename: "advanced-tool-use",
    name: "Advanced Tool Use",
    description:
      "API beta: enhanced tool calling capabilities. Beta dated 2025-11-20.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "redact_thinking",
    codename: "redact-thinking",
    name: "Redact Thinking",
    description:
      "API beta: hide extended thinking from output. Beta dated 2026-02-12.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "prompt_caching_scope",
    codename: "prompt-caching-scope",
    name: "Prompt Caching Scope",
    description: "API beta: scoped prompt caching. Beta dated 2026-01-05.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "interleaved_thinking",
    codename: "interleaved-thinking",
    name: "Interleaved Thinking",
    description:
      "API beta: thinking interleaved with tool use. Beta dated 2025-05-14.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
  {
    id: "context_1m",
    codename: "context-1m",
    name: "1M Context Window",
    description: "API beta: 1 million token context. Beta dated 2025-08-07.",
    status: "shipped",
    prerequisites: [],
    confidence: "verified",
  },
  {
    id: "fast_mode_beta",
    codename: "fast-mode",
    name: "Fast Mode",
    description: "API beta: fast output mode. Beta dated 2026-02-01.",
    status: "shipped",
    prerequisites: [],
    confidence: "verified",
  },
  {
    id: "amber_flint",
    codename: "Amber Flint",
    name: "Team Variant",
    description:
      "Team mode variant with AsyncLocalStorage context isolation + tmux panes.",
    status: "compile_time",
    prerequisites: [],
    confidence: "inferred",
  },
];

/**
 * Get features by status category.
 */
export function featuresByStatus(status: Feature["status"]): Feature[] {
  return FEATURE_INVENTORY.filter((f) => f.status === status);
}

/**
 * Get all prerequisite IDs referenced across features.
 */
export function allPrerequisites(): string[] {
  const set = new Set<string>();
  for (const f of FEATURE_INVENTORY) {
    for (const p of f.prerequisites) {
      set.add(p);
    }
  }
  return [...set];
}

/**
 * Count features in each status category.
 */
export function featureCounts(): Record<Feature["status"], number> {
  const counts = {
    activatable: 0,
    approximatable: 0,
    compile_time: 0,
    shipped: 0,
  };
  for (const f of FEATURE_INVENTORY) {
    counts[f.status]++;
  }
  return counts;
}
