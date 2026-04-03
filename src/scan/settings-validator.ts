/**
 * settings-validator.ts — Validates settings.json against the schema snapshot
 *
 * Checks:
 *   - Unknown top-level keys (typos, stale config)
 *   - Type mismatches (expected boolean got string, etc.)
 *   - Invalid enum values (e.g. permissions.defaultMode)
 *
 * The schema is embedded inline to avoid JSON copy issues during tsc build.
 * The companion schema-snapshot.json is the canonical reference file.
 */

import type { SchemaValidation, SchemaError } from "./types.js";

// ─── Schema definition ──────────────────────────────────────────────────────

interface SchemaProperty {
  type: string;
  properties?: Record<string, SchemaProperty>;
  enum?: string[];
}

const SCHEMA_KEYS: Record<string, SchemaProperty> = {
  permissions: {
    type: "object",
    properties: {
      allow: { type: "array" },
      deny: { type: "array" },
      defaultMode: {
        type: "string",
        enum: ["default", "bypassPermissions", "plan", "acceptEdits"],
      },
    },
  },
  hooks: {
    type: "object",
    properties: {
      PreToolUse: { type: "array" },
      PostToolUse: { type: "array" },
    },
  },
  sandbox: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      filesystem: { type: "object" },
      network: { type: "object" },
      permissions: { type: "object" },
    },
  },
  env: { type: "object" },
  model: { type: "string" },
  includeCoAuthoredBy: { type: "boolean" },
  enableAllProjectMcpServers: { type: "boolean" },
  autoUpdaterStatus: { type: "string" },
  mcpServers: { type: "object" },
  features: { type: "object" },
  featureFlags: { type: "object" },
  preferredNotifChannel: { type: "string" },
  theme: { type: "string" },
  verbosityLevel: { type: "string" },
  cleanupPeriodDays: { type: "number" },
  gitConfigAllowList: { type: "array" },
  autoMemoryEnabled: { type: "boolean" },
};

// ─── Type checking helpers ──────────────────────────────────────────────────

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual;
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validate a settings object against the schema snapshot.
 *
 * @param settings - Parsed settings.json content
 * @param scope - Scope label (e.g. "user", "project-shared", "project-local")
 * @returns SchemaValidation with errors (empty if valid)
 */
export function validateSettings(
  settings: Record<string, unknown>,
  scope: string,
): SchemaValidation {
  const errors: SchemaError[] = [];

  for (const [key, value] of Object.entries(settings)) {
    const schemaDef = SCHEMA_KEYS[key];

    // 1. Unknown key check
    if (!schemaDef) {
      errors.push({
        path: key,
        message: `Unknown settings key "${key}". May be a typo or stale config.`,
        scope,
      });
      continue;
    }

    // 2. Top-level type check
    const actualType = jsonType(value);
    if (!typeMatches(schemaDef.type, actualType)) {
      errors.push({
        path: key,
        message: `Type mismatch for "${key}": expected ${schemaDef.type}, got ${actualType}.`,
        scope,
      });
      continue;
    }

    // 3. Nested property validation (for objects with known properties)
    if (
      schemaDef.type === "object" &&
      schemaDef.properties &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const obj = value as Record<string, unknown>;
      for (const [propKey, propValue] of Object.entries(obj)) {
        const propDef = schemaDef.properties[propKey];
        if (!propDef) continue; // Skip unknown nested keys (not strict at depth)

        const propActual = jsonType(propValue);
        if (!typeMatches(propDef.type, propActual)) {
          errors.push({
            path: `${key}.${propKey}`,
            message: `Type mismatch for "${key}.${propKey}": expected ${propDef.type}, got ${propActual}.`,
            scope,
          });
        }

        // 4. Enum validation
        if (
          propDef.enum &&
          propDef.enum.length > 0 &&
          typeof propValue === "string"
        ) {
          if (!propDef.enum.includes(propValue)) {
            errors.push({
              path: `${key}.${propKey}`,
              message: `Invalid value "${propValue}" for "${key}.${propKey}". Allowed: ${propDef.enum.join(", ")}.`,
              scope,
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Return the set of known top-level keys from the schema.
 * Useful for the capability scanner and fixers.
 */
export function knownSettingsKeys(): ReadonlySet<string> {
  return new Set(Object.keys(SCHEMA_KEYS));
}
