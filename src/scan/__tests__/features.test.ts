import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  FEATURE_INVENTORY,
  featuresByStatus,
  featureCounts,
  allPrerequisites,
} from "../features.js";

describe("FEATURE_INVENTORY", () => {
  it("has at least 20 features", () => {
    assert.ok(FEATURE_INVENTORY.length >= 20);
  });

  it("every feature has required fields", () => {
    for (const f of FEATURE_INVENTORY) {
      assert.ok(f.id, `feature missing id`);
      assert.ok(f.codename, `feature ${f.id} missing codename`);
      assert.ok(f.name, `feature ${f.id} missing name`);
      assert.ok(f.description, `feature ${f.id} missing description`);
      assert.ok(f.status, `feature ${f.id} missing status`);
      assert.ok(
        Array.isArray(f.prerequisites),
        `feature ${f.id} missing prerequisites array`,
      );
      assert.ok(
        f.confidence === "verified" || f.confidence === "inferred",
        `feature ${f.id} has invalid confidence: ${f.confidence}`,
      );
    }
  });

  it("all IDs are unique", () => {
    const ids = FEATURE_INVENTORY.map((f) => f.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "duplicate feature IDs found");
  });
});

describe("featuresByStatus", () => {
  it("returns only activatable features when filtered", () => {
    const result = featuresByStatus("activatable");
    assert.ok(result.length > 0, "should have activatable features");
    for (const f of result) {
      assert.equal(f.status, "activatable");
    }
  });

  it("returns only shipped features when filtered", () => {
    const result = featuresByStatus("shipped");
    assert.ok(result.length > 0, "should have shipped features");
    for (const f of result) {
      assert.equal(f.status, "shipped");
    }
  });

  it("returns only compile_time features when filtered", () => {
    const result = featuresByStatus("compile_time");
    assert.ok(result.length > 0, "should have compile_time features");
    for (const f of result) {
      assert.equal(f.status, "compile_time");
    }
  });

  it("returns only approximatable features when filtered", () => {
    const result = featuresByStatus("approximatable");
    assert.ok(result.length > 0, "should have approximatable features");
    for (const f of result) {
      assert.equal(f.status, "approximatable");
    }
  });

  it("returns empty array for nonexistent status", () => {
    // cast to bypass type check for testing
    const result = featuresByStatus("nonexistent" as "activatable");
    assert.equal(result.length, 0);
  });
});

describe("featureCounts", () => {
  it("returns counts for all four statuses", () => {
    const counts = featureCounts();
    assert.ok("activatable" in counts);
    assert.ok("approximatable" in counts);
    assert.ok("compile_time" in counts);
    assert.ok("shipped" in counts);
  });

  it("counts sum to total inventory size", () => {
    const counts = featureCounts();
    const total =
      counts.activatable +
      counts.approximatable +
      counts.compile_time +
      counts.shipped;
    assert.equal(total, FEATURE_INVENTORY.length);
  });

  it("matches featuresByStatus lengths", () => {
    const counts = featureCounts();
    assert.equal(counts.activatable, featuresByStatus("activatable").length);
    assert.equal(counts.shipped, featuresByStatus("shipped").length);
    assert.equal(counts.compile_time, featuresByStatus("compile_time").length);
    assert.equal(
      counts.approximatable,
      featuresByStatus("approximatable").length,
    );
  });
});

describe("allPrerequisites", () => {
  it("returns an array of strings", () => {
    const prereqs = allPrerequisites();
    assert.ok(Array.isArray(prereqs));
    for (const p of prereqs) {
      assert.equal(typeof p, "string");
    }
  });

  it("contains no duplicates", () => {
    const prereqs = allPrerequisites();
    const unique = new Set(prereqs);
    assert.equal(unique.size, prereqs.length);
  });

  it("includes known prerequisites from the inventory", () => {
    const prereqs = allPrerequisites();
    // KAIROS requires sandbox_enabled
    assert.ok(
      prereqs.includes("sandbox_enabled"),
      "should include sandbox_enabled",
    );
  });

  it("only contains prerequisites that actually appear in the inventory", () => {
    const prereqs = new Set(allPrerequisites());
    const inventoryPrereqs = new Set<string>();
    for (const f of FEATURE_INVENTORY) {
      for (const p of f.prerequisites) {
        inventoryPrereqs.add(p);
      }
    }
    assert.deepEqual(prereqs, inventoryPrereqs);
  });
});
