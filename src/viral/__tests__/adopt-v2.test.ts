import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  validateExport,
  previewAdopt,
  renderAdoptPreview,
} from "../adopt-v2.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(__dirname, ".tmp-test-adopt-v2");

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

function validExport(): Record<string, unknown> {
  return {
    xray_version: "0.2.0",
    schema_version: 1,
    exported_at: "2026-04-03T12:00:00.000Z",
    archetype: "nextjs-app",
    score: {
      overall: 83,
      safety: 95,
      capability: 70,
      automation: 80,
      efficiency: 85,
    },
    applied_fixes: [
      {
        id: "safety/deny-rules",
        description: "Deny rules for .env, secrets",
        diff: '{"permissions":{"deny":["*.env"]}}',
      },
    ],
  };
}

// ─── validateExport ─────────────────────────────────────────────────────────

describe("validateExport", () => {
  it("passes valid export", () => {
    const errors = validateExport(validExport());
    assert.equal(errors.length, 0);
  });

  it("rejects non-object input", () => {
    const errors = validateExport("not an object");
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.message.includes("JSON object"));
  });

  it("rejects null input", () => {
    const errors = validateExport(null);
    assert.ok(errors.length > 0);
  });

  it("rejects array input", () => {
    const errors = validateExport([1, 2, 3]);
    assert.ok(errors.length > 0);
  });

  it("rejects unknown top-level fields", () => {
    const data = { ...validExport(), malicious_field: "DROP TABLE" };
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "malicious_field"));
  });

  it("rejects missing xray_version", () => {
    const data = validExport();
    delete data["xray_version"];
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "xray_version"));
  });

  it("rejects wrong type for schema_version", () => {
    const data = { ...validExport(), schema_version: "1" };
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "schema_version"));
  });

  it("rejects future schema version", () => {
    const data = { ...validExport(), schema_version: 999 };
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.message.includes("newer")));
  });

  it("rejects missing score object", () => {
    const data = validExport();
    delete data["score"];
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "score"));
  });

  it("rejects unknown score fields", () => {
    const data = validExport();
    (data["score"] as Record<string, unknown>)["evil"] = 999;
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "score.evil"));
  });

  it("rejects non-numeric score values", () => {
    const data = validExport();
    (data["score"] as Record<string, unknown>)["safety"] = "high";
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "score.safety"));
  });

  it("rejects non-array applied_fixes", () => {
    const data = { ...validExport(), applied_fixes: "not an array" };
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "applied_fixes"));
  });

  it("rejects fix with missing id", () => {
    const data = validExport();
    (data["applied_fixes"] as Record<string, unknown>[]) = [
      { description: "foo", diff: "{}" },
    ];
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field.includes("applied_fixes[0].id")));
  });

  it("rejects fix with unknown fields", () => {
    const data = validExport();
    (data["applied_fixes"] as Record<string, unknown>[]) = [
      {
        id: "test",
        description: "test",
        diff: "{}",
        sql_injection: "DROP TABLE users",
      },
    ];
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.message.includes("sql_injection")));
  });

  it("validates all score dimension keys", () => {
    const data = validExport();
    data["score"] = { overall: 50 }; // missing other dimensions
    const errors = validateExport(data);
    assert.ok(errors.some((e) => e.field === "score.safety"));
    assert.ok(errors.some((e) => e.field === "score.capability"));
    assert.ok(errors.some((e) => e.field === "score.automation"));
    assert.ok(errors.some((e) => e.field === "score.efficiency"));
  });
});

// ─── previewAdopt ───────────────────────────────────────────────────────────

describe("previewAdopt", () => {
  it("returns error for nonexistent file", () => {
    const { errors } = previewAdopt("/nonexistent/file.json");
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.message.includes("not found"));
  });

  it("returns error for invalid JSON file", () => {
    mkdirSync(TMP, { recursive: true });
    const path = join(TMP, "bad.json");
    writeFileSync(path, "not json {{{", "utf-8");
    try {
      const { errors } = previewAdopt(path);
      assert.ok(errors.length > 0);
      assert.ok(errors[0]!.message.includes("Invalid JSON"));
    } finally {
      teardown();
    }
  });

  it("returns error for invalid export schema", () => {
    mkdirSync(TMP, { recursive: true });
    const path = join(TMP, "invalid-schema.json");
    writeFileSync(path, JSON.stringify({ bad: "data" }), "utf-8");
    try {
      const { errors } = previewAdopt(path);
      assert.ok(errors.length > 0);
    } finally {
      teardown();
    }
  });

  it("returns valid diff for correct export file", () => {
    mkdirSync(TMP, { recursive: true });
    const path = join(TMP, "valid.json");
    writeFileSync(path, JSON.stringify(validExport()), "utf-8");
    try {
      const { diff, errors } = previewAdopt(path);
      assert.equal(errors.length, 0);
      assert.equal(diff.source_score, 83);
      assert.equal(diff.source_archetype, "nextjs-app");
      assert.equal(diff.fixes_to_apply.length, 1);
      assert.equal(diff.fixes_to_apply[0]!.id, "safety/deny-rules");
    } finally {
      teardown();
    }
  });
});

// ─── renderAdoptPreview ─────────────────────────────────────────────────────

describe("renderAdoptPreview", () => {
  it("renders errors when present", () => {
    const output = renderAdoptPreview(
      { fixes_to_apply: [], source_score: 0, source_archetype: "" },
      [{ field: "test", message: "test error" }],
    );
    assert.ok(output.includes("Validation errors"));
    assert.ok(output.includes("test error"));
  });

  it("renders preview with fix details", () => {
    const output = renderAdoptPreview(
      {
        fixes_to_apply: [
          {
            id: "safety/deny-rules",
            description: "Add deny rules",
            diff: '{"a":1}',
          },
        ],
        source_score: 83,
        source_archetype: "nextjs-app",
      },
      [],
    );
    assert.ok(output.includes("Adopt Preview"));
    assert.ok(output.includes("nextjs-app"));
    assert.ok(output.includes("83"));
    assert.ok(output.includes("safety/deny-rules"));
    assert.ok(output.includes("--apply"));
  });
});
