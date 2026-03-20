#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# evaluate.sh — DeFactory Evaluator Main Orchestrator
#
# IMMUTABLE: This file is read-only from agents (enforced by policy.yml).
# Changes require board approval and a new policy.yml freeze cycle.
#
# Entry point for the Evaluator agent heartbeat. Orchestrates:
#   1. Hard gates (run-gates.sh)
#   2. Layer 1 scoring (score-layer1.js)
#   3. Layer 2 holdout (layer2-holdout.js) — only if stage != search
#   4. score.json write
#   5. evo.db INSERT (write-eval.py)
#
# Usage:
#   ./evo/evaluator/evaluate.sh \
#     --genotype-id gen-0042 \
#     --task-id DEFA-15 \
#     --stage search \
#     --workspace /tmp/eval-workspace/repo \
#     --output /tmp/eval-workspace/output \
#     [--review-score 85] \
#     [--metrics-json /path/to/metrics.json]
#
# Exit codes:
#   0 = Frontier-eligible (all gates passed, Layer 1 scored)
#   1 = Rejected (gate failure or Layer 2 fail)
#   2 = Blocked (needs external input — G_review pending)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────
GENOTYPE_ID=""
TASK_ID=""
STAGE="search"
WORKSPACE=""
OUTPUT_DIR=""
REVIEW_SCORE=""
METRICS_JSON=""
EVO_DB="${FACTORY_EVO_DB:-$HOME/.factory/evo.db}"
START_TIME=$(date +%s)

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --genotype-id)  GENOTYPE_ID="$2";  shift 2 ;;
    --task-id)      TASK_ID="$2";      shift 2 ;;
    --stage)        STAGE="$2";        shift 2 ;;
    --workspace)    WORKSPACE="$2";    shift 2 ;;
    --output)       OUTPUT_DIR="$2";   shift 2 ;;
    --review-score) REVIEW_SCORE="$2"; shift 2 ;;
    --metrics-json) METRICS_JSON="$2"; shift 2 ;;
    --db)           EVO_DB="$2";       shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Validate required args ────────────────────────────────────────────────────
error_missing() { echo "ERROR: $1 is required" >&2; exit 1; }
[[ -z "$GENOTYPE_ID" ]] && error_missing "--genotype-id"
[[ -z "$TASK_ID"     ]] && error_missing "--task-id"
[[ -z "$WORKSPACE"   ]] && error_missing "--workspace"
[[ -z "$OUTPUT_DIR"  ]] && error_missing "--output"

# Validate stage
case "$STAGE" in
  search|hidden|shadow|canary) ;;
  *) echo "ERROR: --stage must be one of: search, hidden, shadow, canary" >&2; exit 1 ;;
esac

mkdir -p "$OUTPUT_DIR"

SCORE_JSON="$OUTPUT_DIR/score.json"
GATES_JSON="$OUTPUT_DIR/gates.json"
L2_JSON="$OUTPUT_DIR/layer2.json"
EVAL_LOG="$OUTPUT_DIR/evaluate.log"

exec > >(tee -a "$EVAL_LOG") 2>&1

echo "════════════════════════════════════════════════════════════════"
echo "DeFactory Evaluator — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  genotype:  $GENOTYPE_ID"
echo "  task:      $TASK_ID"
echo "  stage:     $STAGE"
echo "  workspace: $WORKSPACE"
echo "  output:    $OUTPUT_DIR"
echo "════════════════════════════════════════════════════════════════"

# ── Helper: write rejection score.json and persist ───────────────────────────
reject() {
  local reason="$1"
  local failed_gate="${2:-null}"

  echo ""
  echo "VERDICT: REJECTED — $reason"

  # Build rejection score.json
  python3 - <<PY
import json, sys
score = {
    "genotype_id": "$GENOTYPE_ID",
    "task_id":     "$TASK_ID",
    "stage":       "$STAGE",
    "gates_passed": False,
    "scores":      None,
    "utility":     0.0,
    "verdict":     "rejected",
    "reject_reason": "$reason",
    "failed_gate": $([ "$failed_gate" = "null" ] && echo "None" || echo '"'"$failed_gate"'"'),
    "cost_usd":    0.0,
    "duration_sec": 0
}
with open("$SCORE_JSON", "w") as f:
    json.dump(score, f, indent=2)
print(json.dumps(score, indent=2))
PY

  # Persist to evo.db
  python3 "$SCRIPT_DIR/write-eval.py" \
    --score-json "$SCORE_JSON" \
    --db "$EVO_DB" \
    --cemetery-reason "$reason" || true

  exit 1
}

# ── Step 1: Hard gates ────────────────────────────────────────────────────────
echo ""
echo "── STEP 1: Hard Gates ──────────────────────────────────────────"

GATE_ARGS=(--workspace "$WORKSPACE")
[[ -n "$REVIEW_SCORE" ]] && GATE_ARGS+=(--review-score "$REVIEW_SCORE")

GATE_EXIT=0
bash "$SCRIPT_DIR/run-gates.sh" "${GATE_ARGS[@]}" > "$GATES_JSON" || GATE_EXIT=$?

if [[ "$GATE_EXIT" -eq 2 ]]; then
  echo ""
  echo "BLOCKED: G_review pending — Reviewer agent must supply review score."
  exit 2
fi

if [[ "$GATE_EXIT" -ne 0 ]]; then
  FAILED=$(python3 -c "import json,sys; d=json.load(open('$GATES_JSON')); print(d.get('failed_gate','unknown'))" 2>/dev/null || echo "unknown")
  reject "Hard gate failed: $FAILED" "$FAILED"
fi

echo "Gates: all passed."

# ── Step 2: Collect metrics ───────────────────────────────────────────────────
echo ""
echo "── STEP 2: Metrics Collection ──────────────────────────────────"

# If a metrics JSON was provided (from QA agent or build tooling), use it.
# Otherwise, compute lightweight defaults from the workspace.
if [[ -n "$METRICS_JSON" ]] && [[ -f "$METRICS_JSON" ]]; then
  echo "Using provided metrics JSON: $METRICS_JSON"
  METRICS=$(cat "$METRICS_JSON")
else
  echo "No --metrics-json provided. Computing lightweight defaults..."
  METRICS=$(python3 - "$WORKSPACE" <<'PY'
import os, sys, json, subprocess, pathlib

ws = sys.argv[1]

def count_lines(path, pattern):
    try:
        r = subprocess.run(["grep", "-r", pattern, path, "--include=*.ts", "--include=*.js",
                            "--exclude-dir=node_modules", "--exclude-dir=.git", "-c"],
                           capture_output=True, text=True)
        return sum(int(l.split(":")[-1]) for l in r.stdout.strip().split("\n") if ":" in l)
    except Exception:
        return 0

def count_files(path, ext):
    try:
        return sum(1 for _ in pathlib.Path(path).rglob(ext)
                   if "node_modules" not in str(_) and ".git" not in str(_))
    except Exception:
        return 0

src_files = count_files(ws, "*.ts") + count_files(ws, "*.js")
test_files = count_files(ws, "*.test.ts") + count_files(ws, "*.test.js") + \
             count_files(ws, "*.spec.ts") + count_files(ws, "*.spec.js")

doc_lines = count_lines(ws, r"/\*\*")
total_lines = max(1, count_lines(ws, ""))
doc_coverage = min(1.0, doc_lines / max(1, src_files) * 0.5)  # crude estimate

metrics = {
    "lint_violations_weighted": 0.0,    # gates already verified lint passed
    "cyclomatic_complexity": 1.0,       # conservative default
    "doc_coverage": round(doc_coverage, 3),
    "diff_hunk_coverage": round(min(1.0, test_files / max(1, src_files)), 3),
    "mutation_score": 0.5,              # default — real value from QA agent
    "hidden_holdout_pass_rate": 0.0,    # will be overwritten after Layer 2
    "human_approvals": 0,
    "human_rejections": 0,
    "convention_violations": 0,
    "kloc": round(total_lines / 1000, 2),
    "items_completed": 1,
    "time_hours": 1.0,
    "throughput_max": 10.0,
    "cost_per_item_usd": 0.50,
    "budget_per_item_usd": 2.00,
    "guardrails_passed": True
}
print(json.dumps(metrics))
PY
)
fi

echo "Metrics: $(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); print({k:d[k] for k in list(d)[:5]})" 2>/dev/null || echo "(see metrics file)")"

# ── Step 3: Layer 2 holdout (hidden stage only) ───────────────────────────────
echo ""
echo "── STEP 3: Layer 2 Holdout ─────────────────────────────────────"

HCOV=0.0
if [[ "$STAGE" != "search" ]]; then
  echo "Running Layer 2 hidden holdout (stage=$STAGE)..."
  L2_EXIT=0
  node "$SCRIPT_DIR/layer2-holdout.js" --workspace "$WORKSPACE" --output "$L2_JSON" || L2_EXIT=$?

  HCOV=$(python3 -c "import json; d=json.load(open('$L2_JSON')); print(d['hcov'])" 2>/dev/null || echo "0.0")
  L2_VERDICT=$(python3 -c "import json; d=json.load(open('$L2_JSON')); print(d['verdict'])" 2>/dev/null || echo "fail")

  echo "Layer 2: hcov=$HCOV verdict=$L2_VERDICT"

  if [[ "$L2_EXIT" -ne 0 ]]; then
    reject "Layer 2 holdout failed (hcov=$HCOV < 0.70)" "G_layer2"
  fi
else
  echo "Stage=search — Layer 2 skipped. hcov=0.0 (will not count in R score)."
fi

# ── Step 4: Layer 1 scoring ───────────────────────────────────────────────────
echo ""
echo "── STEP 4: Layer 1 Scoring (R_search) ─────────────────────────"

# Merge hcov into metrics
METRICS=$(echo "$METRICS" | python3 -c "
import sys, json
m = json.load(sys.stdin)
m['hidden_holdout_pass_rate'] = $HCOV
print(json.dumps(m))
")

# Build score-layer1 input
L1_INPUT=$(python3 - <<PY
import json, sys
gates = json.load(open("$GATES_JSON"))
metrics = json.loads('''$METRICS''')
inp = {
    "genotype_id": "$GENOTYPE_ID",
    "task_id":     "$TASK_ID",
    "stage":       "$STAGE",
    "gates": {
        "G_build":  gates.get("G_build", False),
        "G_test":   gates.get("G_test", False),
        "G_lint":   gates.get("G_lint", False),
        "G_review": gates.get("G_review", False),
        "G_safe":   gates.get("G_safe", False),
    },
    "metrics": metrics,
}
print(json.dumps(inp))
PY
)

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

L1_OUTPUT=$(echo "$L1_INPUT" | node "$SCRIPT_DIR/score-layer1.js")
echo "$L1_OUTPUT"

# ── Step 5: Build final score.json ────────────────────────────────────────────
echo ""
echo "── STEP 5: Writing score.json ──────────────────────────────────"

python3 - <<PY
import json

l1 = json.loads('''$L1_OUTPUT''')
verdict = "frontier" if l1["gates_passed"] and not l1["pareto_dominated"] else "rejected"

score = {
    "genotype_id":   l1["genotype_id"],
    "task_id":       l1["task_id"],
    "stage":         l1["stage"],
    "gates_passed":  l1["gates_passed"],
    "scores":        l1["scores"],
    "utility":       round(l1["utility"], 4),
    "pareto_dominated": l1["pareto_dominated"],
    "verdict":       verdict,
    "reject_reason": l1["reject_reason"],
    "cost_usd":      0.50,
    "duration_sec":  $DURATION,
}

with open("$SCORE_JSON", "w") as f:
    json.dump(score, f, indent=2)

print(json.dumps(score, indent=2))
PY

# ── Step 6: Persist to evo.db ─────────────────────────────────────────────────
echo ""
echo "── STEP 6: Persisting to evo.db ────────────────────────────────"

VERDICT=$(python3 -c "import json; print(json.load(open('$SCORE_JSON'))['verdict'])" 2>/dev/null || echo "rejected")

if [[ "$VERDICT" == "rejected" ]]; then
  REASON=$(python3 -c "import json; print(json.load(open('$SCORE_JSON')).get('reject_reason','unknown'))" 2>/dev/null || echo "unknown")
  python3 "$SCRIPT_DIR/write-eval.py" \
    --score-json "$SCORE_JSON" \
    --db "$EVO_DB" \
    --cemetery-reason "$REASON"
else
  python3 "$SCRIPT_DIR/write-eval.py" \
    --score-json "$SCORE_JSON" \
    --db "$EVO_DB"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
UTILITY=$(python3 -c "import json; print(json.load(open('$SCORE_JSON'))['utility'])" 2>/dev/null || echo "0.0")
echo "VERDICT: $VERDICT"
echo "Utility: $UTILITY"
echo "Duration: ${DURATION}s"
echo "Output: $SCORE_JSON"
echo "════════════════════════════════════════════════════════════════"

if [[ "$VERDICT" == "rejected" ]]; then
  exit 1
fi

exit 0
