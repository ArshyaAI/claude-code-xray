#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# init-evo-db.sh — Initialize evo.db and stamp policy.yml with its sha256
#
# Usage: ./evo/init-evo-db.sh [--db-path PATH]
#
# Creates or migrates ~/.factory/evo.db. Safe to run multiple times (idempotent).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DB_PATH="${FACTORY_EVO_DB:-$HOME/.factory/evo.db}"
SCHEMA_FILE="$SCRIPT_DIR/schema.sql"
POLICY_FILE="$REPO_ROOT/config/policy.yml"

# ── Ensure sqlite3 is available ──────────────────────────────────────────────
if ! command -v sqlite3 &>/dev/null; then
  echo "ERROR: sqlite3 not found. Install it with: brew install sqlite3" >&2
  exit 1
fi

# ── Create parent directory ───────────────────────────────────────────────────
mkdir -p "$(dirname "$DB_PATH")"

# ── Apply schema ──────────────────────────────────────────────────────────────
echo "Initializing evo.db at $DB_PATH ..."
sqlite3 "$DB_PATH" < "$SCHEMA_FILE"
echo "  Schema applied."

# ── Compute and stamp policy.yml sha256 ──────────────────────────────────────
# This creates a tamper-evident seal on the frozen policy contract.
if command -v sha256sum &>/dev/null; then
  POLICY_HASH=$(sha256sum "$POLICY_FILE" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
  POLICY_HASH=$(shasum -a 256 "$POLICY_FILE" | awk '{print $1}')
else
  echo "WARNING: No sha256 tool found. Skipping policy hash stamp." >&2
  POLICY_HASH="unavailable"
fi

# Store hash in schema_meta
sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('policy_yml_sha256', '$POLICY_HASH');"
echo "  policy.yml sha256: $POLICY_HASH"

# Update the sha256_self field in policy.yml
if [[ "$POLICY_HASH" != "unavailable" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|sha256_self: .*|sha256_self: \"$POLICY_HASH\"|" "$POLICY_FILE"
  else
    sed -i "s|sha256_self: .*|sha256_self: \"$POLICY_HASH\"|" "$POLICY_FILE"
  fi
  echo "  Stamped policy.yml with sha256_self."
fi

# ── Seed champion genotype (gen-0000) ─────────────────────────────────────────
# This is the baseline genotype derived from current BIBLE.md values.
EXISTING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM genotypes WHERE id='gen-0000';")
if [[ "$EXISTING" == "0" ]]; then
  SEED_YAML=$(cat <<'YAML'
version: 1
id: "gen-0000"
parent_id: null
created_at: "2026-03-20T00:00:00Z"

model_routing:
  ceo: "claude-opus-4-6"
  cto: "claude-opus-4-6"
  builder: "claude-sonnet-4-6"
  reviewer: "codex-xhigh"
  qa: "claude-sonnet-4-6"
  explorer: "claude-sonnet-4-6"

prompt_policy:
  builder_system: "default-v1"
  reviewer_system: "default-v1"
  qa_system: "default-v1"

tool_policy:
  builder_tools: ["read", "edit", "bash", "glob", "grep"]
  reviewer_tools: ["read", "grep", "glob"]

cadence:
  explorer_batch_interval_min: 60
  evaluator_interval_min: 60
  memory_curator_interval_min: 120
  audit_interval_min: 240

permissions:
  auto_merge_safe: true
  max_files_per_task: 5
  max_commits_per_sprint: 30

memory_retrieval:
  max_conventions_in_context: 20
  memory_decay_days: 30
  cross_repo_inheritance: true

review_strategy:
  require_cross_model: true
  min_review_score: 80

budget:
  max_cost_per_task_usd: 2.00
  max_cost_per_round_usd: 20.00
YAML
)
  python3 - "$DB_PATH" "$SEED_YAML" <<'PY'
import sys, sqlite3
db_path = sys.argv[1]
yaml_content = sys.argv[2]
conn = sqlite3.connect(db_path)
conn.execute(
    "INSERT INTO genotypes (id, parent_id, yaml, created_at, status, niche, generation) VALUES (?,?,?,?,?,?,?)",
    ("gen-0000", None, yaml_content, "2026-03-20T00:00:00Z", "champion", "typescript-backend", 0)
)
conn.commit()
conn.close()
PY
  echo "  Seeded champion genotype gen-0000."
else
  echo "  Champion genotype gen-0000 already exists. Skipping seed."
fi

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "evo.db status:"
sqlite3 "$DB_PATH" "
SELECT 'Tables: ' || group_concat(name, ', ') FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';
SELECT 'Genotypes: ' || COUNT(*) FROM genotypes;
SELECT 'Schema version: ' || value FROM schema_meta WHERE key='schema_version';
SELECT 'Policy sha256: ' || value FROM schema_meta WHERE key='policy_yml_sha256';
"

echo ""
echo "Done. evo.db ready at $DB_PATH"
