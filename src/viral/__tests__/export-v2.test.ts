import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildExport,
  serializeExport,
  XRAY_EXPORT_VERSION,
  SCHEMA_VERSION,
} from "../export-v2.js";
import type { XRayExport } from "../export-v2.js";
import type { XRayResult, Fix } from "../../scan/types.js";

function makeXRayResult(overrides: Partial<XRayResult> = {}): XRayResult {
  return {
    timestamp: new Date().toISOString(),
    version: "0.2.0",
    repo: "/tmp/test",
    archetype: "nextjs-app",
    overall_score: 83,
    dimensions_scored: 4,
    dimensions: {
      safety: {
        name: "Safety & Security",
        score: 95,
        weight: 0.3,
        checks: [],
      },
      capability: {
        name: "Capability",
        score: 70,
        weight: 0.25,
        checks: [],
      },
      automation: {
        name: "Automation",
        score: 80,
        weight: 0.25,
        checks: [],
      },
      efficiency: {
        name: "Efficiency",
        score: 85,
        weight: 0.2,
        checks: [],
      },
    },
    fixes_available: [],
    security_alerts: [],
    settings_validation: { valid: true, errors: [] },
    ...overrides,
  };
}

function makeFix(overrides: Partial<Fix> = {}): Fix {
  return {
    id: "safety/deny-rules",
    dimension: "safety",
    description: "Deny rules for .env, secrets",
    diff: '{"permissions":{"deny":["*.env"]}}',
    impact_estimate: 15,
    security_relevant: true,
    why_safe: "Only adds deny rules",
    target_file: "/tmp/.claude/settings.json",
    ...overrides,
  };
}

describe("buildExport", () => {
  it("builds export with correct version fields", () => {
    const result = makeXRayResult();
    const exported = buildExport(result, []);

    assert.equal(exported.xray_version, XRAY_EXPORT_VERSION);
    assert.equal(exported.schema_version, SCHEMA_VERSION);
    assert.equal(typeof exported.exported_at, "string");
  });

  it("includes archetype from scan result", () => {
    const result = makeXRayResult({ archetype: "ts-lib" });
    const exported = buildExport(result, []);
    assert.equal(exported.archetype, "ts-lib");
  });

  it("includes all dimension scores", () => {
    const result = makeXRayResult();
    const exported = buildExport(result, []);

    assert.equal(exported.score.overall, 83);
    assert.equal(exported.score.safety, 95);
    assert.equal(exported.score.capability, 70);
    assert.equal(exported.score.automation, 80);
    assert.equal(exported.score.efficiency, 85);
  });

  it("defaults missing dimensions to 0", () => {
    const result = makeXRayResult({ dimensions: {} });
    const exported = buildExport(result, []);

    assert.equal(exported.score.safety, 0);
    assert.equal(exported.score.capability, 0);
  });

  it("includes fixes with id, description, diff", () => {
    const fixes = [
      makeFix({ id: "a", description: "Fix A", diff: '{"a":1}' }),
      makeFix({ id: "b", description: "Fix B", diff: '{"b":2}' }),
    ];
    const result = makeXRayResult();
    const exported = buildExport(result, fixes);

    assert.equal(exported.applied_fixes.length, 2);
    assert.equal(exported.applied_fixes[0]!.id, "a");
    assert.equal(exported.applied_fixes[0]!.description, "Fix A");
    assert.equal(exported.applied_fixes[0]!.diff, '{"a":1}');
    assert.equal(exported.applied_fixes[1]!.id, "b");
  });

  it("does not leak internal Fix fields into export", () => {
    const fix = makeFix();
    const result = makeXRayResult();
    const exported = buildExport(result, [fix]);
    const exportedFix = exported.applied_fixes[0]!;

    // These internal fields should NOT appear
    const keys = Object.keys(exportedFix);
    assert.ok(!keys.includes("dimension"));
    assert.ok(!keys.includes("impact_estimate"));
    assert.ok(!keys.includes("security_relevant"));
    assert.ok(!keys.includes("why_safe"));
    assert.ok(!keys.includes("target_file"));
  });
});

describe("serializeExport", () => {
  it("produces valid JSON", () => {
    const result = makeXRayResult();
    const exported = buildExport(result, []);
    const json = serializeExport(exported);

    const parsed = JSON.parse(json) as XRayExport;
    assert.equal(parsed.xray_version, XRAY_EXPORT_VERSION);
    assert.equal(parsed.schema_version, SCHEMA_VERSION);
  });

  it("pretty-prints with 2-space indent", () => {
    const result = makeXRayResult();
    const exported = buildExport(result, []);
    const json = serializeExport(exported);

    // Should contain indented lines
    assert.ok(json.includes('  "xray_version"'));
  });
});

describe("schema version", () => {
  it("SCHEMA_VERSION is 1", () => {
    assert.equal(SCHEMA_VERSION, 1);
  });

  it("XRAY_EXPORT_VERSION matches package version", () => {
    assert.equal(XRAY_EXPORT_VERSION, "0.2.0");
  });
});
