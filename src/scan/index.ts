/**
 * index.ts — X-Ray scan orchestrator
 *
 * Runs all 4 dimension scanners and computes the composite score.
 */

import { resolve } from "node:path";
import type { XRayResult, SecurityAlert, DimensionScore } from "./types.js";
import { scanSafety } from "./safety.js";
import { scanCapability } from "./capability.js";
import { scanAutomation } from "./automation.js";
import { scanEfficiency } from "./efficiency.js";
import { computeScore } from "./scoring.js";
import { detectArchetype } from "../orchestrator/detect-archetype.js";
import { validateSettings } from "./settings-validator.js";
import { readJson, getSettingsLocations } from "./utils.js";
import type { SchemaValidation, SchemaError } from "./types.js";

const VERSION = "0.2.0";

function tryScan<T>(name: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[xray] ${name} scanner failed: ${msg}`);
    return null;
  }
}

export function runXRay(repoRoot: string = "."): XRayResult {
  const root = resolve(repoRoot);

  // Detect archetype
  const { archetype } = detectArchetype(root);

  // Run all 4 scanners with isolation
  const safety = tryScan("safety", () => scanSafety(root));
  const capability = tryScan("capability", () => scanCapability(root));
  const automation = tryScan("automation", () => scanAutomation(root));
  const efficiency = tryScan("efficiency", () => scanEfficiency(root));

  // Assemble dimensions (skip any scanner that failed)
  const dimensions: Record<string, DimensionScore> = {};
  if (safety) dimensions.safety = safety.dimension;
  if (capability) dimensions.capability = capability;
  if (automation) dimensions.automation = automation;
  if (efficiency) dimensions.efficiency = efficiency;

  // Compute weighted score
  const { overall, scored } = computeScore(dimensions);

  // Collect all security alerts
  const alerts: SecurityAlert[] = safety ? [...safety.alerts] : [];

  // Collect fixable checks as available fixes
  const fixable = Object.values(dimensions)
    .flatMap((d) => d.checks)
    .filter((c) => !c.passed && c.fix_available)
    .map((c) => ({
      id: c.name.toLowerCase().replace(/\s+/g, "-"),
      dimension: "auto",
      description: c.detail ?? c.name,
      diff: "",
      impact_estimate: 10,
      security_relevant: false,
      why_safe: "",
      target_file: "",
    }));

  // Run settings validation across all scopes
  const locs = getSettingsLocations(root);
  const scopeEntries: { scope: string; path: string }[] = [
    { scope: "user", path: locs.user },
    { scope: "project-shared", path: locs.projectShared },
    { scope: "project-local", path: locs.projectLocal },
  ];
  const allSchemaErrors: SchemaError[] = [];
  for (const { scope, path } of scopeEntries) {
    const data = readJson(path);
    if (!data) continue;
    const validation = validateSettings(data, scope);
    allSchemaErrors.push(...validation.errors);
  }
  const settingsValidation: SchemaValidation = {
    valid: allSchemaErrors.length === 0,
    errors: allSchemaErrors,
  };

  return {
    timestamp: new Date().toISOString(),
    version: VERSION,
    repo: root,
    archetype,
    overall_score: overall,
    dimensions_scored: scored,
    dimensions,
    fixes_available: fixable,
    security_alerts: alerts,
    settings_validation: settingsValidation,
  };
}

export { runXRay as scan };
