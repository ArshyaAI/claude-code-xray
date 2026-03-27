-- 002-shadow.sql — Shadow League tables
-- Extends the frozen schema.sql (v1.0) with Shadow League run tracking.
-- Apply after schema.sql. Safe to run multiple times (IF NOT EXISTS).

PRAGMA foreign_keys = ON;

-- Shadow League run metadata
CREATE TABLE IF NOT EXISTS shadow_runs (
  id          TEXT PRIMARY KEY,              -- "run-20260327-001"
  repo        TEXT NOT NULL,                 -- repo path or slug
  archetype   TEXT NOT NULL,                 -- from factory.yaml
  started_at  TEXT NOT NULL,                 -- ISO 8601
  completed_at TEXT,                         -- ISO 8601, NULL while running
  budget_cap  REAL NOT NULL,                 -- run-level budget cap USD
  actual_cost REAL NOT NULL DEFAULT 0.0,     -- cumulative spend
  task_count  INTEGER NOT NULL DEFAULT 0,    -- number of tasks in this run
  crew_count  INTEGER NOT NULL DEFAULT 0,    -- number of crews
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'completed', 'budget_exceeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_shadow_runs_status ON shadow_runs(status);
CREATE INDEX IF NOT EXISTS idx_shadow_runs_repo   ON shadow_runs(repo);

-- Per-crew-per-task attempt records
CREATE TABLE IF NOT EXISTS shadow_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES shadow_runs(id),
  genotype_id   TEXT NOT NULL REFERENCES genotypes(id),
  task_hash     TEXT NOT NULL,               -- SHA-256 of task description
  task_desc     TEXT NOT NULL,               -- task description text
  worktree_path TEXT,                        -- path to crew worktree
  evaluation_id INTEGER REFERENCES evaluations(id), -- linked scoring record
  cost_usd      REAL NOT NULL DEFAULT 0.0,
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  completed_at  TEXT,                        -- NULL while running
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'timeout'))
);

CREATE INDEX IF NOT EXISTS idx_shadow_attempts_run      ON shadow_attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_shadow_attempts_genotype ON shadow_attempts(genotype_id);
CREATE INDEX IF NOT EXISTS idx_shadow_attempts_task     ON shadow_attempts(task_hash);

-- Bump schema version
INSERT OR REPLACE INTO schema_meta (key, value) VALUES
  ('shadow_schema_version', '1.0'),
  ('shadow_applied_at', datetime('now'));
