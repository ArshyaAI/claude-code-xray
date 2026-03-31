import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DEFAULT_WEIGHTS } from "../types.js";

describe("DEFAULT_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const sum =
      DEFAULT_WEIGHTS.safety +
      DEFAULT_WEIGHTS.capability +
      DEFAULT_WEIGHTS.automation +
      DEFAULT_WEIGHTS.efficiency;
    assert.equal(sum, 1.0);
  });

  it("has all four dimensions", () => {
    assert.ok("safety" in DEFAULT_WEIGHTS);
    assert.ok("capability" in DEFAULT_WEIGHTS);
    assert.ok("automation" in DEFAULT_WEIGHTS);
    assert.ok("efficiency" in DEFAULT_WEIGHTS);
  });

  it("safety has the highest weight (0.3)", () => {
    assert.equal(DEFAULT_WEIGHTS.safety, 0.3);
    assert.ok(DEFAULT_WEIGHTS.safety > DEFAULT_WEIGHTS.capability);
    assert.ok(DEFAULT_WEIGHTS.safety > DEFAULT_WEIGHTS.automation);
    assert.ok(DEFAULT_WEIGHTS.safety > DEFAULT_WEIGHTS.efficiency);
  });

  it("all weights are between 0 and 1", () => {
    for (const [, value] of Object.entries(DEFAULT_WEIGHTS)) {
      assert.ok(value > 0, `weight should be > 0`);
      assert.ok(value < 1, `weight should be < 1`);
    }
  });
});
