#!/usr/bin/env node
// mutate.js — DeFactory Mutation Engine
//
// Applies exactly ONE mutation to a champion genotype, producing a new candidate.
// Rule: mutate exactly one gene per generation (BIBLE.md).
// Forbidden targets (from policy.yml) are enforced here.
//
// Usage:
//   node mutate.js --input <genotype-yaml-file> [--operator <op>] [--seed <int>]
//   echo '<yaml>' | node mutate.js [--operator swap_model]
//
// Output:
//   Writes the mutated genotype YAML to stdout + a mutation manifest JSON to stderr.

"use strict";

const { execSync } = require("child_process");

// ─── Operator definitions (mirror policy.yml mutation_operators) ──────────────
// IMMUTABLE: Do not change weights or add/remove operators without board approval.
const OPERATORS = [
  {
    name: "swap_model",
    weight: 0.25,
    high_risk: true,
    apply(genotype) {
      const MODELS = [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
        "codex-xhigh",
      ];
      const MUTABLE_ROLES = ["builder", "reviewer", "qa", "explorer"];
      const role = randomChoice(MUTABLE_ROLES);
      const current = genotype.model_routing[role];
      const candidates = MODELS.filter((m) => m !== current);
      genotype.model_routing[role] = randomChoice(candidates);
      return {
        gene: `model_routing.${role}`,
        from: current,
        to: genotype.model_routing[role],
      };
    },
  },
  {
    name: "tweak_cadence",
    weight: 0.2,
    high_risk: false,
    apply(genotype) {
      const BOUNDS = {
        explorer_batch_interval_min: [30, 180],
        evaluator_interval_min: [30, 120],
        memory_curator_interval_min: [60, 360],
        audit_interval_min: [120, 480],
      };
      const key = randomChoice(Object.keys(BOUNDS));
      const current = genotype.cadence[key];
      // Adjust by +/- 25%, then clamp to bounds
      const delta = current * 0.25 * (Math.random() < 0.5 ? 1 : -1);
      const [lo, hi] = BOUNDS[key];
      const next = Math.round(Math.max(lo, Math.min(hi, current + delta)));
      genotype.cadence[key] = next;
      return { gene: `cadence.${key}`, from: current, to: next };
    },
  },
  {
    name: "swap_prompt",
    weight: 0.2,
    high_risk: true,
    apply(genotype) {
      const MUTABLE_PROMPTS = [
        "builder_system",
        "reviewer_system",
        "qa_system",
      ];
      const key = randomChoice(MUTABLE_PROMPTS);
      const current = genotype.prompt_policy[key];
      // Prompt versions: bump version number or swap variant suffix
      const version = parseInt(current.replace(/[^0-9]/g, "") || "1", 10);
      const next = `default-v${version + 1}`;
      genotype.prompt_policy[key] = next;
      return { gene: `prompt_policy.${key}`, from: current, to: next };
    },
  },
  {
    name: "adjust_threshold",
    weight: 0.15,
    high_risk: false,
    apply(genotype) {
      const TARGETS = [
        {
          path: ["review_strategy", "min_review_score"],
          bounds: [60, 100],
          step: 5,
          integer: true,
        },
        {
          path: ["memory_retrieval", "max_conventions_in_context"],
          bounds: [5, 50],
          step: 5,
          integer: true,
        },
        {
          path: ["memory_retrieval", "memory_decay_days"],
          bounds: [7, 90],
          step: 7,
          integer: true,
        },
      ];
      const target = randomChoice(TARGETS);
      const { path, bounds, step, integer } = target;
      let obj = genotype;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      const key = path[path.length - 1];
      const current = obj[key];
      const delta = step * (Math.random() < 0.5 ? 1 : -1);
      let next = current + delta;
      next = Math.max(bounds[0], Math.min(bounds[1], next));
      if (integer) next = Math.round(next);
      obj[key] = next;
      return { gene: path.join("."), from: current, to: next };
    },
  },
  {
    name: "toggle_policy",
    weight: 0.1,
    high_risk: false,
    apply(genotype) {
      const TARGETS = [
        ["review_strategy", "require_cross_model"],
        ["permissions", "auto_merge_safe"],
        ["memory_retrieval", "cross_repo_inheritance"],
      ];
      const path = randomChoice(TARGETS);
      let obj = genotype;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      const key = path[path.length - 1];
      const current = obj[key];
      obj[key] = !current;
      return { gene: path.join("."), from: current, to: !current };
    },
  },
  {
    name: "adjust_budget",
    weight: 0.1,
    high_risk: false,
    apply(genotype) {
      const TARGETS = [
        {
          path: ["budget", "max_cost_per_task_usd"],
          bounds: [0.5, 5.0],
          step: 0.25,
        },
        {
          path: ["budget", "max_cost_per_round_usd"],
          bounds: [5.0, 50.0],
          step: 2.5,
        },
      ];
      const target = randomChoice(TARGETS);
      const { path, bounds, step } = target;
      let obj = genotype;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      const key = path[path.length - 1];
      const current = obj[key];
      const delta = step * (Math.random() < 0.5 ? 1 : -1);
      const next =
        Math.round(
          Math.max(bounds[0], Math.min(bounds[1], current + delta)) * 100,
        ) / 100;
      obj[key] = next;
      return { gene: path.join("."), from: current, to: next };
    },
  },
];

// ─── Forbidden targets (must match policy.yml forbidden_mutation_targets) ─────
const FORBIDDEN_GENES = new Set([
  "permissions.max_commits_per_sprint",
  "tool_policy.reviewer_tools",
  "evaluator_weights",
  "layer1_params",
  "promotion_thresholds",
  "rollback_triggers",
  "safety_gates",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _seed = null;
function seedRng(s) {
  _seed = s;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _rand = Math.random;

function randomChoice(arr) {
  return arr[Math.floor(_rand() * arr.length)];
}

// Weighted random selection — normalized weights, single draw
function weightedChoice(operators) {
  const total = operators.reduce((s, o) => s + o.weight, 0);
  let r = _rand() * total;
  for (const op of operators) {
    r -= op.weight;
    if (r <= 0) return op;
  }
  return operators[operators.length - 1];
}

// ─── YAML helpers (no external deps) ─────────────────────────────────────────
// Minimal YAML parser/serializer for the genotype schema.
// Only handles the flat-ish structure we actually use.

function parseYaml(text) {
  // Use Node's built-in if available (Node 22+), else regex-based fallback
  try {
    // Try to use js-yaml if installed
    const yaml = require("js-yaml");
    return yaml.load(text);
  } catch (_) {
    // Minimal fallback: parse key: value and nested sections
    return parseYamlFallback(text);
  }
}

function parseYamlFallback(text) {
  const lines = text.split("\n");
  const result = {};
  const stack = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack to correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;

    if (content.includes(":")) {
      const colonIdx = content.indexOf(":");
      const key = content.slice(0, colonIdx).trim();
      const val = content.slice(colonIdx + 1).trim();

      if (val === "" || val === null) {
        // Nested object
        const child = {};
        current[key] = child;
        stack.push({ obj: child, indent });
      } else if (val.startsWith("[")) {
        // Inline array
        current[key] = val
          .slice(1, -1)
          .split(",")
          .map((v) => {
            v = v.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
            return isNaN(v) ? v : Number(v);
          });
      } else if (val === "true") {
        current[key] = true;
      } else if (val === "false") {
        current[key] = false;
      } else if (val === "null") {
        current[key] = null;
      } else if (!isNaN(val)) {
        current[key] = Number(val);
      } else {
        current[key] = val.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      }
    }
  }

  return result;
}

function serializeYaml(obj, indent = 0) {
  const pad = " ".repeat(indent);
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out += `${pad}${k}: null\n`;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      out += `${pad}${k}:\n${serializeYaml(v, indent + 2)}`;
    } else if (Array.isArray(v)) {
      out += `${pad}${k}: [${v.map((i) => (typeof i === "string" ? `"${i}"` : i)).join(", ")}]\n`;
    } else if (typeof v === "string") {
      out += `${pad}${k}: "${v}"\n`;
    } else {
      out += `${pad}${k}: ${v}\n`;
    }
  }
  return out;
}

// ─── Generate new genotype ID ─────────────────────────────────────────────────
function nextGenotypeId(parentId) {
  const num = parseInt(parentId.replace("gen-", ""), 10) + 1;
  return `gen-${String(num).padStart(4, "0")}`;
}

// ─── Main mutation logic ───────────────────────────────────────────────────────
function mutate(genotypeYaml, forcedOperator = null) {
  let genotype;
  try {
    genotype = parseYaml(genotypeYaml);
  } catch (e) {
    throw new Error(`Failed to parse genotype YAML: ${e.message}`);
  }

  // Validate it has an id
  if (!genotype.id) throw new Error("Genotype missing required field: id");

  // Select operator
  let operator;
  if (forcedOperator) {
    operator = OPERATORS.find((o) => o.name === forcedOperator);
    if (!operator) throw new Error(`Unknown operator: ${forcedOperator}`);
  } else {
    operator = weightedChoice(OPERATORS);
  }

  // Deep clone to avoid mutating input
  const mutated = JSON.parse(JSON.stringify(genotype));
  mutated.id = nextGenotypeId(genotype.id);
  mutated.parent_id = genotype.id;
  mutated.created_at = new Date().toISOString();

  // Apply mutation (returns {gene, from, to})
  const diff = operator.apply(mutated);

  // Safety: verify the mutated gene is not forbidden
  if (FORBIDDEN_GENES.has(diff.gene)) {
    throw new Error(
      `Operator ${operator.name} attempted to mutate forbidden gene: ${diff.gene}`,
    );
  }

  const manifest = {
    parent_id: genotype.id,
    child_id: mutated.id,
    operator: operator.name,
    high_risk: operator.high_risk,
    diff,
    created_at: mutated.created_at,
  };

  return { yaml: serializeYaml(mutated), manifest };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let inputFile = null;
  let forcedOperator = null;
  let seed = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) inputFile = args[++i];
    else if (args[i] === "--operator" && args[i + 1])
      forcedOperator = args[++i];
    else if (args[i] === "--seed" && args[i + 1])
      seed = parseInt(args[++i], 10);
    else if (args[i] === "--list-operators") {
      console.log(
        OPERATORS.map(
          (o) => `${o.name} (weight=${o.weight}, high_risk=${o.high_risk})`,
        ).join("\n"),
      );
      process.exit(0);
    }
  }

  // Seed RNG if provided (for deterministic testing)
  if (seed !== null) {
    _rand = mulberry32(seed);
  }

  let inputYaml = "";
  if (inputFile) {
    const fs = await import("fs");
    inputYaml = fs.readFileSync(inputFile, "utf8");
  } else if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) inputYaml += chunk;
  } else {
    console.error(
      "Usage: node mutate.js --input <genotype.yaml> [--operator <name>] [--seed <int>]",
    );
    console.error("       node mutate.js --list-operators");
    process.exit(1);
  }

  const { yaml, manifest } = mutate(inputYaml, forcedOperator);

  // Mutated YAML to stdout
  process.stdout.write(yaml);

  // Manifest to stderr (structured, for capture by caller)
  process.stderr.write(JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = { mutate, OPERATORS, weightedChoice };

if (require.main === module) {
  main().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}
