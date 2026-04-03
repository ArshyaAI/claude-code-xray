import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateGuardian } from "../generate.js";
import { renderGuardian } from "../sprites.js";
import { SPECIES, STAGES, EYES } from "../types.js";
import type { GuardianBones, Stage } from "../types.js";

// ─── Deterministic generation ─────────────────────────────────────────────

describe("generateGuardian", () => {
  it("same repo path always produces the same eye", () => {
    const a = generateGuardian("/home/user/project-a", 50, "ts-lib");
    const b = generateGuardian("/home/user/project-a", 50, "ts-lib");
    assert.equal(a.eye, b.eye);
    assert.equal(a.shiny, b.shiny);
  });

  it("different repo paths may produce different eyes", () => {
    const a = generateGuardian("/repo/alpha", 50, "ts-lib");
    const b = generateGuardian("/repo/beta", 50, "ts-lib");
    // They CAN be the same by chance, but the hash should differ.
    // Just verify both are valid eyes.
    assert.ok(
      (EYES as readonly string[]).includes(a.eye),
      `eye '${a.eye}' should be a valid eye`,
    );
    assert.ok(
      (EYES as readonly string[]).includes(b.eye),
      `eye '${b.eye}' should be a valid eye`,
    );
  });

  it("score does not affect eye selection", () => {
    const a = generateGuardian("/stable/repo", 10, "ts-lib");
    const b = generateGuardian("/stable/repo", 90, "ts-lib");
    assert.equal(a.eye, b.eye);
    assert.equal(a.shiny, b.shiny);
  });
});

// ─── Stage assignment ─────────────────────────────────────────────────────

describe("stage assignment", () => {
  const cases: Array<{ score: number; expected: Stage }> = [
    { score: 0, expected: "exposed" },
    { score: 15, expected: "exposed" },
    { score: 29, expected: "exposed" },
    { score: 30, expected: "guarded" },
    { score: 45, expected: "guarded" },
    { score: 59, expected: "guarded" },
    { score: 60, expected: "fortified" },
    { score: 70, expected: "fortified" },
    { score: 79, expected: "fortified" },
    { score: 80, expected: "sentinel" },
    { score: 95, expected: "sentinel" },
    { score: 100, expected: "sentinel" },
  ];

  for (const { score, expected } of cases) {
    it(`score ${score} -> stage '${expected}'`, () => {
      const g = generateGuardian("/test", score, "ts-lib");
      assert.equal(g.stage, expected);
    });
  }
});

// ─── Archetype -> Species mapping ─────────────────────────────────────────

describe("archetype to species mapping", () => {
  const mapping: Array<{ archetype: string; expected: string }> = [
    { archetype: "ts-lib", expected: "owl" },
    { archetype: "nextjs-app", expected: "owl" },
    { archetype: "react-app", expected: "owl" },
    { archetype: "python-app", expected: "dragon" },
    { archetype: "rust-cli", expected: "crab" },
    { archetype: "go-service", expected: "ghost" },
    { archetype: "shopify-theme", expected: "fox" },
    { archetype: "docker-service", expected: "ghost" },
    { archetype: "unknown", expected: "fox" },
    { archetype: "something-unrecognized", expected: "shield" },
  ];

  for (const { archetype, expected } of mapping) {
    it(`archetype '${archetype}' -> species '${expected}'`, () => {
      const g = generateGuardian("/test", 50, archetype);
      assert.equal(g.species, expected);
    });
  }
});

// ─── Sprite rendering ─────────────────────────────────────────────────────

describe("renderGuardian", () => {
  it("returns exactly 5 lines for every species/stage combo", () => {
    for (const species of SPECIES) {
      for (const stage of STAGES) {
        const bones: GuardianBones = {
          species,
          stage,
          eye: "\u00B7",
          shiny: false,
        };
        for (let frame = 0; frame < 3; frame++) {
          const lines = renderGuardian(bones, frame);
          assert.equal(
            lines.length,
            5,
            `${species}/${stage} frame ${frame} should have 5 lines, got ${lines.length}`,
          );
        }
      }
    }
  });

  it("replaces {E} placeholder with the eye character", () => {
    const bones: GuardianBones = {
      species: "owl",
      stage: "guarded",
      eye: "\u25C9",
      shiny: false,
    };
    const lines = renderGuardian(bones, 0);
    const joined = lines.join("\n");
    assert.ok(!joined.includes("{E}"), "should not contain {E} placeholder");
    assert.ok(joined.includes("\u25C9"), "should contain the eye character");
  });

  it("frame wraps around correctly", () => {
    const bones: GuardianBones = {
      species: "shield",
      stage: "exposed",
      eye: "\u00B7",
      shiny: false,
    };
    const frame0 = renderGuardian(bones, 0);
    const frame3 = renderGuardian(bones, 3);
    assert.deepEqual(frame0, frame3, "frame 3 should wrap to frame 0");
  });

  it("different frames have at least one different line", () => {
    const bones: GuardianBones = {
      species: "ghost",
      stage: "fortified",
      eye: "\u2605",
      shiny: false,
    };
    const frame0 = renderGuardian(bones, 0);
    const frame1 = renderGuardian(bones, 1);
    const same = frame0.every((line, i) => line === frame1[i]);
    assert.ok(!same, "frame 0 and 1 should differ in at least one line");
  });
});

// ─── GuardianBones shape ──────────────────────────────────────────────────

describe("GuardianBones shape", () => {
  it("has all required fields", () => {
    const bones = generateGuardian("/test", 50, "ts-lib");
    assert.ok(
      (SPECIES as readonly string[]).includes(bones.species),
      "species should be valid",
    );
    assert.ok(
      (STAGES as readonly string[]).includes(bones.stage),
      "stage should be valid",
    );
    assert.ok(
      (EYES as readonly string[]).includes(bones.eye),
      "eye should be valid",
    );
    assert.equal(typeof bones.shiny, "boolean");
  });
});
