/**
 * review-score.test.ts — Tests for review score parsing from agent output and files
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseReviewScore } from "../dispatch.js";

describe("parseReviewScore", () => {
  it("parses 'SCORE: 85'", () => {
    assert.equal(parseReviewScore("SCORE: 85"), 85);
  });

  it("parses 'SCORE:90' (no space)", () => {
    assert.equal(parseReviewScore("SCORE:90"), 90);
  });

  it("parses 'Score: 75' (mixed case)", () => {
    assert.equal(parseReviewScore("Score: 75"), 75);
  });

  it("parses 'score: 100' (lowercase)", () => {
    assert.equal(parseReviewScore("score: 100"), 100);
  });

  it("parses score embedded in text", () => {
    const text = "Review complete.\nSCORE: 72\nSee details above.";
    assert.equal(parseReviewScore(text), 72);
  });

  it("returns undefined for no match", () => {
    assert.equal(parseReviewScore("no score here"), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.equal(parseReviewScore(""), undefined);
  });

  it("returns undefined for score > 100", () => {
    assert.equal(parseReviewScore("SCORE: 150"), undefined);
  });

  it("returns 0 for SCORE: 0", () => {
    assert.equal(parseReviewScore("SCORE: 0"), 0);
  });

  it("takes first match when multiple scores present", () => {
    const text = "SCORE: 80\nSCORE: 90";
    assert.equal(parseReviewScore(text), 80);
  });
});
