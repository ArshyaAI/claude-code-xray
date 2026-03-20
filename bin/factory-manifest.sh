#!/usr/bin/env bash
# factory-manifest.sh — Capability manifest publisher
# Usage: factory-manifest.sh <slug>
#
# Reads SCOREBOARD.md from the repo's factory worktree, extracts completed
# capabilities, and writes ~/.factory/manifests/{slug}-{date}.json

set -euo pipefail

# ── Bootstrap ────────────────────────────────────────────────────────────────
FACTORY_CONFIG="${HOME}/.factory/config.sh"

if [[ ! -f "$FACTORY_CONFIG" ]]; then
  echo "[factory-manifest] ERROR: config not found at $FACTORY_CONFIG" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$FACTORY_CONFIG"

# ── Helpers ──────────────────────────────────────────────────────────────────
log() { echo "[factory-manifest] $*"; }
err() { echo "[factory-manifest] ERROR: $*" >&2; }

mkdir -p "$FACTORY_MANIFESTS"

# ── Repo lookup ──────────────────────────────────────────────────────────────
# get_repo_path <slug> — echoes the repo path for a slug, or empty string
get_repo_path() {
  local target_slug="$1"
  for entry in "${FACTORY_REPOS[@]}"; do
    local s="${entry%%|*}"
    local p="${entry##*|}"
    if [[ "$s" == "$target_slug" ]]; then
      echo "$p"
      return 0
    fi
  done
  echo ""
}

# ── SCOREBOARD locator ───────────────────────────────────────────────────────
# find_scoreboard <repo_path> <branch> — finds SCOREBOARD.md in worktree or repo root
find_scoreboard() {
  local repo_path="$1"
  local branch="$2"

  # 1. Check for an active git worktree for this branch
  local worktree_list
  worktree_list=$(git -C "$repo_path" worktree list --porcelain 2>/dev/null || echo "")

  local current_wt=""
  local current_branch=""
  while IFS= read -r line; do
    if [[ "$line" == worktree* ]]; then
      current_wt="${line#worktree }"
    elif [[ "$line" == branch* ]]; then
      current_branch="${line#branch refs/heads/}"
      if [[ "$current_branch" == "$branch" ]]; then
        local candidate="${current_wt}/SCOREBOARD.md"
        if [[ -f "$candidate" ]]; then
          echo "$candidate"
          return 0
        fi
      fi
    fi
  done <<< "$worktree_list"

  # 2. Fall back to repo root (current checkout)
  local root_candidate="${repo_path}/SCOREBOARD.md"
  if [[ -f "$root_candidate" ]]; then
    echo "$root_candidate"
    return 0
  fi

  # 3. Try git show to read it from the branch without a worktree
  local tmp_scoreboard
  tmp_scoreboard=$(mktemp /tmp/scoreboard_XXXXXX.md)
  if git -C "$repo_path" show "${branch}:SCOREBOARD.md" > "$tmp_scoreboard" 2>/dev/null; then
    echo "$tmp_scoreboard"
    return 0
  fi
  rm -f "$tmp_scoreboard"

  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  local slug="${1:-}"
  if [[ -z "$slug" ]]; then
    err "Usage: factory-manifest.sh <slug>"
    exit 1
  fi

  local repo_path
  repo_path=$(get_repo_path "$slug")
  if [[ -z "$repo_path" ]]; then
    err "Slug '$slug' not found in FACTORY_REPOS"
    exit 1
  fi

  if [[ ! -d "$repo_path" ]]; then
    err "Repo path does not exist: $repo_path"
    exit 1
  fi

  # Determine the factory branch (most recent factory/* branch, or today's)
  local today
  today=$(date -u +%Y-%m-%d)
  local branch="${FACTORY_BRANCH_PREFIX}/${today}"

  # Check if a factory branch exists; fall back gracefully
  if ! git -C "$repo_path" rev-parse --verify "refs/heads/${branch}" >/dev/null 2>&1; then
    # Try to find any factory/* branch
    local found_branch
    found_branch=$(git -C "$repo_path" branch --list "${FACTORY_BRANCH_PREFIX}/*" \
                    --sort=-committerdate 2>/dev/null | head -1 | tr -d ' *' || echo "")
    if [[ -n "$found_branch" ]]; then
      log "Branch $branch not found; using most recent factory branch: $found_branch"
      branch="$found_branch"
    else
      log "Warning: no factory branch found in $repo_path — reading from current HEAD"
      branch=$(git -C "$repo_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
    fi
  fi

  # Locate SCOREBOARD.md
  local scoreboard_path
  scoreboard_path=$(find_scoreboard "$repo_path" "$branch")
  if [[ -z "$scoreboard_path" ]]; then
    err "SCOREBOARD.md not found for $slug (branch: $branch)"
    exit 1
  fi
  log "Parsing SCOREBOARD: $scoreboard_path"

  # Output manifest path
  local out_file="${FACTORY_MANIFESTS}/${slug}-${today}.json"

  # Parse SCOREBOARD.md and write manifest via Python
  python3 - "$slug" "$branch" "$today" "$scoreboard_path" "$out_file" <<'PYEOF'
import json, sys, re, os
from datetime import datetime, timezone

slug          = sys.argv[1]
branch        = sys.argv[2]
date_str      = sys.argv[3]
scoreboard    = sys.argv[4]
out_file      = sys.argv[5]

# ── Repo relationship map for downstream hints ──────────────────────────────
# Format: { source_slug: [ (target_slug, condition_keywords, hint_template) ] }
DOWNSTREAM_MAP = {
    "connectos": [
        (
            "nikin-wrapper",
            ["adapter", "connector", "integration", "client"],
            "connectos shipped a new {cap_type} — nikin-wrapper may need to integrate it",
        ),
        (
            "brandos",
            ["brand", "asset", "template"],
            "connectos shipped a brand-related {cap_type} — brandos may benefit",
        ),
    ],
    "nikin-wrapper": [
        (
            "brandos",
            ["feature", "api", "endpoint", "webhook"],
            "nikin-wrapper shipped a {cap_type} — brandos may need to consume it",
        ),
        (
            "founderos",
            ["feature", "integration", "workflow"],
            "nikin-wrapper shipped a {cap_type} — founderos may want to leverage it",
        ),
    ],
    "founderos": [
        (
            "brandos",
            ["template", "feature", "workflow"],
            "founderos shipped a {cap_type} — brandos may want to adopt the pattern",
        ),
    ],
    "brandos": [],
}

# ── Capability type classifier ───────────────────────────────────────────────
CAP_TYPE_PATTERNS = [
    (r"\badapter\b",                "adapter"),
    (r"\bconnector\b",              "adapter"),
    (r"\bfix(es)?\b",               "fix"),
    (r"\bbug\b",                    "fix"),
    (r"\btest(s|ing)?\b",           "test"),
    (r"\bspec\b",                   "test"),
    (r"\bendpoint\b",               "feature"),
    (r"\bapi\b",                    "feature"),
    (r"\bwebhook\b",                "feature"),
    (r"\bfeature\b",                "feature"),
    (r"\brefactor\b",               "refactor"),
    (r"\bcleanup\b",                "refactor"),
    (r"\bdoc(s|umentation)?\b",     "docs"),
    (r"\bconfig\b",                 "config"),
    (r"\btype(s)?\b",               "types"),
    (r"\bschema\b",                 "types"),
    (r"\bscript\b",                 "script"),
]

def classify_cap_type(text: str) -> str:
    lower = text.lower()
    for pattern, cap_type in CAP_TYPE_PATTERNS:
        if re.search(pattern, lower):
            return cap_type
    return "feature"

# ── File path extractor ───────────────────────────────────────────────────────
FILE_PATTERN = re.compile(
    r"""
    (?:
        [`']?                           # optional backtick or quote
        (
            (?:[a-zA-Z0-9_\-\.]+/)+    # at least one directory segment
            [a-zA-Z0-9_\-\.]+          # filename
            (?:\.[a-zA-Z]{1,10})?      # optional extension
        )
        [`']?
    )
    """,
    re.VERBOSE,
)

INTEGRATION_PATTERN = re.compile(
    r"`([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)`"  # dotted names
    r"|`([a-zA-Z][a-zA-Z0-9_]*)\s*\(`"                          # function calls
    r"|\b(GET|POST|PUT|DELETE|PATCH)\s+(/[^\s`'\"]+)"           # HTTP methods
, re.IGNORECASE)

# ── Parse SCOREBOARD.md ───────────────────────────────────────────────────────
with open(scoreboard) as fh:
    content = fh.read()

capabilities_added = []
all_cap_types      = []

# Look for completed items: lines with [x] or ✓ or ✅ or "DONE"
DONE_LINE = re.compile(
    r"(?:"
    r"\[x\]"                    # markdown checkbox checked
    r"|✓|✅|☑"                  # unicode checkmarks
    r"|^\s*[-*]\s+DONE[:\s]"    # explicit DONE marker
    r"|Status:\s*(?:done|complete|completed|success)"
    r")",
    re.IGNORECASE,
)

lines = content.splitlines()
for line in lines:
    if not DONE_LINE.search(line):
        continue

    # Strip markdown formatting for clean description
    clean = re.sub(r"\[x\]\s*", "", line, flags=re.IGNORECASE)
    clean = re.sub(r"[✓✅☑]\s*", "", clean)
    clean = re.sub(r"^\s*[-*#>]+\s*", "", clean)
    clean = re.sub(r"\*\*(.+?)\*\*", r"\1", clean)
    clean = re.sub(r"`(.+?)`", r"\1", clean)
    clean = clean.strip()

    if len(clean) < 3:
        continue

    cap_type = classify_cap_type(clean)
    all_cap_types.append(cap_type)

    # Extract files mentioned on this line
    files_found = FILE_PATTERN.findall(line)
    files_found = [f for f in files_found if "." in f or "/" in f]

    # Extract integration surfaces
    surfaces = []
    for m in INTEGRATION_PATTERN.finditer(line):
        for g in m.groups():
            if g:
                surfaces.append(g.strip())

    capabilities_added.append({
        "description":           clean,
        "type":                  cap_type,
        "files":                 list(dict.fromkeys(files_found)),   # deduplicate, preserve order
        "integration_surfaces":  list(dict.fromkeys(surfaces)),
    })

# ── Generate downstream hints ─────────────────────────────────────────────────
downstream_hints = []
seen_hints = set()

slug_rules = DOWNSTREAM_MAP.get(slug, [])
for cap in capabilities_added:
    cap_type  = cap["type"]
    cap_desc  = cap["description"].lower()
    for target_slug, keywords, template in slug_rules:
        matched = any(kw in cap_desc or kw == cap_type for kw in keywords)
        if matched:
            hint_text = template.format(cap_type=cap_type)
            key       = (target_slug, hint_text)
            if key not in seen_hints:
                seen_hints.add(key)
                downstream_hints.append({
                    "target_repo": target_slug,
                    "hint":        hint_text,
                    "source_cap":  cap["description"][:120],
                })

# ── Assemble manifest ─────────────────────────────────────────────────────────
manifest = {
    "repo":               slug,
    "branch":             branch,
    "date":               datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "capabilities_added": capabilities_added,
    "downstream_hints":   downstream_hints,
    "breaking_changes":   [],
}

with open(out_file, "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")

cap_count  = len(capabilities_added)
hint_count = len(downstream_hints)
print(f"[factory-manifest] Wrote manifest: {out_file}")
print(f"[factory-manifest] Capabilities: {cap_count} | Downstream hints: {hint_count}")
PYEOF
}

main "$@"
