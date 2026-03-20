#!/usr/bin/env bash
# factory-heartbeat.sh — Multi-agent monitor
#
# Scans all ~/.factory/runs/*.json with status RUNNING, checks PID health,
# measures SCOREBOARD.md progress, detects completions and crashes, and
# triggers factory-post-run.sh when an agent finishes cleanly.
#
# Designed to run every 15 minutes via cron:
#   */15 * * * * /Users/arshya/.factory/bin/factory-heartbeat.sh >> /tmp/factory-heartbeat-cron.log 2>&1
#
# Or manually:
#   ~/.factory/bin/factory-heartbeat.sh

set -eo pipefail

# ── Bootstrap ──────────────────────────────────────────────────────────────────
FACTORY_HOME="${FACTORY_HOME:-$HOME/.factory}"
CONFIG="$FACTORY_HOME/config.sh"

if [[ ! -f "$CONFIG" ]]; then
  echo "[FATAL] config.sh not found at $CONFIG" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"

HEARTBEAT_LOG="$FACTORY_HOME/heartbeat.log"
RUNS_DIR="$FACTORY_RUNS"
BIN_DIR="$FACTORY_BIN"
POST_RUN_SCRIPT="$BIN_DIR/factory-post-run.sh"

# Stuck threshold: warn if SCOREBOARD.md mtime is older than this many minutes
STUCK_THRESHOLD_MIN="${STUCK_THRESHOLD_MIN:-60}"

# ── JSON helper ────────────────────────────────────────────────────────────────
# Prefer jq; fall back to python3 for environments without it.
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

json_set_status() {
  local file="$1" status="$2" extra_key="${3:-}" extra_val="${4:-}"
  if command -v jq &>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    local update=".status = \"$status\""
    [[ -n "$extra_key" ]] && update+=" | .$extra_key = \"$extra_val\""
    jq "$update" "$file" > "$tmp" && mv "$tmp" "$file"
  else
    python3 -c "
import json, sys
d = json.load(open('$file'))
d['status'] = '$status'
if '$extra_key':
    d['$extra_key'] = '$extra_val'
json.dump(d, open('$file', 'w'), indent=2)
" 2>/dev/null
  fi
}

# ── Scoreboard helpers ─────────────────────────────────────────────────────────
count_completed_items() {
  local scoreboard="$1"
  # Count lines matching "- [x]" (completed checkbox) case-insensitive
  grep -c -i '^\s*-\s*\[x\]' "$scoreboard" 2>/dev/null || echo "0"
}

count_total_items() {
  local scoreboard="$1"
  # Count lines matching "- [ ]" or "- [x]"
  grep -c -E '^\s*-\s*\[(x| )\]' "$scoreboard" 2>/dev/null || echo "0"
}

# Returns the age of a file in minutes, or 9999 if it doesn't exist.
file_age_minutes() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    echo "9999"
    return
  fi
  local mtime now
  # stat is slightly different on macOS vs Linux
  if stat --version &>/dev/null 2>&1; then
    # GNU stat
    mtime=$(stat -c '%Y' "$f" 2>/dev/null)
  else
    # BSD/macOS stat
    mtime=$(stat -f '%m' "$f" 2>/dev/null)
  fi
  now=$(date +%s)
  echo $(( (now - mtime) / 60 ))
}

# ── Table formatting ────────────────────────────────────────────────────────────
ROWS=()   # accumulated result rows for summary table
ALERTS=() # lines to emit at the end as attention items

add_row() {
  ROWS+=("$*")
}

add_alert() {
  ALERTS+=("$*")
}

# ── Main loop ──────────────────────────────────────────────────────────────────
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  FACTORY HEARTBEAT  $TIMESTAMP"
echo "══════════════════════════════════════════════════════════════"

# Ensure runs dir exists
mkdir -p "$RUNS_DIR"

shopt -s nullglob
SESSION_FILES=("$RUNS_DIR"/*.json)
shopt -u nullglob

RUNNING_COUNT=0
PROCESSED=0

for session_file in "${SESSION_FILES[@]}"; do
  status="$(json_get "$session_file" status)"

  # Only process RUNNING sessions
  [[ "$status" != "RUNNING" ]] && continue

  RUNNING_COUNT=$(( RUNNING_COUNT + 1 ))
  PROCESSED=$(( PROCESSED + 1 ))

  slug="$(json_get "$session_file" slug)"
  # Fall back to the repo field if slug is absent (older session format)
  repo_label="$(json_get "$session_file" repo)"
  [[ -z "$slug" ]] && slug="$repo_label"
  [[ -z "$repo_label" ]] && repo_label="$slug"
  pid="$(json_get "$session_file" pid)"
  worktree="$(json_get "$session_file" worktree)"
  started="$(json_get "$session_file" started)"

  scoreboard="$worktree/SCOREBOARD.md"
  progress_file="$worktree/PROGRESS.md"
  blocked_file="$worktree/BLOCKED.md"

  # ── Check PID liveness ───────────────────────────────────────
  pid_alive=false
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    pid_alive=true
  fi

  if $pid_alive; then
    # ── Agent is running ───────────────────────────────────────

    completed=0
    total=0
    scoreboard_age=9999

    if [[ -f "$scoreboard" ]]; then
      completed="$(count_completed_items "$scoreboard")"
      total="$(count_total_items "$scoreboard")"
      scoreboard_age="$(file_age_minutes "$scoreboard")"
    fi

    state="RUNNING"

    if [[ -f "$blocked_file" ]]; then
      state="RUNNING(BLOCKED)"
      add_alert "  BLOCKED  [$repo_label] PID=$pid — BLOCKED.md found. Agent stopped early."
    elif (( scoreboard_age > STUCK_THRESHOLD_MIN )); then
      # Don't alert STUCK if scoreboard doesn't exist yet (agent in Think phase)
      # 9999 means no file — only alert if file EXISTS but is stale
      if (( scoreboard_age < 9999 )); then
        state="RUNNING(STUCK?)"
        add_alert "  WARN     [$repo_label] PID=$pid — SCOREBOARD.md unchanged for ${scoreboard_age}min (threshold: ${STUCK_THRESHOLD_MIN}min). Agent may be stuck."
      else
        state="RUNNING(THINKING)"
      fi
    fi

    add_row "$(printf "  %-20s  %-6s  %-20s  %s/%s items  scoreboard age: %smin  started: %s" \
      "$repo_label" "ALIVE" "$state" "$completed" "$total" "$scoreboard_age" "$started")"

  else
    # ── PID is dead ───────────────────────────────────────────

    if [[ -f "$progress_file" ]]; then
      # Clean completion — PROGRESS.md was written
      final_status="$(grep -m1 -E '^(Status|STATUS):' "$progress_file" 2>/dev/null | sed 's/.*: *//' | tr -d '\r' || echo "DONE")"
      [[ -z "$final_status" ]] && final_status="DONE"

      completed=0
      total=0
      if [[ -f "$scoreboard" ]]; then
        completed="$(count_completed_items "$scoreboard")"
        total="$(count_total_items "$scoreboard")"
      fi

      add_row "$(printf "  %-20s  %-6s  %-20s  %s/%s items  completed: %s" \
        "$repo_label" "DEAD" "COMPLETED($final_status)" "$completed" "$total" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')")"

      # Mark session as COMPLETED
      json_set_status "$session_file" "COMPLETED" "completed" "$TIMESTAMP"

      # Trigger post-run pipeline — pass slug (not repo_label) so post-run can locate the session file
      if [[ -x "$POST_RUN_SCRIPT" ]]; then
        echo ""
        echo "  >> Triggering post-run pipeline for: $repo_label (slug: $slug)"
        "$POST_RUN_SCRIPT" "$slug" || echo "  [WARN] post-run script exited non-zero for $slug"
      else
        add_alert "  INFO     [$repo_label] post-run script not found or not executable: $POST_RUN_SCRIPT"
      fi

    else
      # Crash — PID dead, no PROGRESS.md
      json_set_status "$session_file" "CRASHED"
      add_row "$(printf "  %-20s  %-6s  %-20s  worktree: %s" \
        "$repo_label" "DEAD" "CRASHED" "$worktree")"
      add_alert "  ALERT    [$repo_label] CRASHED — PID $pid dead, no PROGRESS.md. Worktree preserved for debug: $worktree"
    fi
  fi
done

# ── Summary table ──────────────────────────────────────────────────────────────
if (( PROCESSED == 0 )); then
  echo "  No RUNNING sessions found in $RUNS_DIR"
else
  echo ""
  printf "  %-20s  %-6s  %-20s  %s\n" "REPO" "PID" "STATE" "DETAILS"
  printf "  %-20s  %-6s  %-20s  %s\n" "----" "---" "-----" "-------"
  for row in "${ROWS[@]}"; do
    echo "$row"
  done
fi

# ── Alerts ─────────────────────────────────────────────────────────────────────
if (( ${#ALERTS[@]} > 0 )); then
  echo ""
  echo "  ── ALERTS ──────────────────────────────────────────────────"
  for alert in "${ALERTS[@]}"; do
    echo "$alert"
  done
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""

# ── Append to heartbeat log ────────────────────────────────────────────────────
{
  echo "[$TIMESTAMP] heartbeat — running=$RUNNING_COUNT processed=$PROCESSED alerts=${#ALERTS[@]}"
  for row in "${ROWS[@]}"; do
    echo "  $row"
  done
  for alert in "${ALERTS[@]}"; do
    echo "  $alert"
  done
} >> "$HEARTBEAT_LOG"
