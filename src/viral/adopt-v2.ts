/**
 * viral/adopt-v2.ts — Import a shared X-Ray config with validation
 *
 * Reads an exported JSON, validates against schema, shows a diff preview,
 * and optionally applies fixes. Pure JSON operations — no SQL, no database.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyFix } from "../fix/index.js";
import type { Fix } from "../scan/types.js";
import type { XRayExport, ExportedFix } from "./export-v2.js";
import { SCHEMA_VERSION } from "./export-v2.js";

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "xray_version",
  "schema_version",
  "exported_at",
  "archetype",
  "score",
  "applied_fixes",
]);

const KNOWN_SCORE_KEYS = new Set([
  "overall",
  "safety",
  "capability",
  "automation",
  "efficiency",
]);

const KNOWN_FIX_KEYS = new Set(["id", "description", "diff"]);

/**
 * Validate an imported JSON object against the XRayExport schema.
 * Returns validation errors (empty array = valid).
 */
export function validateExport(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "root", message: "Expected a JSON object" });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Reject unknown top-level fields
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      errors.push({
        field: key,
        message: `Unknown field: ${key}`,
      });
    }
  }

  // Required fields
  if (typeof obj["xray_version"] !== "string") {
    errors.push({
      field: "xray_version",
      message: "Required string field missing or wrong type",
    });
  }

  if (typeof obj["schema_version"] !== "number") {
    errors.push({
      field: "schema_version",
      message: "Required number field missing or wrong type",
    });
  } else if (obj["schema_version"] > SCHEMA_VERSION) {
    errors.push({
      field: "schema_version",
      message: `Schema version ${obj["schema_version"]} is newer than supported (${SCHEMA_VERSION})`,
    });
  }

  if (typeof obj["exported_at"] !== "string") {
    errors.push({
      field: "exported_at",
      message: "Required string field missing or wrong type",
    });
  }

  if (typeof obj["archetype"] !== "string") {
    errors.push({
      field: "archetype",
      message: "Required string field missing or wrong type",
    });
  }

  // Score object validation
  if (typeof obj["score"] !== "object" || obj["score"] === null) {
    errors.push({
      field: "score",
      message: "Required object field missing or wrong type",
    });
  } else {
    const score = obj["score"] as Record<string, unknown>;
    for (const key of Object.keys(score)) {
      if (!KNOWN_SCORE_KEYS.has(key)) {
        errors.push({
          field: `score.${key}`,
          message: `Unknown score field: ${key}`,
        });
      }
    }
    for (const k of [
      "overall",
      "safety",
      "capability",
      "automation",
      "efficiency",
    ]) {
      if (typeof score[k] !== "number") {
        errors.push({
          field: `score.${k}`,
          message: `Expected number, got ${typeof score[k]}`,
        });
      }
    }
  }

  // Applied fixes array validation
  if (!Array.isArray(obj["applied_fixes"])) {
    errors.push({
      field: "applied_fixes",
      message: "Required array field missing or wrong type",
    });
  } else {
    const fixes = obj["applied_fixes"] as unknown[];
    for (let i = 0; i < fixes.length; i++) {
      const fix = fixes[i];
      if (typeof fix !== "object" || fix === null) {
        errors.push({
          field: `applied_fixes[${i}]`,
          message: "Expected object",
        });
        continue;
      }
      const f = fix as Record<string, unknown>;
      for (const key of Object.keys(f)) {
        if (!KNOWN_FIX_KEYS.has(key)) {
          errors.push({
            field: `applied_fixes[${i}].${key}`,
            message: `Unknown fix field: ${key}`,
          });
        }
      }
      if (typeof f["id"] !== "string") {
        errors.push({
          field: `applied_fixes[${i}].id`,
          message: "Required string field",
        });
      }
      if (typeof f["description"] !== "string") {
        errors.push({
          field: `applied_fixes[${i}].description`,
          message: "Required string field",
        });
      }
      if (typeof f["diff"] !== "string") {
        errors.push({
          field: `applied_fixes[${i}].diff`,
          message: "Required string field",
        });
      }
    }
  }

  return errors;
}

// ─── Diff Preview ───────────────────────────────────────────────────────────

export interface AdoptDiff {
  fixes_to_apply: ExportedFix[];
  source_score: number;
  source_archetype: string;
}

/**
 * Parse and validate an export file, returning the diff of what would change.
 */
export function previewAdopt(filePath: string): {
  diff: AdoptDiff;
  errors: ValidationError[];
} {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    return {
      diff: { fixes_to_apply: [], source_score: 0, source_archetype: "" },
      errors: [{ field: "file", message: `File not found: ${absPath}` }],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absPath, "utf-8"));
  } catch (err) {
    return {
      diff: { fixes_to_apply: [], source_score: 0, source_archetype: "" },
      errors: [{ field: "file", message: `Invalid JSON: ${String(err)}` }],
    };
  }

  const errors = validateExport(raw);
  if (errors.length > 0) {
    return {
      diff: { fixes_to_apply: [], source_score: 0, source_archetype: "" },
      errors,
    };
  }

  const data = raw as XRayExport;
  return {
    diff: {
      fixes_to_apply: data.applied_fixes,
      source_score: data.score.overall,
      source_archetype: data.archetype,
    },
    errors: [],
  };
}

// ─── Apply ──────────────────────────────────────────────────────────────────

/**
 * Apply fixes from an export file.
 *
 * @param filePath - Path to the exported JSON file
 * @param repoRoot - Target repo root
 * @param dryRun - If true, only preview (default: true for safety)
 * @returns Number of fixes applied (or that would be applied)
 */
export function adoptConfig(
  filePath: string,
  repoRoot: string,
  dryRun: boolean = true,
): { applied: number; errors: ValidationError[] } {
  const { diff, errors } = previewAdopt(filePath);

  if (errors.length > 0) {
    return { applied: 0, errors };
  }

  const root = resolve(repoRoot);
  let applied = 0;

  for (const exportedFix of diff.fixes_to_apply) {
    // Convert ExportedFix to Fix for applyFix()
    const fix: Fix = {
      id: exportedFix.id,
      dimension: "imported",
      description: exportedFix.description,
      diff: exportedFix.diff,
      impact_estimate: 0,
      security_relevant: false,
      why_safe: "Imported from shared config",
      target_file: resolveFixTarget(exportedFix.id, root),
    };

    applyFix(fix, dryRun);
    applied++;
  }

  return { applied, errors: [] };
}

/**
 * Resolve the target file for a fix based on its ID.
 * Convention: safety/* fixes target project settings, others target user settings.
 */
function resolveFixTarget(fixId: string, repoRoot: string): string {
  if (fixId.startsWith("safety/") || fixId.startsWith("automation/")) {
    return resolve(repoRoot, ".claude", "settings.json");
  }
  return resolve(process.env.HOME ?? "/tmp", ".claude", "settings.json");
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Render adopt preview as human-readable text.
 */
export function renderAdoptPreview(
  diff: AdoptDiff,
  errors: ValidationError[],
): string {
  if (errors.length > 0) {
    const lines = ["Validation errors:"];
    for (const e of errors) {
      lines.push(`  ${e.field}: ${e.message}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("X-Ray Adopt Preview");
  lines.push("\u2500".repeat(40));
  lines.push(`Source archetype: ${diff.source_archetype}`);
  lines.push(`Source score:     ${diff.source_score}`);
  lines.push(`Fixes to apply:   ${diff.fixes_to_apply.length}`);
  lines.push("");

  for (const fix of diff.fixes_to_apply) {
    lines.push(`  [${fix.id}] ${fix.description}`);
    if (fix.diff) {
      const diffLines = fix.diff.split("\n").slice(0, 5);
      for (const dl of diffLines) {
        lines.push(`    ${dl}`);
      }
      if (fix.diff.split("\n").length > 5) {
        lines.push("    ...");
      }
    }
  }

  lines.push("");
  lines.push("Run with --apply to execute these changes.");
  lines.push("");
  return lines.join("\n");
}
