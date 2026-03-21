/**
 * mutate.ts — DeFactory Mutation Operators
 *
 * Applies exactly ONE mutation to a champion genotype, producing a new
 * candidate. Six weighted operators per BIBLE.md. Immutable genes are
 * enforced at runtime — any mutation targeting them throws.
 *
 * Rule: mutate exactly one gene per generation. Never mutate evaluator
 * or safety gates (enforced by IMMUTABLE_GENES set).
 */

import {
  type AnyModel,
  type ClaudeEffort,
  type CodexReasoning,
  type Genotype,
  type MutableModelRole,
  type MutablePromptKey,
  IMMUTABLE_GENES,
  MUTABLE_MODEL_ROLES,
  MUTABLE_PROMPT_KEYS,
  MUTATION_BOUNDS,
  validateGenotype,
} from "./schema.js";

// ─── Operator types ───────────────────────────────────────────────────────────

export type OperatorName =
  | "swap_model"
  | "tweak_cadence"
  | "swap_prompt"
  | "adjust_threshold"
  | "toggle_policy"
  | "adjust_budget";

export interface MutationDiff {
  /** The dotted gene path that was changed, e.g. "model_routing.builder" */
  gene: string;
  from: unknown;
  to: unknown;
}

export interface MutationManifest {
  parent_id: string;
  child_id: string;
  operator: OperatorName;
  /** High-risk mutations (swap_model, swap_prompt) require larger sample sizes */
  high_risk: boolean;
  diff: MutationDiff;
  created_at: string;
}

export interface MutationResult {
  genotype: Genotype;
  manifest: MutationManifest;
}

// ─── Operator definitions ─────────────────────────────────────────────────────

interface OperatorDef {
  name: OperatorName;
  /** Relative selection weight. Must sum to 1.0 across all operators. */
  weight: number;
  high_risk: boolean;
  apply(g: Genotype, rng: Rng): MutationDiff;
}

// Available models per role type (mirrors BIBLE.md model tiers)
const CLAUDE_MODELS: AnyModel[] = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];
const CODEX_MODELS: AnyModel[] = ["gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini"];

// Default effort for each model family
function defaultEffort(model: AnyModel): ClaudeEffort | undefined {
  if (model.startsWith("claude-opus")) return "max";
  if (model.startsWith("claude-sonnet")) return undefined;
  return undefined;
}

function defaultReasoning(model: AnyModel): CodexReasoning | undefined {
  if (model.startsWith("gpt-5.3-codex")) return "xhigh";
  if (model.startsWith("gpt-5.4")) return "high";
  return undefined;
}

const OPERATORS: OperatorDef[] = [
  {
    name: "swap_model",
    weight: 0.25,
    high_risk: true,
    apply(g, rng) {
      const role = rng.choice([...MUTABLE_MODEL_ROLES]) as MutableModelRole;
      const current = g.model_routing[role].model;

      // Mix Claude and Codex pools for diversity, never return same model
      const pool: AnyModel[] = [...CLAUDE_MODELS, ...CODEX_MODELS].filter(
        (m) => m !== current,
      );
      const next = rng.choice(pool);

      const nextRoute = {
        model: next,
        ...(next.startsWith("claude") && defaultEffort(next)
          ? { effort: defaultEffort(next) }
          : {}),
        ...(!next.startsWith("claude") && defaultReasoning(next)
          ? { reasoning: defaultReasoning(next) }
          : {}),
      };

      // Apply — double cast through unknown to satisfy strict type check
      (g.model_routing as unknown as Record<string, unknown>)[role] = nextRoute;

      return { gene: `model_routing.${role}`, from: current, to: next };
    },
  },

  {
    name: "tweak_cadence",
    weight: 0.2,
    high_risk: false,
    apply(g, rng) {
      type CadenceKey =
        | "explorer_batch_interval_min"
        | "evaluator_interval_min"
        | "memory_curator_interval_min"
        | "audit_interval_min";

      const key = rng.choice<CadenceKey>([
        "explorer_batch_interval_min",
        "evaluator_interval_min",
        "memory_curator_interval_min",
        "audit_interval_min",
      ]);

      const boundsKey = `cadence.${key}` as keyof typeof MUTATION_BOUNDS;
      const [lo, hi] = MUTATION_BOUNDS[boundsKey];
      const current = g.cadence[key];
      const delta = Math.round(current * 0.25) * (rng.flip() ? 1 : -1);
      const next = Math.round(Math.max(lo, Math.min(hi, current + delta)));

      g.cadence[key] = next;

      return { gene: `cadence.${key}`, from: current, to: next };
    },
  },

  {
    name: "swap_prompt",
    weight: 0.2,
    high_risk: true,
    apply(g, rng) {
      const key = rng.choice([...MUTABLE_PROMPT_KEYS]) as MutablePromptKey;
      const current = g.prompt_policy[key];
      // Bump the version number
      const version = parseInt(current.replace(/[^0-9]/g, "") || "1", 10);
      const next = `default-v${version + 1}`;
      g.prompt_policy[key] = next;

      return { gene: `prompt_policy.${key}`, from: current, to: next };
    },
  },

  {
    name: "adjust_threshold",
    weight: 0.15,
    high_risk: false,
    apply(g, rng) {
      type ThresholdTarget =
        | "review_strategy.min_review_score"
        | "memory_retrieval.max_conventions_in_context"
        | "memory_retrieval.memory_decay_days"
        | "permissions.max_files_per_task";

      const key = rng.choice<ThresholdTarget>([
        "review_strategy.min_review_score",
        "memory_retrieval.max_conventions_in_context",
        "memory_retrieval.memory_decay_days",
        "permissions.max_files_per_task",
      ]);

      const [lo, hi] = MUTATION_BOUNDS[key as keyof typeof MUTATION_BOUNDS];

      // Determine step: 5 for scores, 7 for days, 5 for counts, 1 for files
      const step =
        key === "memory_retrieval.memory_decay_days"
          ? 7
          : key === "review_strategy.min_review_score"
            ? 5
            : key === "memory_retrieval.max_conventions_in_context"
              ? 5
              : 1;

      const [section, field] = key.split(".") as [keyof Genotype, string];
      const obj = g[section] as unknown as Record<string, number>;
      const current = obj[field] as number;
      const delta = step * (rng.flip() ? 1 : -1);
      const next = Math.round(Math.max(lo, Math.min(hi, current + delta)));
      obj[field] = next;

      return { gene: key, from: current, to: next };
    },
  },

  {
    name: "toggle_policy",
    weight: 0.1,
    high_risk: false,
    apply(g, rng) {
      type ToggleTarget =
        | "review_strategy.require_cross_model"
        | "permissions.auto_merge_safe"
        | "memory_retrieval.cross_repo_inheritance";

      const key = rng.choice<ToggleTarget>([
        "review_strategy.require_cross_model",
        "permissions.auto_merge_safe",
        "memory_retrieval.cross_repo_inheritance",
      ]);

      const [section, field] = key.split(".") as [keyof Genotype, string];
      const obj = g[section] as unknown as Record<string, boolean>;
      const current = obj[field] as boolean;
      obj[field] = !current;

      return { gene: key, from: current, to: !current };
    },
  },

  {
    name: "adjust_budget",
    weight: 0.1,
    high_risk: false,
    apply(g, rng) {
      type BudgetTarget =
        | "budget.max_cost_per_task_usd"
        | "budget.max_cost_per_round_usd";

      const key = rng.choice<BudgetTarget>([
        "budget.max_cost_per_task_usd",
        "budget.max_cost_per_round_usd",
      ]);

      const [lo, hi] = MUTATION_BOUNDS[key];
      const step = key === "budget.max_cost_per_task_usd" ? 0.25 : 2.5;

      const field = key.replace("budget.", "") as keyof typeof g.budget;
      const current = g.budget[field];
      const delta = step * (rng.flip() ? 1 : -1);
      const next =
        Math.round(Math.max(lo, Math.min(hi, current + delta)) * 100) / 100;
      (g.budget as unknown as Record<string, number>)[field] = next;

      return { gene: key, from: current, to: next };
    },
  },
];

// Validate weights sum to ~1.0
const totalWeight = OPERATORS.reduce((s, o) => s + o.weight, 0);
if (Math.abs(totalWeight - 1.0) > 0.001) {
  throw new Error(`Operator weights must sum to 1.0, got ${totalWeight}`);
}

// ─── Random number generator ──────────────────────────────────────────────────

class Rng {
  private _rand: () => number;

  constructor(seed?: number) {
    if (seed !== undefined) {
      // Deterministic mulberry32 for testing
      this._rand = this._mulberry32(seed);
    } else {
      this._rand = Math.random;
    }
  }

  private _mulberry32(seed: number): () => number {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  float(): number {
    return this._rand();
  }

  /** Flip a fair coin. */
  flip(): boolean {
    return this._rand() < 0.5;
  }

  /** Random element from array. Throws if array is empty. */
  choice<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Cannot choose from empty array");
    return arr[Math.floor(this._rand() * arr.length)] as T;
  }

  /** Weighted random selection from operators. */
  weightedChoice(ops: OperatorDef[]): OperatorDef {
    const total = ops.reduce((s, o) => s + o.weight, 0);
    let r = this._rand() * total;
    for (const op of ops) {
      r -= op.weight;
      if (r <= 0) return op;
    }
    return ops[ops.length - 1] as OperatorDef;
  }
}

// ─── Genotype ID helpers ──────────────────────────────────────────────────────

function nextGenotypeId(parentId: string): string {
  const match = parentId.match(/^gen-(\d+)$/);
  if (!match || match[1] === undefined) {
    throw new Error(`Invalid parent genotype ID format: ${parentId}`);
  }
  const num = parseInt(match[1], 10) + 1;
  return `gen-${String(num).padStart(4, "0")}`;
}

// ─── Deep clone ───────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ─── Main mutate function ─────────────────────────────────────────────────────

/**
 * Apply exactly one mutation to a champion genotype.
 *
 * @param champion - The current champion genotype (will NOT be modified)
 * @param options.operatorName - Force a specific operator (for testing)
 * @param options.seed - Deterministic RNG seed (for testing)
 * @returns MutationResult with new genotype and manifest
 * @throws If the mutation targets an immutable gene
 */
export function mutate(
  champion: Genotype,
  options: { operatorName?: OperatorName; seed?: number } = {},
): MutationResult {
  // Validate champion
  const validation = validateGenotype(champion);
  if (!validation.valid) {
    throw new Error(
      `Invalid champion genotype: ${validation.errors.join("; ")}`,
    );
  }

  const rng = new Rng(options.seed);

  // Select operator
  let operator: OperatorDef;
  if (options.operatorName) {
    const found = OPERATORS.find((o) => o.name === options.operatorName);
    if (!found) {
      throw new Error(`Unknown operator: ${options.operatorName}`);
    }
    operator = found;
  } else {
    operator = rng.weightedChoice(OPERATORS);
  }

  // Deep clone to avoid mutating champion
  const mutated = deepClone(champion);
  mutated.id = nextGenotypeId(champion.id);
  mutated.parent_id = champion.id;
  mutated.created_at = new Date().toISOString();

  // Apply the mutation
  const diff = operator.apply(mutated, rng);

  // Safety check: verify the mutated gene is not forbidden
  if (IMMUTABLE_GENES.has(diff.gene)) {
    throw new Error(
      `Operator ${operator.name} attempted to mutate immutable gene: ${diff.gene}`,
    );
  }

  // Validate result
  const resultValidation = validateGenotype(mutated);
  if (!resultValidation.valid) {
    throw new Error(
      `Mutation produced invalid genotype: ${resultValidation.errors.join("; ")}`,
    );
  }

  const manifest: MutationManifest = {
    parent_id: champion.id,
    child_id: mutated.id,
    operator: operator.name,
    high_risk: operator.high_risk,
    diff,
    created_at: mutated.created_at,
  };

  return { genotype: mutated, manifest };
}

/**
 * List all operators with their weights.
 * Useful for CLI --list-operators output.
 */
export function listOperators(): Array<{
  name: OperatorName;
  weight: number;
  high_risk: boolean;
}> {
  return OPERATORS.map(({ name, weight, high_risk }) => ({
    name,
    weight,
    high_risk,
  }));
}
