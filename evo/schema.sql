-- schema.sql — DeFactory Evolution Engine Database Schema
-- Version: 1.0 | Date: 2026-03-20 | Status: FROZEN
--
-- This schema is IMMUTABLE. Changes require board approval.
-- Read-only from all agents (enforced by policy.yml read_only_paths).
-- Apply with: sqlite3 ~/.factory/evo.db < evo/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Genotypes ────────────────────────────────────────────────────────────────
-- The evolutionary record. Each row is one complete agent-company config.
CREATE TABLE IF NOT EXISTS genotypes (
  id            TEXT PRIMARY KEY,         -- "gen-0042"
  parent_id     TEXT,                     -- "gen-0038" or NULL for seed
  yaml          TEXT NOT NULL,            -- full genotype YAML
  created_at    TEXT NOT NULL,            -- ISO 8601
  status        TEXT NOT NULL            -- 'active'|'frontier'|'champion'|'cemetery'
                CHECK (status IN ('active','frontier','champion','cemetery')),
  niche         TEXT,                     -- e.g. "typescript-backend" or "docs-only"
  generation    INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES genotypes(id)
);

CREATE INDEX IF NOT EXISTS idx_genotypes_status   ON genotypes(status);
CREATE INDEX IF NOT EXISTS idx_genotypes_niche    ON genotypes(niche);
CREATE INDEX IF NOT EXISTS idx_genotypes_created  ON genotypes(created_at);

-- ─── Evaluations ──────────────────────────────────────────────────────────────
-- Scoring records for each genotype x task pair.
CREATE TABLE IF NOT EXISTS evaluations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  genotype_id   TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  stage         TEXT NOT NULL            -- 'search'|'hidden'|'shadow'|'canary'
                CHECK (stage IN ('search','hidden','shadow','canary')),
  scores        TEXT NOT NULL,           -- JSON: {"C":0.8,"R":0.9,"H":0.7,"Q":0.85,"T":0.6,"K":0.9,"S":1.0}
  utility       REAL NOT NULL,           -- weighted sum U(p)
  gates_passed  INTEGER NOT NULL DEFAULT 1, -- 1 if all hard gates passed, 0 otherwise
  cost_usd      REAL NOT NULL,
  duration_sec  INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (genotype_id) REFERENCES genotypes(id)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_genotype ON evaluations(genotype_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_stage    ON evaluations(stage);
CREATE INDEX IF NOT EXISTS idx_evaluations_task     ON evaluations(task_id);

-- ─── Promotions ───────────────────────────────────────────────────────────────
-- Records of champion challenges and their outcomes.
CREATE TABLE IF NOT EXISTS promotions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  winner_id     TEXT NOT NULL,
  loser_id      TEXT NOT NULL,
  stage         TEXT NOT NULL,           -- which stage decided it
  evidence      TEXT NOT NULL,           -- JSON: {p_value, t_stat, ci_lower, ci_upper, n_tasks}
  created_at    TEXT NOT NULL,
  FOREIGN KEY (winner_id) REFERENCES genotypes(id),
  FOREIGN KEY (loser_id)  REFERENCES genotypes(id)
);

-- ─── Conventions ──────────────────────────────────────────────────────────────
-- Extracted coding patterns moving through the confirmation lifecycle.
CREATE TABLE IF NOT EXISTS conventions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,
  status        TEXT NOT NULL           -- 'observation'|'candidate'|'promoted'|'rejected'|'revoked'
                CHECK (status IN ('observation','candidate','promoted','rejected','revoked')),
  confirmations INTEGER DEFAULT 1,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  scope         TEXT NOT NULL,          -- 'repo:connectos' or 'cross-repo'
  confidence    REAL DEFAULT 0.5        -- 0.0-1.0
                CHECK (confidence >= 0.0 AND confidence <= 1.0),
  pr_url        TEXT,                   -- link to promotion PR
  revocation    TEXT                    -- reason if revoked
);

CREATE INDEX IF NOT EXISTS idx_conventions_status     ON conventions(status);
CREATE INDEX IF NOT EXISTS idx_conventions_confidence ON conventions(confidence);

-- ─── Memory ───────────────────────────────────────────────────────────────────
-- Persistent agent memory: rules, evidence, observations, procedures.
CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL           -- 'rule'|'evidence'|'observation'|'procedure'
                CHECK (type IN ('rule','evidence','observation','procedure')),
  content       TEXT NOT NULL,
  scope         TEXT NOT NULL,          -- repo slug or 'global'
  confidence    REAL DEFAULT 0.5
                CHECK (confidence >= 0.0 AND confidence <= 1.0),
  ttl_days      INTEGER DEFAULT 30,
  created_at    TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count  INTEGER DEFAULT 0,
  superseded_by INTEGER,                -- FK to newer memory entry
  FOREIGN KEY (superseded_by) REFERENCES memory(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_type       ON memory(type);
CREATE INDEX IF NOT EXISTS idx_memory_scope      ON memory(scope);
CREATE INDEX IF NOT EXISTS idx_memory_confidence ON memory(confidence);
CREATE INDEX IF NOT EXISTS idx_memory_accessed   ON memory(last_accessed);

-- ─── Cemetery ─────────────────────────────────────────────────────────────────
-- Failed genotypes with causal notes for future search guidance.
CREATE TABLE IF NOT EXISTS cemetery (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  genotype_id   TEXT NOT NULL,
  cause         TEXT NOT NULL,          -- why it failed
  stage         TEXT NOT NULL,          -- where it failed
  scores        TEXT NOT NULL,          -- JSON of final scores
  lessons       TEXT,                   -- causal notes for future exploration
  created_at    TEXT NOT NULL,
  FOREIGN KEY (genotype_id) REFERENCES genotypes(id)
);

CREATE INDEX IF NOT EXISTS idx_cemetery_genotype ON cemetery(genotype_id);
CREATE INDEX IF NOT EXISTS idx_cemetery_stage    ON cemetery(stage);

-- ─── Schema Version ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta (key, value) VALUES
  ('schema_version', '1.0'),
  ('frozen_at', '2026-03-20T00:00:00Z'),
  ('bible_version', '1.0');
