/**
 * index.ts — X-Ray scan orchestrator
 *
 * Runs all 4 dimension scanners and computes the composite score.
 */

import { resolve } from "node:path";
import type { XRayResult, SecurityAlert } from "./types.js";
import { scanSafety } from "./safety.js";
import { scanCapability } from "./capability.js";
import { scanAutomation } from "./automation.js";
import { scanEfficiency } from "./efficiency.js";
import { computeScore } from "./scoring.js";
import { detectArchetype } from "../orchestrator/detect-archetype.js";

const VERSION = "0.1.0";

export function runXRay(repoRoot: string = "."): XRayResult {
  const root = resolve(repoRoot);

  // Detect archetype
  const { archetype } = detectArchetype(root);

  // Run all 4 scanners
  const safety = scanSafety(root);
  const capability = scanCapability(root);
  const automation = scanAutomation(root);
  const efficiency = scanEfficiency(root);

  // Assemble dimensions
  const dimensions = {
    safety: safety.dimension,
    capability,
    automation,
    efficiency,
  };

  // Compute weighted score
  const { overall, scored } = computeScore(dimensions);

  // Collect all security alerts
  const alerts: SecurityAlert[] = [...safety.alerts];

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
    settings_validation: { valid: true, errors: [] },
  };
}

export { runXRay as scan };
