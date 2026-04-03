/**
 * viral/export-v2.ts — Export a portable, shareable X-Ray config
 *
 * Runs a scan, curates the result into a versioned JSON export format.
 * No SQL, no database — pure JSON operations.
 */

import { resolve } from "node:path";
import { runXRay } from "../scan/index.js";
import { generateFixes } from "../fix/index.js";
import type { XRayResult, Fix } from "../scan/types.js";

export const XRAY_EXPORT_VERSION = "0.2.0";
export const SCHEMA_VERSION = 1;

export interface ExportedFix {
  id: string;
  description: string;
  diff: string;
}

export interface XRayExport {
  xray_version: string;
  schema_version: number;
  exported_at: string;
  archetype: string;
  score: {
    overall: number;
    safety: number;
    capability: number;
    automation: number;
    efficiency: number;
  };
  applied_fixes: ExportedFix[];
}

/**
 * Export a curated, shareable config from the current repo.
 */
export function exportConfig(repoRoot: string = "."): XRayExport {
  const root = resolve(repoRoot);
  const result = runXRay(root);
  const fixes = generateFixes(result, root);

  return buildExport(result, fixes);
}

/**
 * Build the export object from scan result and fixes.
 * Exported separately for testing.
 */
export function buildExport(result: XRayResult, fixes: Fix[]): XRayExport {
  return {
    xray_version: XRAY_EXPORT_VERSION,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    archetype: result.archetype,
    score: {
      overall: result.overall_score,
      safety: result.dimensions["safety"]?.score ?? 0,
      capability: result.dimensions["capability"]?.score ?? 0,
      automation: result.dimensions["automation"]?.score ?? 0,
      efficiency: result.dimensions["efficiency"]?.score ?? 0,
    },
    applied_fixes: fixes.map((f) => ({
      id: f.id,
      description: f.description,
      diff: f.diff,
    })),
  };
}

/**
 * Serialize an export to JSON string.
 */
export function serializeExport(exp: XRayExport): string {
  return JSON.stringify(exp, null, 2);
}
