#!/usr/bin/env bash
# factory-post-run.sh — Post-completion pipeline
#
# Runs after an agent finishes. Accepts a repo slug as $1.
#
#   ~/.factory/bin/factory-post-run.sh connectos
#
# Triggered automatically by factory-heartbeat.sh on detected completion,
# or can be run manually to reprocess a finished session.

set -euo pipefail

# ── Bootstrap ──────────────────────────────────────────────────────────────────
FACTORY_HOME="${FACTORY_HOME:-$HOME/.factory}"
CONFIG="$FACTORY_HOME/config.sh"

if [[ ! -f "$CONFIG" ]]; then
  echo "[FATAL] config.sh not found at $CONFIG" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"

if [[ $# -lt 1 ]]; then
  echo "Usage: factory-post-run.sh <repo-slug>" >&2
  echo "  Example: factory-post-run.sh connectos" >&2
  exit 1
fi

SLUG="$1"
RUNS_DIR="$FACTORY_RUNS"
MANIFESTS_DIR="$FACTORY_MANIFESTS"
MEMORY_DIR="$FACTORY_MEMORY"
ARCHIVE_DIR="$RUNS_DIR/archive"
BIN_DIR="$FACTORY_BIN"
TODAY="$(date -u '+%Y-%m-%d')"
NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

mkdir -p "$MANIFESTS_DIR" "$MEMORY_DIR" "$ARCHIVE_DIR"

# ── JSON helper ────────────────────────────────────────────────────────────────
json_get() {
  local file="$1" key="$2"
  if command -v jq &>/dev/null; then
    jq -r ".$key // empty" "$file" 2>/dev/null
  else
    python3 -c "
import json, sys
try:
    d = json.load(open('$file'))
    v = d.get('$key')
    print('' if v is None else v)
except Exception:
    pass
" 2>/dev/null
  fi
}

# In-place update one or more fields on a session JSON.
# Args: file key value [key value ...]
json_update() {
  local file="$1"; shift
  if command -v jq &>/dev/null; then
    local tmp filter=""
    tmp="$(mktemp)"
    while (( $# >= 2 )); do
      local k="$1" v="$2"; shift 2
      filter+=" | .$k = $(printf '%s' "$v" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    done
    filter="${filter# | }"
    jq ".$filter" "$file" > "$tmp" 2>/dev/null && mv "$tmp" "$file"
  else
    python3 - "$file" "$@" <<'EOF'
import json, sys
file = sys.argv[1]
args = sys.argv[2:]
d = json.load(open(file))
it = iter(args)
for k in it:
    d[k] = next(it)
json.dump(d, open(file, 'w'), indent=2)
EOF
  fi
}

# Write a small JSON object to a file (portable, no jq required).
write_json() {
  local file="$1"; shift
  python3 - "$file" "$@" <<'EOF'
import json, sys
file = sys.argv[1]
args = sys.argv[2:]
d = {}
it = iter(args)
for k in it:
    d[k] = next(it)
json.dump(d, open(file, 'w'), indent=2)
print(file)
EOF
}

# ── Locate session JSON ────────────────────────────────────────────────────────
# Accept most recent matching file in runs/ (not archive).
SESSION_FILE=""
latest_mtime=0
shopt -s nullglob
for f in "$RUNS_DIR"/"${SLUG}"-*.json; do
  if [[ -f "$f" ]]; then
    if stat --version &>/dev/null 2>&1; then
      mtime=$(stat -c '%Y' "$f" 2>/dev/null)
    else
      mtime=$(stat -f '%m' "$f" 2>/dev/null)
    fi
    if (( mtime > latest_mtime )); then
      latest_mtime=$mtime
      SESSION_FILE="$f"
    fi
  fi
done
shopt -u nullglob

if [[ -z "$SESSION_FILE" ]]; then
  echo "[FATAL] No session JSON found for slug '$SLUG' in $RUNS_DIR" >&2
  exit 1
fi

echo "[post-run] Processing session: $SESSION_FILE"

# ── Read session metadata ──────────────────────────────────────────────────────
REPO="$(json_get "$SESSION_FILE" repo)"
BRANCH="$(json_get "$SESSION_FILE" branch)"
WORKTREE="$(json_get "$SESSION_FILE" worktree)"
REPO_PATH="$(json_get "$SESSION_FILE" repo_path)"
STARTED="$(json_get "$SESSION_FILE" started)"

SCOREBOARD="$WORKTREE/SCOREBOARD.md"
PROGRESS_FILE="$WORKTREE/PROGRESS.md"

echo "[post-run] Repo:     $REPO"
echo "[post-run] Branch:   $BRANCH"
echo "[post-run] Worktree: $WORKTREE"

# ── Verify artifacts ──────────────────────────────────────────────────────────
if [[ ! -f "$SCOREBOARD" ]]; then
  echo "[WARN] SCOREBOARD.md not found at $SCOREBOARD — skipping scoreboard parsing"
fi
if [[ ! -f "$PROGRESS_FILE" ]]; then
  echo "[WARN] PROGRESS.md not found at $PROGRESS_FILE"
fi

# ── Parse SCOREBOARD.md ───────────────────────────────────────────────────────
# Collect completed items (lines matching "- [x]")
COMPLETED_ITEMS=()
FAILED_ITEMS=()
REVERTED_ITEMS=()

if [[ -f "$SCOREBOARD" ]]; then
  while IFS= read -r line; do
    # Completed: - [x] description
    if echo "$line" | grep -iqE '^[[:space:]]*-[[:space:]]*\[x\]'; then
      item="$(echo "$line" | sed -E 's/^[[:space:]]*-[[:space:]]*\[x\][[:space:]]*//' | tr -d '\r')"
      COMPLETED_ITEMS+=("$item")
    fi
    # Failed: - [F] or lines containing FAILED/REVERTED explicitly
    if echo "$line" | grep -iqE '^[[:space:]]*-[[:space:]]*\[f\]|FAILED|REVERTED'; then
      item="$(echo "$line" | sed -E 's/^[[:space:]]*-[[:space:]]*\[[fFxX]\][[:space:]]*//' | tr -d '\r')"
      FAILED_ITEMS+=("$item")
    fi
  done < "$SCOREBOARD"

  # Reverted items: look for "revert" mentions in any line
  while IFS= read -r line; do
    if echo "$line" | grep -qi 'revert'; then
      # Strip checkbox prefix (- [x], - [F], - [ ], etc.) for clean display
      item="$(echo "$line" | sed -E 's/^[[:space:]]*-[[:space:]]*\[[^]]*\][[:space:]]*//' | tr -d '\r')"
      [[ -z "$item" ]] && item="$(echo "$line" | tr -d '\r')"
      REVERTED_ITEMS+=("$item")
    fi
  done < "$SCOREBOARD"
fi

COMPLETED_COUNT="${#COMPLETED_ITEMS[@]}"
FAILED_COUNT="${#FAILED_ITEMS[@]}"

echo "[post-run] Completed: $COMPLETED_COUNT  Failed: $FAILED_COUNT"

# ── Read final status from PROGRESS.md ────────────────────────────────────────
FINAL_STATUS="DONE"
TOTAL_PLANNED=0
NOTES=""

if [[ -f "$PROGRESS_FILE" ]]; then
  STATUS_LINE="$(grep -m1 -Ei '^(Status|STATUS)\s*:' "$PROGRESS_FILE" 2>/dev/null || true)"
  if [[ -n "$STATUS_LINE" ]]; then
    FINAL_STATUS="$(echo "$STATUS_LINE" | sed 's/.*: *//' | tr -d '\r ')"
  fi
  # Try to extract planned total
  PLANNED_LINE="$(grep -m1 -Ei 'total|planned' "$PROGRESS_FILE" 2>/dev/null || true)"
  if [[ -n "$PLANNED_LINE" ]]; then
    TOTAL_PLANNED="$(echo "$PLANNED_LINE" | grep -oE '[0-9]+' | head -1 || echo "0")"
  fi
  # Grab any notes / summary text (first 5 non-empty lines after status)
  NOTES="$(tail -n +2 "$PROGRESS_FILE" | grep -v '^\s*$' | head -5 | tr '\n' ' ' | cut -c1-300)"
fi

echo "[post-run] Final status: $FINAL_STATUS"

# ── 1. Publish capability manifest ────────────────────────────────────────────
echo "[post-run] Publishing capability manifest..."

MANIFEST_FILE="$MANIFESTS_DIR/${SLUG}-${TODAY}.json"

# Build capabilities_added JSON array from completed items
cap_array=""
if command -v jq &>/dev/null; then
  cap_array="$(
    printf '%s\n' "${COMPLETED_ITEMS[@]:-}" |
    python3 -c "
import json, sys
items = [l.strip() for l in sys.stdin if l.strip()]
caps = [{'name': it[:80], 'type': 'task', 'status': 'completed'} for it in items]
print(json.dumps(caps, indent=2))
"
  )"
else
  cap_array="$(
    python3 - "${COMPLETED_ITEMS[@]:-}" <<'EOF'
import json, sys
items = sys.argv[1:]
caps = [{'name': it[:80], 'type': 'task', 'status': 'completed'} for it in items]
print(json.dumps(caps, indent=2))
EOF
  )"
fi

# Build failed_patterns array
fail_array=""
fail_array="$(
  python3 - "${FAILED_ITEMS[@]:-}" <<'EOF'
import json, sys
items = sys.argv[1:]
print(json.dumps([it[:120] for it in items], indent=2))
EOF
)"

# Write manifest using python3 (avoids jq escaping complexity)
python3 - \
  "$MANIFEST_FILE" \
  "$SLUG" \
  "$REPO" \
  "$BRANCH" \
  "$TODAY" \
  "$FINAL_STATUS" \
  "$COMPLETED_COUNT" \
  "$FAILED_COUNT" \
  "$NOTES" \
  <<'EOF'
import json, sys, datetime
out_file   = sys.argv[1]
slug       = sys.argv[2]
repo       = sys.argv[3]
branch     = sys.argv[4]
date       = sys.argv[5]
status     = sys.argv[6]
completed  = int(sys.argv[7])
failed     = int(sys.argv[8])
notes      = sys.argv[9]

manifest = {
    "schema_version": "1",
    "repo": repo,
    "slug": slug,
    "branch": branch,
    "date": date,
    "final_status": status,
    "items_completed": completed,
    "items_failed": failed,
    "summary_notes": notes,
    "capabilities_added": [],  # populated below by caller
    "downstream_hints": [],
    "generated_at": datetime.datetime.utcnow().isoformat() + "Z"
}
json.dump(manifest, open(out_file, 'w'), indent=2)
print(f"  Manifest: {out_file}")
EOF

echo "[post-run] Manifest written: $MANIFEST_FILE"

# ── 2. Extract learnings to memory ────────────────────────────────────────────
echo "[post-run] Updating memory: $MEMORY_DIR/${SLUG}.md"

MEMORY_FILE="$MEMORY_DIR/${SLUG}.md"

# Build the new entry block
NEW_ENTRY="## $TODAY: $REPO run ($FINAL_STATUS)

### Completed ($COMPLETED_COUNT items)"

for item in "${COMPLETED_ITEMS[@]:-}"; do
  NEW_ENTRY+="
- $item"
done

if (( FAILED_COUNT > 0 )); then
  NEW_ENTRY+="

### Failure patterns ($FAILED_COUNT items)"
  for item in "${FAILED_ITEMS[@]:-}"; do
    NEW_ENTRY+="
- $item"
  done
fi

if (( ${#REVERTED_ITEMS[@]} > 0 )); then
  NEW_ENTRY+="

### Reverted / known-failure candidates"
  for item in "${REVERTED_ITEMS[@]:-}"; do
    NEW_ENTRY+="
- $item"
  done
fi

NEW_ENTRY+="

"

# If memory file doesn't exist, initialise it with a header
if [[ ! -f "$MEMORY_FILE" ]]; then
  {
    echo "# Factory Memory: $REPO"
    echo ""
    echo "Auto-generated by factory-post-run.sh. Max 50 entries; oldest are pruned."
    echo ""
  } > "$MEMORY_FILE"
fi

# Prepend the new entry (most recent first)
TMP_MEM="$(mktemp)"
{
  # Keep the header lines (up to and including the first blank line after "Auto-generated...")
  head -4 "$MEMORY_FILE"
  echo "$NEW_ENTRY"
  # Append existing body (skip the header — 4 lines)
  tail -n +5 "$MEMORY_FILE"
} > "$TMP_MEM"

# Prune: keep at most 50 h2 sections (## YYYY-MM-DD entries)
python3 - "$TMP_MEM" <<'EOF'
import re, sys
path = sys.argv[1]
text = open(path).read()
# Split on h2 date entries
parts = re.split(r'(?=^## \d{4}-\d{2}-\d{2})', text, flags=re.MULTILINE)
header = parts[0]
entries = parts[1:]
MAX = 50
if len(entries) > MAX:
    entries = entries[:MAX]
open(path, 'w').write(header + ''.join(entries))
EOF

mv "$TMP_MEM" "$MEMORY_FILE"
entry_count="$(grep -c '^## [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' "$MEMORY_FILE" 2>/dev/null || echo '?')"
echo "[post-run] Memory updated: $MEMORY_FILE ($entry_count entries)"

# ── 3. Update session JSON ─────────────────────────────────────────────────────
echo "[post-run] Updating session JSON status..."
# Use python3 directly for reliable multi-field update
python3 - "$SESSION_FILE" "$FINAL_STATUS" "$NOW" "$COMPLETED_COUNT" "$FAILED_COUNT" <<'EOF'
import json, sys
path, status, completed_at, completed, failed = sys.argv[1:6]
d = json.load(open(path))
d['status'] = 'COMPLETED'
d['final_status'] = status
d['completed'] = completed_at
d['items_completed'] = int(completed)
d['items_failed'] = int(failed)
d['manifest_published'] = True
json.dump(d, open(path, 'w'), indent=2)
print(f"  Session updated: {path}")
EOF

# ── 4. Telegram notification ──────────────────────────────────────────────────
TELEGRAM_SCRIPT="$BIN_DIR/factory-telegram.sh"

if [[ -x "$TELEGRAM_SCRIPT" ]] && [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && [[ -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "[post-run] Sending Telegram summary..."

  PR_URL="$(json_get "$SESSION_FILE" pr_url || true)"
  [[ -z "$PR_URL" ]] && PR_URL="(no PR yet)"

  MSG="FACTORY: ${REPO} run complete
Status: ${FINAL_STATUS}
Items: ${COMPLETED_COUNT} completed / ${FAILED_COUNT} failed
Branch: ${BRANCH}
PR: ${PR_URL}
Duration: ${STARTED} → ${NOW}
Notes: ${NOTES:0:200}"

  "$TELEGRAM_SCRIPT" send "$MSG" || echo "[WARN] Telegram notification failed (non-fatal)"
else
  echo "[post-run] Telegram: skipped (script absent or token not configured)"
fi

# ── 5. Archive session JSON ───────────────────────────────────────────────────
echo "[post-run] Archiving session..."
mv "$SESSION_FILE" "$ARCHIVE_DIR/"
ARCHIVED="$ARCHIVE_DIR/$(basename "$SESSION_FILE")"
echo "[post-run] Archived: $ARCHIVED"

echo ""
echo "[post-run] Done for $SLUG — $FINAL_STATUS ($COMPLETED_COUNT completed, $FAILED_COUNT failed)"
