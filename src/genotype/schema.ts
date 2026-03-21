/**
 * schema.ts — DeFactory Genotype Schema
 *
 * Typed schema for a genotype YAML document. A genotype is the "organism" under
 * evolution: one complete agent-company configuration that can be mutated,
 * scored, and promoted. Sourced directly from BIBLE.md section "The Genotype".
 *
 * IMMUTABLE GENES are marked with the `Immutable` type brand. Mutation operators
 * MUST NOT target these fields (enforced by mutate.ts).
 */

// ─── Brands ───────────────────────────────────────────────────────────────────

/** Marks a value as immutable — mutation operators must not target these genes. */
type Immutable<T> = T & { readonly __immutable: unique symbol };

// ─── Model Routing ────────────────────────────────────────────────────────────

/** Claude model IDs available in the factory. */
export type ClaudeModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";

/** OpenAI / Codex model IDs available in the factory. */
export type CodexModel =
  | "gpt-5.4"
  | "gpt-5.4-pro"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "gpt-5.3-codex"
  | "gpt-5.3-codex-spark"
  | "gpt-5.2";

/** Google / Gemini model IDs available in the factory. */
export type GeminiModel =
  | "gemini-3.1-pro-preview"
  | "gemini-3-flash-preview"
  | "gemini-3.1-flash-lite-preview";

export type AnyModel = ClaudeModel | CodexModel | GeminiModel;

/** Effort levels for claude_local adapter. */
export type ClaudeEffort = "low" | "medium" | "high" | "max";

/** Reasoning effort levels for codex_local adapter. */
export type CodexReasoning = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Model routing config for one agent role. */
export interface ModelRoute {
  model: AnyModel;
  /** Effort level (claude_local only). */
  effort?: ClaudeEffort;
  /** Reasoning effort (codex_local only). */
  reasoning?: CodexReasoning;
}

/**
 * Model routing table for the full agent roster.
 *
 * Immutable roles (CEO, CTO, Memory Curator, Auditor, Strategist) are locked
 * by policy.yml and must never appear in mutation operator targets.
 */
export interface ModelRouting {
  /** IMMUTABLE — strategic decisions require deepest reasoning */
  ceo: Immutable<ModelRoute>;
  /** IMMUTABLE — architecture judgment needs depth, not speed */
  cto: Immutable<ModelRoute>;
  /** MUTABLE — champion lane code implementation */
  builder: ModelRoute;
  /** MUTABLE — cross-model adversarial review */
  reviewer: ModelRoute;
  /** MUTABLE — test execution, tool use */
  qa: ModelRoute;
  /** MUTABLE — mutation experiments */
  explorer: ModelRoute;
  /** MUTABLE — score computation */
  evaluator: ModelRoute;
  /** IMMUTABLE — convention judgment requires strong reasoning */
  memory_curator: Immutable<ModelRoute>;
  /** IMMUTABLE — existential questions need deepest reasoning */
  auditor: Immutable<ModelRoute>;
  /** MUTABLE — quantitative analysis */
  analyst: ModelRoute;
  /** MUTABLE — adversarial red-teaming */
  critic: ModelRoute;
  /** IMMUTABLE — long-term thinking */
  strategist: Immutable<ModelRoute>;
}

// ─── Prompt Policy ────────────────────────────────────────────────────────────

/**
 * References to prompt variant files (SHA256 or version string).
 * These are mutable: swap_prompt operator can change them.
 */
export interface PromptPolicy {
  /** System prompt variant for Builder agent */
  builder_system: string;
  /** System prompt variant for Reviewer agent */
  reviewer_system: string;
  /** System prompt variant for QA agent */
  qa_system: string;
}

// ─── Tool Policy ──────────────────────────────────────────────────────────────

/** Available tool names that can be granted to agents. */
export type ToolName = "read" | "edit" | "bash" | "glob" | "grep" | "write";

export interface ToolPolicy {
  /** MUTABLE — tools available to Builder agents */
  builder_tools: ToolName[];
  /** IMMUTABLE — reviewer must remain read-only to preserve evaluator integrity */
  reviewer_tools: Immutable<ToolName[]>;
}

// ─── Cadence ──────────────────────────────────────────────────────────────────

/**
 * Heartbeat intervals in minutes. All are MUTABLE within policy bounds:
 *   explorer_batch_interval_min: [30, 180]
 *   evaluator_interval_min: [30, 120]
 *   memory_curator_interval_min: [60, 360]
 *   audit_interval_min: [120, 480]
 */
export interface Cadence {
  explorer_batch_interval_min: number;
  evaluator_interval_min: number;
  memory_curator_interval_min: number;
  audit_interval_min: number;
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export interface Permissions {
  /** MUTABLE — whether safe PRs auto-merge without human review */
  auto_merge_safe: boolean;
  /** MUTABLE — max files a single task can touch (bounds: [1, 10]) */
  max_files_per_task: number;
  /** IMMUTABLE — hard cap on commits per sprint */
  max_commits_per_sprint: Immutable<30>;
}

// ─── Memory Retrieval ─────────────────────────────────────────────────────────

export interface MemoryRetrieval {
  /** MUTABLE — max conventions injected per context window (bounds: [5, 50]) */
  max_conventions_in_context: number;
  /** MUTABLE — TTL for memory entries in days (bounds: [7, 90]) */
  memory_decay_days: number;
  /** MUTABLE — whether agents inherit conventions from other repos */
  cross_repo_inheritance: boolean;
}

// ─── Review Strategy ─────────────────────────────────────────────────────────

export interface ReviewStrategy {
  /** MUTABLE — whether cross-model review is required */
  require_cross_model: boolean;
  /** MUTABLE — minimum acceptable review score (bounds: [60, 100]) */
  min_review_score: number;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface Budget {
  /** MUTABLE — maximum cost per task in USD (bounds: [0.50, 5.00]) */
  max_cost_per_task_usd: number;
  /** MUTABLE — maximum cost per evolution round in USD (bounds: [5.00, 50.00]) */
  max_cost_per_round_usd: number;
}

// ─── Genotype Status ─────────────────────────────────────────────────────────

export type GenotypeStatus =
  | "active" // created, not yet evaluated
  | "frontier" // passed Layer 1, admitted to archive
  | "champion" // current production config
  | "cemetery"; // rejected, with causal notes

// ─── Root Genotype ────────────────────────────────────────────────────────────

/**
 * A genotype is the complete agent-company configuration under evolution.
 * One champion exists at a time. Explorers produce candidates by mutating
 * exactly one gene from the champion.
 */
export interface Genotype {
  /** Schema version. Currently 1. */
  version: 1;
  /** Unique identifier, format "gen-NNNN" */
  id: string;
  /** Parent genotype ID, or null for the seed (gen-0000). */
  parent_id: string | null;
  /** ISO 8601 creation timestamp */
  created_at: string;

  model_routing: ModelRouting;
  prompt_policy: PromptPolicy;
  tool_policy: ToolPolicy;
  cadence: Cadence;
  permissions: Permissions;
  memory_retrieval: MemoryRetrieval;
  review_strategy: ReviewStrategy;
  budget: Budget;
}

// ─── Champion Seed (gen-0000) ─────────────────────────────────────────────────

/**
 * The baseline genotype derived from BIBLE.md values.
 * Seeded in evo.db as the first champion (generation 0).
 */
export const SEED_GENOTYPE: Genotype = {
  version: 1,
  id: "gen-0000",
  parent_id: null,
  created_at: "2026-03-20T00:00:00Z",

  model_routing: {
    ceo: { model: "claude-opus-4-6", effort: "max" } as Immutable<ModelRoute>,
    cto: { model: "claude-opus-4-6", effort: "high" } as Immutable<ModelRoute>,
    builder: { model: "claude-sonnet-4-6" },
    reviewer: { model: "gpt-5.3-codex", reasoning: "xhigh" },
    qa: { model: "claude-sonnet-4-6" },
    explorer: { model: "claude-sonnet-4-6" },
    evaluator: { model: "claude-sonnet-4-6" },
    memory_curator: {
      model: "claude-opus-4-6",
      effort: "high",
    } as Immutable<ModelRoute>,
    auditor: {
      model: "claude-opus-4-6",
      effort: "max",
    } as Immutable<ModelRoute>,
    analyst: { model: "gpt-5.4", reasoning: "xhigh" },
    critic: { model: "gpt-5.3-codex", reasoning: "xhigh" },
    strategist: {
      model: "claude-opus-4-6",
      effort: "max",
    } as Immutable<ModelRoute>,
  },

  prompt_policy: {
    builder_system: "default-v1",
    reviewer_system: "default-v1",
    qa_system: "default-v1",
  },

  tool_policy: {
    builder_tools: ["read", "edit", "bash", "glob", "grep"],
    reviewer_tools: ["read", "grep", "glob"] as Immutable<ToolName[]>,
  },

  cadence: {
    explorer_batch_interval_min: 60,
    evaluator_interval_min: 60,
    memory_curator_interval_min: 120,
    audit_interval_min: 240,
  },

  permissions: {
    auto_merge_safe: true,
    max_files_per_task: 5,
    max_commits_per_sprint: 30 as Immutable<30>,
  },

  memory_retrieval: {
    max_conventions_in_context: 20,
    memory_decay_days: 30,
    cross_repo_inheritance: true,
  },

  review_strategy: {
    require_cross_model: true,
    min_review_score: 80,
  },

  budget: {
    max_cost_per_task_usd: 2.0,
    max_cost_per_round_usd: 20.0,
  },
};

// ─── Mutation Bounds (enforced by mutate.ts) ──────────────────────────────────

/** Numeric bounds for mutable threshold genes. */
export const MUTATION_BOUNDS = {
  "cadence.explorer_batch_interval_min": [30, 180] as const,
  "cadence.evaluator_interval_min": [30, 120] as const,
  "cadence.memory_curator_interval_min": [60, 360] as const,
  "cadence.audit_interval_min": [120, 480] as const,
  "review_strategy.min_review_score": [60, 100] as const,
  "memory_retrieval.max_conventions_in_context": [5, 50] as const,
  "memory_retrieval.memory_decay_days": [7, 90] as const,
  "permissions.max_files_per_task": [1, 10] as const,
  "budget.max_cost_per_task_usd": [0.5, 5.0] as const,
  "budget.max_cost_per_round_usd": [5.0, 50.0] as const,
} as const;

/** Gene paths that can NEVER be targeted by mutation operators. */
export const IMMUTABLE_GENES = new Set<string>([
  "permissions.max_commits_per_sprint",
  "tool_policy.reviewer_tools",
  "model_routing.ceo",
  "model_routing.cto",
  "model_routing.memory_curator",
  "model_routing.auditor",
  "model_routing.strategist",
]);

/** Mutable model routing roles. */
export const MUTABLE_MODEL_ROLES = [
  "builder",
  "reviewer",
  "qa",
  "explorer",
  "evaluator",
  "analyst",
  "critic",
] as const;

export type MutableModelRole = (typeof MUTABLE_MODEL_ROLES)[number];

/** Mutable prompt policy keys. */
export const MUTABLE_PROMPT_KEYS = [
  "builder_system",
  "reviewer_system",
  "qa_system",
] as const;

export type MutablePromptKey = (typeof MUTABLE_PROMPT_KEYS)[number];

// ─── Validation ───────────────────────────────────────────────────────────────

/** Validation result for a genotype. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a genotype against the policy contract.
 * Returns { valid: true, errors: [] } if all checks pass.
 */
export function validateGenotype(g: unknown): ValidationResult {
  const errors: string[] = [];

  if (!g || typeof g !== "object") {
    return { valid: false, errors: ["Genotype must be an object"] };
  }

  const gt = g as Record<string, unknown>;

  // Version check
  if (gt["version"] !== 1) {
    errors.push(`version must be 1, got: ${gt["version"]}`);
  }

  // ID format check
  if (typeof gt["id"] !== "string" || !/^gen-\d{4}$/.test(gt["id"])) {
    errors.push(`id must match gen-NNNN, got: ${gt["id"]}`);
  }

  // parent_id
  if (gt["parent_id"] !== null && typeof gt["parent_id"] !== "string") {
    errors.push(`parent_id must be string or null`);
  }

  // created_at ISO 8601
  if (
    typeof gt["created_at"] !== "string" ||
    isNaN(Date.parse(gt["created_at"]))
  ) {
    errors.push(`created_at must be a valid ISO 8601 date string`);
  }

  // model_routing presence
  if (!gt["model_routing"] || typeof gt["model_routing"] !== "object") {
    errors.push("model_routing is required and must be an object");
  } else {
    const mr = gt["model_routing"] as Record<string, unknown>;
    const requiredRoles = [
      "ceo",
      "cto",
      "builder",
      "reviewer",
      "qa",
      "explorer",
      "evaluator",
      "memory_curator",
      "auditor",
      "analyst",
      "critic",
      "strategist",
    ];
    for (const role of requiredRoles) {
      if (!mr[role]) errors.push(`model_routing.${role} is required`);
    }
  }

  // Cadence bounds
  const cadence = gt["cadence"] as Record<string, number> | undefined;
  if (cadence) {
    for (const [key, [lo, hi]] of Object.entries(MUTATION_BOUNDS)) {
      if (!key.startsWith("cadence.")) continue;
      const field = key.replace("cadence.", "");
      const val = cadence[field];
      if (val !== undefined && (val < lo || val > hi)) {
        errors.push(`${key} must be in [${lo}, ${hi}], got: ${val}`);
      }
    }
  }

  // max_commits_per_sprint must be exactly 30
  const perms = gt["permissions"] as Record<string, unknown> | undefined;
  if (perms && perms["max_commits_per_sprint"] !== 30) {
    errors.push(
      `permissions.max_commits_per_sprint must be 30 (immutable), got: ${perms["max_commits_per_sprint"]}`,
    );
  }

  return { valid: errors.length === 0, errors };
}
