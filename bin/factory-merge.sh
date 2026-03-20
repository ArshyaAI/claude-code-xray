#!/usr/bin/env bash
# factory-merge.sh — Auto-rebase + merge factory PRs
# Usage: factory-merge.sh [--all] [--repos "slug1,slug2"]
set -euo pipefail
FACTORY_HOME="${FACTORY_HOME:-$HOME/.factory}"
source "$FACTORY_HOME/config.sh"

log() { echo "[factory-merge] $*"; }

for entry in "${FACTORY_REPOS[@]}"; do
  slug="${entry%%|*}"
  repo_path="${entry#*|}"
  
  # Skip commented-out repos
  [[ "$slug" == \#* ]] && continue
  
  cd "$repo_path" 2>/dev/null || continue
  
  # Find open factory PRs
  PR_NUM=$(gh pr list --state open --json number,title -q '[.[] | select(.title | startswith("factory"))] | .[0].number' 2>/dev/null)
  [ -z "$PR_NUM" ] && continue
  
  log "── $slug PR #$PR_NUM ──"
  
  # Try direct merge first
  if gh pr merge "$PR_NUM" --squash --body "Factory auto-merge" 2>/dev/null; then
    log "✅ Merged directly"
    continue
  fi
  
  # Needs rebase
  log "Needs rebase — rebasing..."
  WORKTREE=$(find "$repo_path/.trees" -maxdepth 1 -name "factory-*" -type d 2>/dev/null | head -1)
  if [ -z "$WORKTREE" ]; then
    log "⚠️ No worktree found — skipping"
    continue
  fi
  
  cd "$WORKTREE"
  git stash 2>/dev/null || true
  git fetch origin 2>/dev/null
  
  # Rebase, skipping conflicting metadata commits
  if ! git rebase origin/main 2>/dev/null; then
    # Skip metadata conflicts (SCOREBOARD, PROGRESS, etc.)
    MAX_SKIPS=10
    SKIPS=0
    while [ $SKIPS -lt $MAX_SKIPS ]; do
      if git rebase --skip 2>&1 | grep -q "Successfully rebased"; then
        break
      elif git rebase --skip 2>&1 | grep -q "Could not apply"; then
        SKIPS=$((SKIPS + 1))
        continue
      else
        break
      fi
    done
  fi
  
  git push origin "$(git branch --show-current)" --force-with-lease 2>/dev/null
  sleep 3
  
  cd "$repo_path"
  if gh pr merge "$PR_NUM" --squash --body "Factory auto-merge (rebased)" 2>/dev/null; then
    log "✅ Merged after rebase"
  else
    log "❌ Failed to merge — needs manual review"
  fi
done
