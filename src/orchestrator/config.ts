/**
 * config.ts — factory.yaml Configuration Loader
 *
 * Loads and validates the project-level factory.yaml configuration.
 * Falls back to sensible defaults when fields are missing.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { detectArchetype } from "./detect-archetype.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported repo archetypes for Phase 1 (user-declared). */
export type Archetype =
  | "nextjs-app"
  | "ts-lib"
  | "react-app"
  | "rust-cli"
  | "go-service"
  | "python-app";

const VALID_ARCHETYPES: ReadonlySet<string> = new Set<Archetype>([
  "nextjs-app",
  "ts-lib",
  "react-app",
  "rust-cli",
  "go-service",
  "python-app",
]);

/** Active agent roles for a Shadow League run. */
export type ActiveRole = "builder" | "reviewer" | "qa";

export interface FactoryConfig {
  /** Repo archetype — explicit in factory.yaml or auto-detected from project files. */
  archetype: Archetype;
  /** Max parallel crews (default: 5). */
  max_crews: number;
  /** Budget cap per run in USD (default: 50). */
  default_budget_usd: number;
  /** Where to read tasks from (default: PROGRAM.md). */
  task_source: string;
  /** Which agent roles to activate (default: builder, reviewer, qa). */
  active_roles: ActiveRole[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: FactoryConfig = {
  archetype: "ts-lib",
  max_crews: 5,
  default_budget_usd: 50,
  task_source: "PROGRAM.md",
  active_roles: ["builder", "reviewer", "qa"],
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export interface ConfigValidation {
  valid: boolean;
  errors: string[];
  config: FactoryConfig;
  /** How the archetype was resolved: 'explicit' (factory.yaml) or 'detected'. */
  archetypeSource: "explicit" | "detected";
  /** Human-readable reason for the archetype choice. */
  archetypeReason: string;
}

/**
 * Load factory.yaml from the given repo root.
 * Returns validated config with defaults applied for missing fields.
 *
 * @param repoRoot - Path to the repository root
 * @returns Validated config, or defaults if factory.yaml doesn't exist
 */
export function loadConfig(repoRoot: string): ConfigValidation {
  const configPath = join(repoRoot, "factory.yaml");
  const errors: string[] = [];

  if (!existsSync(configPath)) {
    const detected = detectArchetype(repoRoot);
    return {
      valid: true,
      errors: [],
      config: { ...DEFAULTS, archetype: detected.archetype },
      archetypeSource: "detected",
      archetypeReason: detected.reason,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return {
      valid: false,
      errors: [`Failed to read ${configPath}`],
      config: { ...DEFAULTS },
      archetypeSource: "detected",
      archetypeReason: "factory.yaml unreadable — using default",
    };
  }

  // Simple YAML parser for flat key-value pairs
  // (avoids adding a YAML dependency for Phase 1)
  const parsed = parseSimpleYaml(raw);

  // Validate and apply
  const config: FactoryConfig = { ...DEFAULTS };
  let archetypeSource: "explicit" | "detected" = "detected";
  let archetypeReason: string;

  if (parsed["archetype"] !== undefined) {
    if (VALID_ARCHETYPES.has(parsed["archetype"])) {
      config.archetype = parsed["archetype"] as Archetype;
      archetypeSource = "explicit";
      archetypeReason = `factory.yaml declares archetype: ${parsed["archetype"]}`;
    } else {
      errors.push(
        `Invalid archetype: "${parsed["archetype"]}". Must be one of: ${[...VALID_ARCHETYPES].join(", ")}`,
      );
      const detected = detectArchetype(repoRoot);
      config.archetype = detected.archetype;
      archetypeReason = `invalid archetype in factory.yaml — auto-detected: ${detected.reason}`;
    }
  } else {
    const detected = detectArchetype(repoRoot);
    config.archetype = detected.archetype;
    archetypeReason = detected.reason;
  }

  if (parsed["max_crews"] !== undefined) {
    const n = parseInt(parsed["max_crews"], 10);
    if (isNaN(n) || n < 1 || n > 10) {
      errors.push(`max_crews must be 1-10, got: ${parsed["max_crews"]}`);
    } else {
      config.max_crews = n;
    }
  }

  if (parsed["default_budget_usd"] !== undefined) {
    const n = parseFloat(parsed["default_budget_usd"]);
    if (isNaN(n) || n <= 0) {
      errors.push(
        `default_budget_usd must be positive, got: ${parsed["default_budget_usd"]}`,
      );
    } else {
      config.default_budget_usd = n;
    }
  }

  if (parsed["task_source"] !== undefined) {
    config.task_source = parsed["task_source"];
  }

  if (parsed["active_roles"] !== undefined) {
    const roles = parseYamlList(parsed["active_roles"]);
    const validRoles = new Set(["builder", "reviewer", "qa"]);
    const invalid = roles.filter((r) => !validRoles.has(r));
    if (invalid.length > 0) {
      errors.push(
        `Invalid active_roles: ${invalid.join(", ")}. Phase 1 supports: builder, reviewer, qa`,
      );
    } else {
      config.active_roles = roles as ActiveRole[];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
    archetypeSource,
    archetypeReason: archetypeReason!,
  };
}

// ─── Simple YAML parser ──────────────────────────────────────────────────────

/**
 * Parse flat YAML key-value pairs. Handles:
 * - `key: value`
 * - `key: "quoted value"`
 * - YAML lists (returned as raw string for parseYamlList)
 * - Comments (#)
 *
 * Does NOT handle nested objects or multiline strings.
 */
function parseSimpleYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split("\n");
  let currentKey: string | null = null;
  let listLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // List item under current key
    if (currentKey && trimmed.startsWith("- ")) {
      listLines.push(trimmed.replace(/^- /, "").trim());
      continue;
    }

    // Flush previous list
    if (currentKey && listLines.length > 0) {
      result[currentKey] = listLines.join(",");
      listLines = [];
      currentKey = null;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch?.[1]) {
      const key = kvMatch[1];
      let value = kvMatch[2] ?? "";

      // Strip quotes
      value = value.replace(/^["']|["']$/g, "").trim();

      if (value === "" || value === undefined) {
        // Might be a list that follows
        currentKey = key;
      } else {
        result[key] = value;
      }
    }
  }

  // Flush final list
  if (currentKey && listLines.length > 0) {
    result[currentKey] = listLines.join(",");
  }

  return result;
}

function parseYamlList(raw: string): string[] {
  // Handle both comma-separated and bracket formats
  const cleaned = raw.replace(/^\[|\]$/g, "").trim();
  return cleaned
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}
