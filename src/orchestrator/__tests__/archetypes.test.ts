import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { getArchetypeDefaults } from "../archetypes.js";
import type { Archetype } from "../config.js";

describe("getArchetypeDefaults", () => {
  const ALL_ARCHETYPES: Archetype[] = [
    "ts-lib",
    "nextjs-app",
    "react-app",
    "rust-cli",
    "go-service",
    "python-app",
  ];

  it("returns defaults for every valid archetype", () => {
    for (const arch of ALL_ARCHETYPES) {
      const defaults = getArchetypeDefaults(arch);
      assert.ok(defaults, `Missing defaults for ${arch}`);
      assert.equal(typeof defaults.throughput_max, "number");
      assert.equal(typeof defaults.expected_build_time_sec, "number");
      assert.equal(typeof defaults.expected_test_time_sec, "number");
      assert.equal(typeof defaults.cost_multiplier, "number");
    }
  });

  it("ts-lib is the baseline with cost_multiplier 1.0", () => {
    const d = getArchetypeDefaults("ts-lib");
    assert.equal(d.throughput_max, 10);
    assert.equal(d.cost_multiplier, 1.0);
  });

  it("nextjs-app has lower throughput ceiling than ts-lib", () => {
    const tsLib = getArchetypeDefaults("ts-lib");
    const nextjs = getArchetypeDefaults("nextjs-app");
    assert.ok(
      nextjs.throughput_max < tsLib.throughput_max,
      `nextjs-app throughput_max (${nextjs.throughput_max}) should be less than ts-lib (${tsLib.throughput_max})`,
    );
  });

  it("go-service has the highest throughput ceiling", () => {
    const go = getArchetypeDefaults("go-service");
    for (const arch of ALL_ARCHETYPES) {
      const d = getArchetypeDefaults(arch);
      assert.ok(
        go.throughput_max >= d.throughput_max,
        `go-service throughput_max (${go.throughput_max}) should be >= ${arch} (${d.throughput_max})`,
      );
    }
  });

  it("all throughput_max values are positive", () => {
    for (const arch of ALL_ARCHETYPES) {
      const d = getArchetypeDefaults(arch);
      assert.ok(d.throughput_max > 0, `${arch} throughput_max must be > 0`);
    }
  });

  it("all cost_multipliers are positive", () => {
    for (const arch of ALL_ARCHETYPES) {
      const d = getArchetypeDefaults(arch);
      assert.ok(d.cost_multiplier > 0, `${arch} cost_multiplier must be > 0`);
    }
  });

  it("expected times are positive for all archetypes", () => {
    for (const arch of ALL_ARCHETYPES) {
      const d = getArchetypeDefaults(arch);
      assert.ok(d.expected_build_time_sec > 0);
      assert.ok(d.expected_test_time_sec > 0);
    }
  });
});
