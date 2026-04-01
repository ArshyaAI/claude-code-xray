import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeScore } from "../scoring.js";
import { DEFAULT_WEIGHTS } from "../types.js";
import type { DimensionScore, ScoringWeights } from "../types.js";

function makeDimension(
  name: string,
  score: number,
  weight: number,
  checkCount: number = 1,
): DimensionScore {
  return {
    name,
    score,
    weight,
    checks: Array.from({ length: checkCount }, (_, i) => ({
      name: `check-${i}`,
      passed: true,
      value: "test",
      target: "test",
      source: "test",
      confidence: "verified" as const,
      fix_available: false,
    })),
  };
}

describe("computeScore", () => {
  it("returns 0 when no dimensions have data", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 0, 0.3, 0),
      capability: makeDimension("Capability", 0, 0.25, 0),
      automation: makeDimension("Automation", 0, 0.25, 0),
      efficiency: makeDimension("Efficiency", 0, 0.2, 0),
    };
    const result = computeScore(dimensions);
    assert.equal(result.overall, 0);
    assert.equal(result.scored, 0);
  });

  it("computes weighted average for all four dimensions", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 80, 0.3),
      capability: makeDimension("Capability", 60, 0.25),
      automation: makeDimension("Automation", 40, 0.25),
      efficiency: makeDimension("Efficiency", 100, 0.2),
    };
    const result = computeScore(dimensions);
    // Expected: 80*0.3 + 60*0.25 + 40*0.25 + 100*0.2 = 24+15+10+20 = 69
    assert.equal(result.overall, 69);
    assert.equal(result.scored, 4);
  });

  it("renormalizes weights when a dimension has no data", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 100, 0.3),
      capability: makeDimension("Capability", 100, 0.25),
      automation: makeDimension("Automation", 100, 0.25),
      efficiency: makeDimension("Efficiency", 0, 0.2, 0), // no data
    };
    const result = computeScore(dimensions);
    // Only 3 dimensions active, total weight = 0.3+0.25+0.25 = 0.8
    // All score 100, so renormalized = 100*0.3/0.8 + 100*0.25/0.8 + 100*0.25/0.8
    // = 100*(0.3+0.25+0.25)/0.8 = 100*0.8/0.8 = 100
    assert.equal(result.overall, 100);
    assert.equal(result.scored, 3);
  });

  it("handles single dimension with data", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 75, 0.3),
      capability: makeDimension("Capability", 0, 0.25, 0),
      automation: makeDimension("Automation", 0, 0.25, 0),
      efficiency: makeDimension("Efficiency", 0, 0.2, 0),
    };
    const result = computeScore(dimensions);
    // Single dimension: 75 * (0.3/0.3) = 75
    assert.equal(result.overall, 75);
    assert.equal(result.scored, 1);
  });

  it("uses custom weights when provided", () => {
    const customWeights: ScoringWeights = {
      safety: 0.5,
      capability: 0.2,
      automation: 0.2,
      efficiency: 0.1,
    };
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 100, 0.5),
      capability: makeDimension("Capability", 0, 0.2),
      automation: makeDimension("Automation", 0, 0.2),
      efficiency: makeDimension("Efficiency", 0, 0.1),
    };
    const result = computeScore(dimensions, customWeights);
    // 100*0.5/1.0 + 0*0.2/1.0 + 0*0.2/1.0 + 0*0.1/1.0 = 50
    assert.equal(result.overall, 50);
    assert.equal(result.scored, 4);
  });

  it("uses DEFAULT_WEIGHTS when no custom weights provided", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 50, 0.3),
      capability: makeDimension("Capability", 50, 0.25),
      automation: makeDimension("Automation", 50, 0.25),
      efficiency: makeDimension("Efficiency", 50, 0.2),
    };
    const result = computeScore(dimensions);
    // All 50, sum of weights = 1.0, so 50*1.0/1.0 = 50
    assert.equal(result.overall, 50);
  });

  it("rounds the overall score to nearest integer", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 33, 0.3),
      capability: makeDimension("Capability", 67, 0.25),
      automation: makeDimension("Automation", 45, 0.25),
      efficiency: makeDimension("Efficiency", 89, 0.2),
    };
    const result = computeScore(dimensions);
    // 33*0.3 + 67*0.25 + 45*0.25 + 89*0.2 = 9.9+16.75+11.25+17.8 = 55.7 => 56
    assert.equal(result.overall, 56);
  });

  it("scores 0 when all active dimensions score 0", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 0, 0.3),
      capability: makeDimension("Capability", 0, 0.25),
    };
    const result = computeScore(dimensions);
    assert.equal(result.overall, 0);
    assert.equal(result.scored, 2);
  });

  it("scores 100 when all active dimensions score 100", () => {
    const dimensions: Record<string, DimensionScore> = {
      safety: makeDimension("Safety & Security", 100, 0.3),
      capability: makeDimension("Capability", 100, 0.25),
      automation: makeDimension("Automation", 100, 0.25),
      efficiency: makeDimension("Efficiency", 100, 0.2),
    };
    const result = computeScore(dimensions);
    assert.equal(result.overall, 100);
    assert.equal(result.scored, 4);
  });
});
