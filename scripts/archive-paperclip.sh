#!/usr/bin/env bash
# archive-paperclip.sh — Export and analyze Paperclip experiment data
#
# Exports v1 and v2 Paperclip company snapshots into a structured archive/
# directory. Generates an analysis markdown summarizing agents, config, and
# key findings. Safe to run multiple times (idempotent — appends analysis).
#
# Usage: ./scripts/archive-paperclip.sh [--dry-run]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORTS_DIR="$REPO_ROOT/paperclip-exports"
ARCHIVE_DIR="$REPO_ROOT/archive"
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

echo "DeFactory — Archive Paperclip Experiments"
echo "  Exports: $EXPORTS_DIR"
echo "  Archive: $ARCHIVE_DIR"
echo "  Dry-run: $DRY_RUN"
echo ""

if [[ "$DRY_RUN" == "false" ]]; then
  mkdir -p "$ARCHIVE_DIR"
fi

# ── Collect export versions ────────────────────────────────────────────────────
VERSIONS=()
for d in "$EXPORTS_DIR"/*/; do
  [[ -d "$d" ]] && VERSIONS+=("$(basename "$d")")
done

if [[ ${#VERSIONS[@]} -eq 0 ]]; then
  echo "No exports found under $EXPORTS_DIR — nothing to archive."
  exit 0
fi

echo "Found ${#VERSIONS[@]} export(s): ${VERSIONS[*]}"
echo ""

ANALYSIS_FILE="$ARCHIVE_DIR/paperclip-analysis-$(date +%Y-%m-%d).md"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] Would write analysis to: $ANALYSIS_FILE"
fi

ANALYSIS=""
ANALYSIS+="# Paperclip Experiment Archive\n\n"
ANALYSIS+="Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)\n\n"
ANALYSIS+="This document summarizes the Paperclip v1/v2 experiment configurations that\n"
ANALYSIS+="preceded the BIBLE.md architecture. These configs are archived here as\n"
ANALYSIS+="historical reference — they are NOT the canonical DeFactory architecture.\n\n"
ANALYSIS+="## Summary Table\n\n"
ANALYSIS+="| Version | Agents | Adapter Types | Notes |\n"
ANALYSIS+="| ------- | ------ | ------------- | ----- |\n"

for version in "${VERSIONS[@]}"; do
  version_dir="$EXPORTS_DIR/$version"
  agents_dir="$version_dir/agents"

  agent_count=0
  adapter_types=""

  if [[ -d "$agents_dir" ]]; then
    agent_count=$(ls -d "$agents_dir"/*/ 2>/dev/null | wc -l | tr -d ' ')
    # Collect unique adapter types from agent frontmatter
    adapter_types=$(grep -h "adapterType:" "$agents_dir"/*/*.md 2>/dev/null | \
      sort -u | awk '{print $2}' | tr '\n' ',' | sed 's/,$//' || echo "unknown")
  fi

  company_name=""
  if [[ -f "$version_dir/COMPANY.md" ]]; then
    company_name=$(grep "^name:" "$version_dir/COMPANY.md" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || echo "")
  fi

  ANALYSIS+="| $version | $agent_count | $adapter_types | company=$company_name |\n"
done

ANALYSIS+="\n## Per-Version Detail\n\n"

for version in "${VERSIONS[@]}"; do
  version_dir="$EXPORTS_DIR/$version"
  agents_dir="$version_dir/agents"

  ANALYSIS+="### $version\n\n"

  # Company config
  if [[ -f "$version_dir/COMPANY.md" ]]; then
    ANALYSIS+="**Company config:**\n\`\`\`\n"
    ANALYSIS+="$(grep -v '^#' "$version_dir/COMPANY.md" | head -20)\n"
    ANALYSIS+="\`\`\`\n\n"
  fi

  # Agents
  if [[ -d "$agents_dir" ]]; then
    ANALYSIS+="**Agents:**\n\n"
    for agent_dir in "$agents_dir"/*/; do
      agent_name=$(basename "$agent_dir")
      agent_md="$agent_dir/AGENTS.md"
      if [[ -f "$agent_md" ]]; then
        model=$(grep "model:" "$agent_md" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || echo "?")
        adapter=$(grep "adapterType:" "$agent_md" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || echo "?")
        role=$(grep "^role:" "$agent_md" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || echo "?")
        ANALYSIS+="- **$agent_name**: model=$model, adapter=$adapter, role=$role\n"
      fi
    done
    ANALYSIS+="\n"
  fi
done

ANALYSIS+="\n## Findings vs BIBLE.md\n\n"
ANALYSIS+="1. **Explorer-2 was claude_local in v1** — BIBLE.md requires codex_local (gpt-5.4-mini) for cross-model diversity. This was corrected in BIBLE.md.\n"
ANALYSIS+="2. **No board advisor agents in v1/v2** — BIBLE.md adds B1 Analyst (gpt-5.4), B2 Critic (gpt-5.3-codex), B3 Strategist (claude-opus-4-6).\n"
ANALYSIS+="3. **Frame Auditor renamed to Objective Auditor** — clearer scope, same function.\n"
ANALYSIS+="4. **Archive agent in v1** — absorbed into Research Scientist role in BIBLE.md.\n"
ANALYSIS+="5. **v2 identical structure to v1** — no meaningful experiment data in export; both are pre-BIBLE snapshots.\n\n"
ANALYSIS+="## What Was Preserved\n\n"
ANALYSIS+="- genotype gen-0000 (seed config) in evo.db\n"
ANALYSIS+="- policy.yml with sha256 seal\n"
ANALYSIS+="- evo/schema.sql (frozen)\n"
ANALYSIS+="- evo/evaluator/* and evo/mutation/mutate.js\n\n"
ANALYSIS+="## Status\n\n"
ANALYSIS+="Paperclip v1/v2 configs are archived. Active work proceeds via BIBLE.md architecture.\n"
ANALYSIS+="These exports are read-only historical reference.\n"

# Write analysis
if [[ "$DRY_RUN" == "false" ]]; then
  printf "%b" "$ANALYSIS" > "$ANALYSIS_FILE"
  echo "Wrote analysis to: $ANALYSIS_FILE"

  # Also copy exports into archive for posterity
  for version in "${VERSIONS[@]}"; do
    ARCHIVE_VERSION_DIR="$ARCHIVE_DIR/$version"
    if [[ ! -d "$ARCHIVE_VERSION_DIR" ]]; then
      cp -r "$EXPORTS_DIR/$version" "$ARCHIVE_VERSION_DIR"
      echo "Copied export $version → archive/$version/"
    else
      echo "archive/$version/ already exists — skipping copy."
    fi
  done
else
  echo "[dry-run] Analysis preview:"
  printf "%b" "$ANALYSIS" | head -40
  echo "..."
fi

echo ""
echo "Done."
