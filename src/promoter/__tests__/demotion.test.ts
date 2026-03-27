import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { checkDemotion } from "../protocol.js";

describe("checkDemotion", () => {
  it("does not demote with fewer than threshold consecutive losses", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.6, 0.8, 0.6], // 2 losses, 1 win
        consecutive_threshold: 3,
      },
      "gen-0004",
      "frontier",
      null,
    );
    assert.equal(result.should_demote, false);
    assert.equal(result.consecutive_losses, 1); // only last run is a loss
  });

  it("demotes after 3 consecutive losses", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.8, 0.6, 0.5, 0.4], // last 3 are losses
        consecutive_threshold: 3,
      },
      "gen-0004",
      "frontier",
      null,
    );
    assert.equal(result.should_demote, true);
    assert.equal(result.consecutive_losses, 3);
    assert.equal(result.new_champion_id, "gen-0004"); // parent restored
  });

  it("falls back to frontier when parent is in cemetery", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.5, 0.4, 0.3],
        consecutive_threshold: 3,
      },
      "gen-0004",
      "cemetery", // parent is dead
      "gen-0002", // best frontier
    );
    assert.equal(result.should_demote, true);
    assert.equal(result.new_champion_id, "gen-0002");
  });

  it("returns null champion when no parent and no frontier", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.5, 0.4, 0.3],
        consecutive_threshold: 3,
      },
      null,
      null,
      null,
    );
    assert.equal(result.should_demote, true);
    assert.equal(result.new_champion_id, null);
  });

  it("counts consecutive losses from the end", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.5, 0.8, 0.5, 0.6], // win breaks the streak
        consecutive_threshold: 3,
      },
      "gen-0004",
      "frontier",
      null,
    );
    assert.equal(result.should_demote, false);
    assert.equal(result.consecutive_losses, 2);
  });

  it("handles empty utilities array", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [],
        consecutive_threshold: 3,
      },
      "gen-0004",
      "frontier",
      null,
    );
    assert.equal(result.should_demote, false);
    assert.equal(result.consecutive_losses, 0);
  });

  it("includes evidence in result", () => {
    const result = checkDemotion(
      {
        genotype_id: "gen-0005",
        champion_utility: 0.7,
        candidate_utilities: [0.5, 0.4, 0.3],
        consecutive_threshold: 3,
      },
      "gen-0004",
      "frontier",
      null,
    );
    assert.equal(result.evidence.champion_u, 0.7);
    assert.deepEqual(result.evidence.candidate_u, [0.5, 0.4, 0.3]);
  });
});
