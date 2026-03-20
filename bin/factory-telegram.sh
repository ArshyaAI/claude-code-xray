#!/usr/bin/env bash
# factory-telegram.sh — Factory Telegram notification bot
# Usage:
#   factory-telegram.sh --test
#   factory-telegram.sh --send "message text"
#   factory-telegram.sh --summary <slug>
#   factory-telegram.sh --poll

set -euo pipefail

# ── Bootstrap ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_CONFIG="${HOME}/.factory/config.sh"

if [[ ! -f "$FACTORY_CONFIG" ]]; then
  echo "[factory-telegram] ERROR: config not found at $FACTORY_CONFIG" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$FACTORY_CONFIG"

# ── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[factory-telegram] $*"; }
err()  { echo "[factory-telegram] ERROR: $*" >&2; }

# Ensure required directories exist
mkdir -p "$FACTORY_RUNS" "$FACTORY_MANIFESTS"

# ── Core: send_message ───────────────────────────────────────────────────────
# send_message <text> [slug]
# Sends a Markdown message to the configured Telegram chat.
# Falls back to a text file if token is empty or the API call fails.
send_message() {
  local text="${1:-}"
  local slug="${2:-factory}"

  if [[ -z "$text" ]]; then
    err "send_message called with empty text"
    return 1
  fi

  # Token/chat guard
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
    err "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set — writing to fallback file"
    _write_fallback "$text" "$slug"
    return 0
  fi

  local api_url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  local http_code

  http_code=$(curl -s -o /tmp/tg_response.json -w "%{http_code}" \
    --max-time 15 \
    -X POST "$api_url" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"chat_id":"%s","text":%s,"parse_mode":"Markdown"}' \
          "$TELEGRAM_CHAT_ID" \
          "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
       )") || true

  if [[ "$http_code" == "200" ]]; then
    log "Message sent (HTTP $http_code)"
  else
    err "API returned HTTP $http_code — writing to fallback file"
    if [[ -f /tmp/tg_response.json ]]; then
      err "Response body: $(cat /tmp/tg_response.json)"
    fi
    _write_fallback "$text" "$slug"
    return 1
  fi
}

# ── Core: poll_replies ───────────────────────────────────────────────────────
# poll_replies
# Checks for "merge" or "discard" replies in getUpdates.
# Stores the last processed update_id in ~/.factory/runs/.last_update_id
poll_replies() {
  if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    err "TELEGRAM_BOT_TOKEN is not set — cannot poll"
    return 1
  fi

  local offset_file="${FACTORY_RUNS}/.last_update_id"
  local offset=0
  if [[ -f "$offset_file" ]]; then
    offset=$(( $(cat "$offset_file") + 1 ))
  fi

  local api_url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
  local response

  response=$(curl -s --max-time 15 \
    "${api_url}?offset=${offset}&limit=50&timeout=0") || {
    err "getUpdates request failed"
    return 1
  }

  # Use python3 to parse JSON reliably (pure bash JSON parsing is fragile)
  python3 - "$response" "$offset_file" <<'PYEOF'
import json, sys, os, subprocess

raw    = sys.argv[1]
ofile  = sys.argv[2]
data   = json.loads(raw)

if not data.get("ok"):
    print(f"[factory-telegram] poll: API error: {data}", file=sys.stderr)
    sys.exit(1)

updates = data.get("result", [])
last_id = None

for upd in updates:
    last_id = upd["update_id"]
    msg = upd.get("message") or upd.get("channel_post") or {}
    text = (msg.get("text") or "").strip().lower()

    if not text:
        continue

    # Extract PR URL from reply context if present
    reply = msg.get("reply_to_message") or {}
    reply_text = reply.get("text") or ""
    pr_url = None
    for token in reply_text.split():
        if token.startswith("https://github.com") and "/pull/" in token:
            pr_url = token
            break

    if "merge" in text:
        print(f"[factory-telegram] MERGE signal received from update {last_id}")
        if pr_url:
            print(f"[factory-telegram] Merging PR: {pr_url}")
            result = subprocess.run(
                ["gh", "pr", "merge", pr_url, "--squash"],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                print(f"[factory-telegram] PR merged successfully")
                print(result.stdout)
            else:
                print(f"[factory-telegram] ERROR: gh pr merge failed", file=sys.stderr)
                print(result.stderr, file=sys.stderr)
        else:
            print(f"[factory-telegram] MERGE received but no PR URL found in replied message")

    elif "discard" in text:
        print(f"[factory-telegram] DISCARD decision logged for update {last_id}")
        if pr_url:
            print(f"[factory-telegram] Discarded PR: {pr_url}")

if last_id is not None:
    with open(ofile, "w") as f:
        f.write(str(last_id))
    print(f"[factory-telegram] Processed {len(updates)} update(s), last_id={last_id}")
else:
    print("[factory-telegram] No new updates")
PYEOF
}

# ── Core: build_summary ──────────────────────────────────────────────────────
# build_summary <slug>
# Reads ~/.factory/runs/{slug}-*.json files and composes a summary message.
build_summary() {
  local slug="${1:-}"
  if [[ -z "$slug" ]]; then
    err "--summary requires a slug argument"
    return 1
  fi

  python3 - "$slug" "$FACTORY_RUNS" "$FACTORY_BRANCH_PREFIX" <<'PYEOF'
import json, sys, glob, os

slug        = sys.argv[1]
runs_dir    = sys.argv[2]
branch_pfx  = sys.argv[3]

pattern     = os.path.join(runs_dir, f"{slug}-*.json")
files       = sorted(glob.glob(pattern))

if not files:
    print(f"[factory-telegram] No run files found matching {pattern}", file=sys.stderr)
    sys.exit(1)

total     = 0
completed = 0
failed    = 0
status    = "UNKNOWN"
branch    = "unknown"
pr_url    = ""

for f in files:
    try:
        with open(f) as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[factory-telegram] Warning: could not parse {f}: {e}", file=sys.stderr)
        continue

    # Support both array of items and a single run object
    if isinstance(data, list):
        for item in data:
            total += 1
            s = str(item.get("status", "")).lower()
            if s in ("done", "complete", "completed", "success"):
                completed += 1
            elif s in ("failed", "error", "blocked"):
                failed += 1
    elif isinstance(data, dict):
        # Aggregate fields if present
        total     += data.get("total",     0)
        completed += data.get("completed", 0)
        failed    += data.get("failed",    0)
        if data.get("status"):
            status = data["status"].upper()
        if data.get("branch"):
            branch = data["branch"]
        if data.get("pr_url"):
            pr_url = data["pr_url"]

# Derive status from item counts if not explicitly set
if status == "UNKNOWN" and total > 0:
    if failed == 0 and completed == total:
        status = "DONE"
    elif failed > 0:
        status = "PARTIAL"
    else:
        status = "IN_PROGRESS"

# Derive branch from date if not found in run files
if branch == "unknown":
    from datetime import date
    today = date.today().isoformat()
    branch = f"{branch_pfx}/{today}"

lines = [
    f"*Factory: {slug} run complete*",
    f"Status: {status}",
    f"Items: {completed}/{total} ({failed} failed)",
    f"Branch: `{branch}`",
]
if pr_url:
    lines.append(f"PR: {pr_url}")

print("\n".join(lines))
PYEOF
}

# ── Fallback writer ──────────────────────────────────────────────────────────
_write_fallback() {
  local text="$1"
  local slug="${2:-factory}"
  local fallback="${FACTORY_RUNS}/${slug}-summary.txt"
  {
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "$text"
    echo ""
  } >> "$fallback"
  log "Message written to fallback: $fallback"
}

# ── Argument dispatch ────────────────────────────────────────────────────────
if [[ $# -eq 0 ]]; then
  echo "Usage:"
  echo "  factory-telegram.sh --test"
  echo "  factory-telegram.sh --send \"message\""
  echo "  factory-telegram.sh --summary <slug>"
  echo "  factory-telegram.sh --poll"
  exit 0
fi

case "${1:-}" in
  --test)
    send_message "Factory bot online" "test"
    ;;

  # Support both --send "msg" and positional: send "msg"
  --send|send)
    if [[ -z "${2:-}" ]]; then
      err "send requires a message argument"
      exit 1
    fi
    send_message "$2"
    ;;

  --summary|summary)
    if [[ -z "${2:-}" ]]; then
      err "summary requires a slug argument"
      exit 1
    fi
    msg=$(build_summary "$2") || exit 1
    send_message "$msg" "$2"
    ;;

  --poll|poll)
    poll_replies
    ;;

  *)
    err "Unknown flag: ${1:-}"
    exit 1
    ;;
esac
