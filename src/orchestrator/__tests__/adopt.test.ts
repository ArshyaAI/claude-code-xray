import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { SEED_GENOTYPE, type Genotype } from "../../genotype/schema.js";
import { showDiff, adopt } from "../adopt.js";

describe("adopt", () => {
  describe("showDiff", () => {
    it("shows unchanged fields as dim", () => {
      const lines = showDiff(SEED_GENOTYPE, SEED_GENOTYPE);
      // All lines should be dim (no arrows)
      for (const line of lines) {
        assert.ok(!line.includes("→"), `Expected no diff arrow in: ${line}`);
      }
    });

    it("shows changed fields with arrow", () => {
      const modified: Genotype = {
        ...SEED_GENOTYPE,
        budget: {
          max_cost_per_task_usd: 3.0,
          max_cost_per_round_usd: 30.0,
        },
      };
      const lines = showDiff(SEED_GENOTYPE, modified);
      const changedLines = lines.filter((l) => l.includes("→"));
      assert.ok(
        changedLines.length >= 1,
        "Should have at least one changed field",
      );
      assert.ok(
        changedLines.some((l) => l.includes("budget.max_cost_per_task_usd")),
        "Should show budget.max_cost_per_task_usd change",
      );
    });
  });

  describe("adopt into DB", () => {
    let testDir: string;
    let dbPath: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
      testDir = join(tmpdir(), `adopt-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      dbPath = join(testDir, "evo.db");
      originalEnv = process.env.FACTORY_DB;
      process.env.FACTORY_DB = dbPath;

      // Create schema
      const schemaPath = join(__dirname, "..", "..", "..", "evo", "schema.sql");
      if (existsSync(schemaPath)) {
        execSync(`sqlite3 '${dbPath}' < '${schemaPath}'`, {
          encoding: "utf-8",
        });
      } else {
        // Inline minimal schema
        execSync(
          `sqlite3 '${dbPath}' "CREATE TABLE IF NOT EXISTS genotypes (id TEXT PRIMARY KEY, parent_id TEXT, yaml TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','frontier','champion','cemetery')), niche TEXT, generation INTEGER NOT NULL);"`,
          { encoding: "utf-8" },
        );
      }

      // Seed champion
      const yaml = JSON.stringify(SEED_GENOTYPE).replace(/"/g, '""');
      execSync(
        `sqlite3 '${dbPath}' "INSERT INTO genotypes (id, parent_id, yaml, created_at, status, generation) VALUES ('gen-0000', NULL, '${yaml.replace(/'/g, "'\\''")}'  , '2026-03-20T00:00:00Z', 'champion', 0);"`,
        { encoding: "utf-8" },
      );
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.FACTORY_DB;
      } else {
        process.env.FACTORY_DB = originalEnv;
      }
      rmSync(testDir, { recursive: true, force: true });
    });

    it("inserts a valid genotype as frontier", () => {
      const imported: Genotype = {
        ...SEED_GENOTYPE,
        id: "gen-0099",
        parent_id: "gen-0000",
        budget: {
          max_cost_per_task_usd: 3.5,
          max_cost_per_round_usd: 25.0,
        },
      };

      // Write genotype to a temp file
      const jsonPath = join(testDir, "genotype.json");
      writeFileSync(jsonPath, JSON.stringify(imported));

      // Capture process.exit to prevent test from exiting
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => {
        exitCode = code;
      }) as never;

      try {
        adopt(jsonPath);
      } finally {
        process.exit = origExit;
      }

      // adopt only calls process.exit on error paths
      assert.ok(
        exitCode === undefined,
        `Expected no exit, got exit code: ${exitCode}`,
      );

      // Verify in DB
      const result = execSync(
        `sqlite3 '${dbPath}' "SELECT status, generation FROM genotypes WHERE id='gen-0099'"`,
        { encoding: "utf-8" },
      ).trim();
      assert.equal(result, "frontier|1");
    });
  });
});
