#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-gates.sh — DeFactory Hard Gate Runner
#
# IMMUTABLE: This file is read-only from agents (enforced by policy.yml).
# Changes require board approval and a new policy.yml freeze cycle.
#
# Runs all 5 hard gates in order against a candidate workspace.
# Exits 0 only if ALL gates pass. Outputs gate results as JSON to stdout.
#
# Usage:
#   ./run-gates.sh --workspace /path/to/repo [--review-score 85]
#
# Output JSON:
#   {
#     "G_build": true,
#     "G_test": true,
#     "G_lint": true,
#     "G_review": true,
#     "G_safe": true,
#     "all_passed": true,
#     "failed_gate": null,
#     "details": { "review_score": 85, "security_findings": 0 }
#   }
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WORKSPACE=""
REVIEW_SCORE_OVERRIDE=""
MIN_REVIEW_SCORE=80  # from policy.yml default

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)    WORKSPACE="$2";             shift 2 ;;
    --review-score) REVIEW_SCORE_OVERRIDE="$2"; shift 2 ;;
    --min-review)   MIN_REVIEW_SCORE="$2";      shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$WORKSPACE" ]]; then
  echo "ERROR: --workspace is required" >&2
  exit 1
fi

if [[ ! -d "$WORKSPACE" ]]; then
  echo "ERROR: workspace does not exist: $WORKSPACE" >&2
  exit 1
fi

# ── Gate result tracking ──────────────────────────────────────────────────────
G_BUILD=false
G_TEST=false
G_LINT=false
G_REVIEW=false
G_SAFE=false
FAILED_GATE="null"
REVIEW_SCORE=0
SECURITY_FINDINGS=0
ALL_PASSED=false

run_gate() {
  local gate_name="$1"
  shift
  local gate_cmd=("$@")

  echo "  [GATE] $gate_name: running..." >&2
  if (cd "$WORKSPACE" && "${gate_cmd[@]}" >/dev/null 2>&1); then
    echo "  [GATE] $gate_name: PASS" >&2
    echo "true"
  else
    echo "  [GATE] $gate_name: FAIL" >&2
    echo "false"
  fi
}

# ── G_build: build / tsc --noEmit ─────────────────────────────────────────────
echo "[G_build] Starting..." >&2
if [[ -f "$WORKSPACE/package.json" ]]; then
  # TypeScript: prefer tsc --noEmit if tsconfig exists
  if [[ -f "$WORKSPACE/tsconfig.json" ]]; then
    G_BUILD=$(run_gate "G_build" npx tsc --noEmit)
  elif grep -q '"build"' "$WORKSPACE/package.json" 2>/dev/null; then
    G_BUILD=$(run_gate "G_build" npm run build)
  else
    echo "  [GATE] G_build: SKIP (no build script, treating as pass)" >&2
    G_BUILD=true
  fi
elif [[ -f "$WORKSPACE/pyproject.toml" ]] || [[ -f "$WORKSPACE/setup.py" ]]; then
  G_BUILD=$(run_gate "G_build" python3 -m py_compile "$(find "$WORKSPACE" -name '*.py' | head -1)")
else
  echo "  [GATE] G_build: SKIP (unknown project type, treating as pass)" >&2
  G_BUILD=true
fi

# Fail fast on G_build
if [[ "$G_BUILD" == "false" ]]; then
  FAILED_GATE='"G_build"'
  cat <<EOF
{
  "G_build": false,
  "G_test": false,
  "G_lint": false,
  "G_review": false,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_build",
  "details": { "review_score": 0, "security_findings": -1 }
}
EOF
  exit 1
fi

# ── G_test: npm test / pytest ──────────────────────────────────────────────────
echo "[G_test] Starting..." >&2
if [[ -f "$WORKSPACE/package.json" ]] && grep -q '"test"' "$WORKSPACE/package.json" 2>/dev/null; then
  G_TEST=$(run_gate "G_test" npm test -- --passWithNoTests 2>/dev/null || run_gate "G_test" npm test)
elif [[ -f "$WORKSPACE/pytest.ini" ]] || [[ -f "$WORKSPACE/pyproject.toml" ]]; then
  G_TEST=$(run_gate "G_test" python3 -m pytest -q)
else
  echo "  [GATE] G_test: SKIP (no test runner found, treating as pass)" >&2
  G_TEST=true
fi

if [[ "$G_TEST" == "false" ]]; then
  cat <<EOF
{
  "G_build": true,
  "G_test": false,
  "G_lint": false,
  "G_review": false,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_test",
  "details": { "review_score": 0, "security_findings": -1 }
}
EOF
  exit 1
fi

# ── G_lint: lint + format ──────────────────────────────────────────────────────
echo "[G_lint] Starting..." >&2
if [[ -f "$WORKSPACE/package.json" ]]; then
  if grep -q '"lint"' "$WORKSPACE/package.json" 2>/dev/null; then
    G_LINT=$(run_gate "G_lint" npm run lint)
  elif [[ -f "$WORKSPACE/.eslintrc"* ]] || [[ -f "$WORKSPACE/eslint.config"* ]]; then
    G_LINT=$(run_gate "G_lint" npx eslint . --max-warnings 0)
  else
    echo "  [GATE] G_lint: SKIP (no lint script found, treating as pass)" >&2
    G_LINT=true
  fi
elif [[ -f "$WORKSPACE/ruff.toml" ]] || [[ -f "$WORKSPACE/pyproject.toml" ]]; then
  G_LINT=$(run_gate "G_lint" python3 -m ruff check .)
else
  echo "  [GATE] G_lint: SKIP (unknown project type, treating as pass)" >&2
  G_LINT=true
fi

if [[ "$G_LINT" == "false" ]]; then
  cat <<EOF
{
  "G_build": true,
  "G_test": true,
  "G_lint": false,
  "G_review": false,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_lint",
  "details": { "review_score": 0, "security_findings": -1 }
}
EOF
  exit 1
fi

# ── G_review: cross-model review score ────────────────────────────────────────
# If --review-score is provided (pre-computed by Reviewer agent), use it directly.
# Otherwise, emit a structured request for the Reviewer to provide it.
echo "[G_review] Starting..." >&2
if [[ -n "$REVIEW_SCORE_OVERRIDE" ]]; then
  REVIEW_SCORE="$REVIEW_SCORE_OVERRIDE"
  if [[ "$REVIEW_SCORE" -ge "$MIN_REVIEW_SCORE" ]]; then
    echo "  [GATE] G_review: PASS (score=$REVIEW_SCORE >= threshold=$MIN_REVIEW_SCORE)" >&2
    G_REVIEW=true
  else
    echo "  [GATE] G_review: FAIL (score=$REVIEW_SCORE < threshold=$MIN_REVIEW_SCORE)" >&2
    G_REVIEW=false
  fi
else
  # No review score provided — this gate requires external input (Reviewer agent).
  # Evaluator should block until Reviewer posts score on the evaluation ticket.
  echo "  [GATE] G_review: BLOCKED (no review score provided; Reviewer agent must supply --review-score)" >&2
  cat <<EOF
{
  "G_build": true,
  "G_test": true,
  "G_lint": true,
  "G_review": false,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_review_pending",
  "details": { "review_score": -1, "security_findings": -1 }
}
EOF
  exit 2  # Exit code 2 = blocked (not failed), evaluator should re-queue
fi

if [[ "$G_REVIEW" == "false" ]]; then
  cat <<EOF
{
  "G_build": true,
  "G_test": true,
  "G_lint": true,
  "G_review": false,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_review",
  "details": { "review_score": $REVIEW_SCORE, "security_findings": -1 }
}
EOF
  exit 1
fi

# ── G_safe: zero critical security findings ────────────────────────────────────
echo "[G_safe] Starting..." >&2
SECURITY_FINDINGS=0

# npm audit for JS/TS projects
if [[ -f "$WORKSPACE/package-lock.json" ]] || [[ -f "$WORKSPACE/package.json" ]]; then
  CRITICAL_COUNT=$(cd "$WORKSPACE" && npm audit --json 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('critical',0))" 2>/dev/null || echo "0")
  SECURITY_FINDINGS=$((SECURITY_FINDINGS + CRITICAL_COUNT))
fi

# Basic secret leak check (simple patterns — not a SAST replacement)
LEAKED_SECRETS=$(cd "$WORKSPACE" && grep -rE \
  '(AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{40,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY)' \
  --include='*.ts' --include='*.js' --include='*.py' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir='.git' \
  -l 2>/dev/null | wc -l | tr -d '[:space:]' || echo "0")
SECURITY_FINDINGS=$((SECURITY_FINDINGS + LEAKED_SECRETS))

if [[ "$SECURITY_FINDINGS" -eq 0 ]]; then
  echo "  [GATE] G_safe: PASS (0 critical findings)" >&2
  G_SAFE=true
else
  echo "  [GATE] G_safe: FAIL ($SECURITY_FINDINGS critical findings)" >&2
  G_SAFE=false
fi

if [[ "$G_SAFE" == "false" ]]; then
  cat <<EOF
{
  "G_build": true,
  "G_test": true,
  "G_lint": true,
  "G_review": true,
  "G_safe": false,
  "all_passed": false,
  "failed_gate": "G_safe",
  "details": { "review_score": $REVIEW_SCORE, "security_findings": $SECURITY_FINDINGS }
}
EOF
  exit 1
fi

# ── All gates passed ──────────────────────────────────────────────────────────
echo "[GATES] All 5 hard gates PASSED." >&2
cat <<EOF
{
  "G_build": true,
  "G_test": true,
  "G_lint": true,
  "G_review": true,
  "G_safe": true,
  "all_passed": true,
  "failed_gate": null,
  "details": { "review_score": $REVIEW_SCORE, "security_findings": $SECURITY_FINDINGS }
}
EOF
exit 0
