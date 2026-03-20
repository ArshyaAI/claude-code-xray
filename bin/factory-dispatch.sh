#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# factory-dispatch.sh — Continuous Factory Multi-Repo Agent Spawner
#
# Spawns Claude Code autoresearch agents across multiple repos in isolated git
# worktrees. Each agent reads a PROGRAM.md + NIGHT-TASK.md and runs the full
# gstack sprint pipeline autonomously (no interactive prompts).
#
# Usage:
#   factory-dispatch.sh [--dry-run] [--repos "slug1,slug2"] [--all]
#
# Flags:
#   --dry-run          Print the dispatch plan without executing anything
#   --repos "s1,s2"    Only dispatch for named repo slugs (comma-separated)
#   --all              Dispatch for all repos that have a PROGRAM.md
#
# Requirements:
#   - ~/.factory/config.sh must be sourced-compatible
#   - ~/.factory/programs/{slug}.md must exist for each target repo
#   - claude CLI must be on PATH
#   - git 2.5+ (worktree support)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Source config ─────────────────────────────────────────────────────────────
FACTORY_CONFIG="$HOME/.factory/config.sh"
if [[ ! -f "$FACTORY_CONFIG" ]]; then
  echo "ERROR: Config not found at $FACTORY_CONFIG" >&2
  exit 1
fi
# shellcheck source=/Users/arshya/.factory/config.sh
source "$FACTORY_CONFIG"

# ── Parse arguments ───────────────────────────────────────────────────────────
DRY_RUN=false
REPOS_FILTER=""
DISPATCH_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --repos)
      REPOS_FILTER="$2"
      shift 2
      ;;
    --all)
      DISPATCH_ALL=true
      shift
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      echo "Usage: $0 [--dry-run] [--repos \"slug1,slug2\"] [--all]" >&2
      exit 1
      ;;
  esac
done

# Must specify either --all or --repos
if [[ "$DISPATCH_ALL" == false && -z "$REPOS_FILTER" ]]; then
  echo "ERROR: Specify --all or --repos \"slug1,slug2\"" >&2
  echo "Usage: $0 [--dry-run] [--repos \"slug1,slug2\"] [--all]" >&2
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

# Formatted log prefix
log() { echo "[factory-dispatch] $*"; }
log_dry() { echo "[factory-dispatch] [DRY-RUN] $*"; }
log_err() { echo "[factory-dispatch] ERROR: $*" >&2; }

# Check if a slug is in the REPOS_FILTER list (comma-separated)
slug_is_selected() {
  local slug="$1"
  if [[ "$DISPATCH_ALL" == true ]]; then
    return 0
  fi
  # Check comma-separated filter list
  IFS=',' read -ra filter_arr <<< "$REPOS_FILTER"
  for f in "${filter_arr[@]}"; do
    if [[ "$(echo "$f" | tr -d ' ')" == "$slug" ]]; then
      return 0
    fi
  done
  return 1
}

# Current date in two formats
DATE_TAG="$(date +%b%d | tr '[:upper:]' '[:lower:]')"   # e.g. mar19
DATE_ISO="$(date +%Y%m%d)"                               # e.g. 20260319
DATE_FULL="$(date -u +%Y-%m-%dT%H:%M:%SZ)"              # ISO 8601 UTC

# ── Build dispatch list ───────────────────────────────────────────────────────
# Collect repos that: (a) are in the filter, (b) have a PROGRAM.md

declare -a DISPATCH_LIST  # each entry: "slug|path"

for entry in "${FACTORY_REPOS[@]}"; do
  slug="${entry%%|*}"
  repo_path="${entry#*|}"
  program_file="$FACTORY_PROGRAMS/${slug}.md"

  # Apply slug filter
  if ! slug_is_selected "$slug"; then
    continue
  fi

  # PROGRAM.md is optional in v3 — agents read the vault directly.
  # If it exists, it's copied as input hints. If not, agent plans from vault.
  HAS_PROGRAM=false
  if [[ -f "$program_file" ]]; then
    HAS_PROGRAM=true
  fi

  # Verify repo path exists
  if [[ ! -d "$repo_path" ]]; then
    log_err "Repo path does not exist for $slug: $repo_path"
    continue
  fi

  DISPATCH_LIST+=("${slug}|${repo_path}")
done

if [[ ${#DISPATCH_LIST[@]} -eq 0 ]]; then
  log "Nothing to dispatch. No repos matched with a PROGRAM.md."
  exit 0
fi

# ── Dry-run: print plan and exit ──────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log_dry "Dispatch plan — would spawn ${#DISPATCH_LIST[@]} agent(s):"
  echo ""
  for entry in "${DISPATCH_LIST[@]}"; do
    slug="${entry%%|*}"
    repo_path="${entry#*|}"
    branch="${FACTORY_BRANCH_PREFIX}/${DATE_TAG}"
    worktree=".trees/factory-${DATE_ISO}"
    echo "  Repo:      $slug"
    echo "  Path:      $repo_path"
    echo "  Branch:    $branch"
    echo "  Worktree:  ${repo_path}/${worktree}"
    echo "  Program:   $([ -f "$FACTORY_PROGRAMS/${slug}.md" ] && echo "$FACTORY_PROGRAMS/${slug}.md" || echo "(vault-driven — no PROGRAM.md)")"
    echo "  Log:       ${repo_path}/${worktree}/factory.log"
    echo "  Session:   $FACTORY_RUNS/${slug}-${DATE_ISO}.json"
    echo "  Model:     $AGENT_MODEL"
    echo "  Delay:     ${SPAWN_DELAY_SECONDS}s between spawns"
    echo ""
  done
  log_dry "Re-run without --dry-run to execute."
  exit 0
fi

# ── Generate NIGHT-TASK.md content ────────────────────────────────────────────
# This template instructs the agent to run the full gstack sprint pipeline
# without any interactive prompts. The agent reads this file and runs
# autonomously. All quality gates, /qa-only, /review, and /ship are inlined.
#
# $1 = slug
# $2 = qa_interval
# $3 = review_interval
generate_night_task() {
  local slug="$1"
  local qa_interval="$2"
  local review_interval="$3"
  local branch="${FACTORY_BRANCH_PREFIX}/${DATE_TAG}"
  local vault_ceo="${VAULT_PATH}/01 CEO"
  local memory_file="${FACTORY_MEMORY}/${slug}.md"
  local manifests_dir="${FACTORY_MANIFESTS}"

  cat <<NIGHT_TASK
# NIGHT-TASK v3 — Autonomous Factory Sprint
# Repo: ${slug}
# Branch: ${branch}
# Generated: ${DATE_FULL}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Who You Are

You are a senior developer running an autonomous sprint on ${slug}.
You think like a craftsman — every change deliberate, every commit clean.
You follow the gstack process: Think → Plan → Build → Review → Test → Ship → Reflect.
Each phase feeds the next. Nothing falls through the cracks.

You are NOT a script runner executing a task list. You READ, ASSESS, DECIDE, BUILD.
You have judgment. Use it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Your Context (read all of these before doing anything)

### Strategy (why this repo matters)
- \`${vault_ceo}/Execution Focus Brief.md\` — what matters THIS WEEK
- \`${vault_ceo}/Scoreboard.md\` — what's red (= what you fix first)
- \`${vault_ceo}/Quarterly Priorities.md\` — the bigger picture
- \`${vault_ceo}/AI System Vision.md\` — the north star (skim, don't deep-read)

### This Repo (what you're working with)
- \`CLAUDE.md\` in the repo root — stack, commands, conventions, protected files
- \`git log --oneline -20\` — what was recently shipped
- \`NEXT-PROGRAM-HINTS.md\` if it exists — feedback from the last factory run
- TASKS.md or TODO.md if they exist — known open work

### Product Architecture Validation (CRITICAL — prevents building wrong features)
Before planning ANY items, answer these questions:
- Read the repo's main source files (not just CLAUDE.md). What is the CORE VALUE?
- "Does my plan serve the core value, or am I building nice-to-haves?"
- If the repo is a plugin/integration: what system does it run IN? Check for existing
  plugins/extensions as architectural references (e.g. .clawdbot/extensions/, plugins/).
  Follow the EXISTING integration pattern — don't invent a new one.

### Dedup Check (CRITICAL — prevents rebuilding existing work)
- Check for open factory PRs: \`gh pr list --state open | grep factory\`
- If open PRs exist, read their diffs: \`gh pr diff <N> --name-only\`
- DO NOT rebuild features that exist in open PRs
- If your planned item already exists in an open PR, SKIP IT

### Cross-Repo Intelligence (what other repos shipped)
- \`${manifests_dir}/*.json\` — capability manifests from other factory runs
  Look for downstream_hints that mention ${slug}. These are integration opportunities.

### Learned Patterns (what worked and what didn't)
- \`${memory_file}\` if it exists — failure patterns to avoid, effective patterns to reuse

### Previous Run (if this isn't the first)
- Check \`~/.factory/runs/archive/${slug}-*.json\` for the most recent completed run
  Read its status, items completed, failure patterns. Learn from it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PHASE 1: THINK — Your Assessment (10 minutes max)

After reading all context, write your own assessment. This is YOUR judgment,
not a summary of the docs. Create SCOREBOARD.md and write:

\`\`\`markdown
# SCOREBOARD — ${slug} — ${branch}
Started: [timestamp]

## Sprint Assessment
**Repo state:** [healthy/needs-work/broken — based on git log + tests]
**Strategic priority:** [what the Scoreboard says is red for this repo]
**Biggest opportunity:** [where YOU think the biggest impact is]
**Cross-repo signal:** [any manifest hints that affect this repo]
**Memory warning:** [patterns to avoid from prior runs]

## Sprint Intent
[2-3 sentences: what you will accomplish in this sprint and WHY it matters.
Not "implement items 1-18" but "ship the Shopify data pipeline so Nicholas
can get revenue numbers in his morning briefing by Friday."]
\`\`\`

If docs are missing, outdated, or contradictory — note it and work with what
you have. Flag gaps in Reflect phase for the next run.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PHASE 2: PLAN — Your Sprint Backlog (10 minutes max)

Based on your assessment, create YOUR OWN sprint backlog. You decide what to
build and in what order. Write it in SCOREBOARD.md:

\`\`\`markdown
## Sprint Backlog
| # | What I'll build | Why (strategic reason) | Files | Risk |
|---|----------------|----------------------|-------|------|
| 1 | ... | ... | ... | SAFE/RISK |
\`\`\`

Rules for your backlog:
- Max 25 items. Quality over quantity.
- Order by impact: what moves the Scoreboard metric most?
- Every item must name specific files and a specific behavior change
- SAFE items: you've seen this pattern in the repo, low risk of breaking things
- RISK items: touches >3 files, new pattern, or unfamiliar territory
- If PROGRAM.md exists in this directory, use it as INPUT to your planning
  but don't follow it blindly. Adapt, reorder, skip, or add items based
  on your own assessment.

### Exhaustion Detection

If you can only find 3 or fewer trivial items (typos, comment fixes, badge updates):
**DO NOT do busywork.** Instead, shift to DEEP MODE:

1. Re-read the vault strategy docs — has the strategic priority changed?
2. Run a full code audit: what are the 3 biggest architectural weaknesses?
3. Run test coverage analysis: where are the critical untested paths?
4. Check cross-repo manifests: are there integration opportunities nobody has built?
5. Write a \`## Deep Assessment\` in SCOREBOARD.md:
   - "This repo is exhausted for quick wins. The next high-value work is: [X]"
   - "Estimated effort: [S/M/L]. Requires architecture decision: [yes/no]"
   - "Recommendation: [pause until new strategic input / start deep refactor / shift focus to repo Y]"

Then write PROGRESS.md with status DONE and the deep assessment.
DO NOT fill the backlog with busywork just to have items.

Run the baseline eval gate before building anything:
- Read CLAUDE.md for project-specific commands
- Fall back to: \`npx tsc --noEmit\`, \`npm test\`, \`npm run build\`
- Record baseline in SCOREBOARD.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PHASE 3: BUILD — The Karpathy Loop

For each item in your backlog, top to bottom:

1. **Read** every file you'll modify (never edit blind)
2. **Implement** — one atomic change per commit
3. **Eval** — run ALL project eval commands (from CLAUDE.md or fallback)
4. **Decision:**
   - PASS → \`git commit -m "factory(${slug}): <what changed>"\`
   - FAIL → \`git reset --hard HEAD\` — log failure, move to next item
5. **Track** — update SCOREBOARD.md item row: PASS/FAIL + commit SHA or error
6. **WTF check** — +5% per fail, -2% per pass. If >20%: STOP → Phase 8 (Reflect)

### Quality Gates (built into the loop)

**Every ${qa_interval} completed items — QA Sweep:**
Run full eval suite. If anything regressed since baseline, fix it before continuing.
Log results in SCOREBOARD.md as \`## QA Gate at item N\`.

**Every ${review_interval} completed items — Multi-AI Review:**

Step 1 — Self-review (you):
- \`git log --oneline -${review_interval}\` — review your recent commits
- Check: DRY violations? Naming consistency? Security issues? Unnecessary complexity?
- Fix issues with \`factory(${slug}): review fix — <what>\` commits

Step 2 — Codex review (OpenAI, independent second opinion):
\`\`\`bash
codex exec review --base HEAD~${review_interval} -s read-only 2>/dev/null
\`\`\`
If codex unavailable: skip and note "Codex: SKIPPED" in SCOREBOARD.md.
P1 findings → fix immediately. P2 → fix if easy. P3 → log only.

Step 3 — Cross-model analysis:
Note where both models agree (high confidence) vs. disagree (investigate further).
Log in SCOREBOARD.md as \`## Multi-AI Review at item N\`.

### When You Get Stuck

- **Bug you can't fix in 3 attempts:** skip the item, log evidence, move on
- **Unfamiliar API:** use WebFetch to read docs (max 2 min, max 2 pages)
- **Architectural question:** make the simpler choice, note it as concern in Reflect
- **Protected file conflict:** \`git checkout HEAD -- <file>\`, never modify protected files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PHASE 4: SHIP — Final Audit + PR

When your backlog is done (or you must stop):

1. Run full eval suite one final time
2. \`git diff origin/main..HEAD --stat\` — review everything you changed
3. Check for protected file modifications — revert any accidental touches
4. Check: did you add new code without tests? If yes, write the tests now.
5. Mock-only verification check:
   - Scan test files: do ALL tests use mocks/stubs/fakes with zero real API calls?
   - If yes: set status to DONE_WITH_CONCERNS and add to PROGRESS.md:
     "⚠️ All tests are mock-based. No real-world API verification performed.
      DO NOT consider production-ready without manual integration testing."
   - Never claim PRODUCTION READY if zero real API calls were made.
6. Write PROGRESS.md:

\`\`\`markdown
# PROGRESS — ${slug} — ${branch}
Completed: [timestamp]
Status: [DONE | DONE_WITH_CONCERNS | BLOCKED | BUDGET_EXHAUSTED]

## Sprint Intent
[from Phase 1 — what you set out to accomplish]

## What Shipped
[bullet list with commit SHAs — what actually got built]

## What Failed
[bullet list with reasons — what didn't work and why]

## Multi-AI Review Summary
[key findings from Claude + Codex reviews]

## Concerns
[anything the human reviewer should look at carefully]
\`\`\`

6. Create PR:
   \`git push origin ${branch}\`
   \`gh pr create --title "factory(${slug}): sprint ${DATE_TAG}" --body "\$(cat PROGRESS.md)"\`
   Record PR URL in PROGRESS.md.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PHASE 5: REFLECT — Leave Breadcrumbs (do this even if BLOCKED)

This is the most important phase. It's how the factory gets smarter.

### 5.1 Write NEXT-PROGRAM-HINTS.md (in this worktree)

\`\`\`markdown
# NEXT-PROGRAM-HINTS — ${slug}
Generated: [date] after factory sprint on ${branch}

## Do Not Repeat
[items that failed — specific file + reason, so next agent avoids them]

## Confirmed Patterns
[approaches that worked well — "copying meta-ads adapter as template works"]

## Open Threads
[items skipped or partially done — pick up next time]

## Convention Discoveries
[implicit conventions you discovered — naming, file structure, test patterns]

## Assessment Corrections
[anything your Phase 1 assessment got wrong — recalibrate for next agent]
\`\`\`

### 5.2 Update Factory Memory

Append to \`${memory_file}\` (create if doesn't exist):

\`\`\`markdown
## [date]: ${branch}
- Status: [DONE/BLOCKED/etc]
- Items: [completed/total]
- Top failure: [most common failure pattern]
- Top success: [most effective approach]
- Convention candidate: [pattern seen 2+ times, promote to CLAUDE.md if seen 3+]
\`\`\`

Keep the file under 50 entries (delete oldest if over).

### 5.3 Convention Promotion Check

If any convention was observed 3+ times across this run + memory:
Flag it in SCOREBOARD.md under \`## PROMOTE TO CLAUDE.md\` with the exact
text that should be added. The human reviewer will decide.

### 5.4 Final SCOREBOARD.md Update

Update the header:
\`\`\`markdown
Completed: [N]
Failed: [N]
Skipped: [N]
WTF-likelihood: [N]%
Status: [DONE/BLOCKED/etc]
PR: [URL]
Reflect: NEXT-PROGRAM-HINTS.md written, memory updated
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Constraints (absolute boundaries — never cross these)

- Never push to main or master
- Never use \`git push --force\`
- Never modify protected files listed in CLAUDE.md
- Never install new dependencies without logging as concern
- Never make more than 30 commits in a single run
- Never write to production systems, databases, or external APIs
- Never expose secrets, tokens, or credentials in code or commits
- If CLAUDE.md says "do not touch X" — do not touch X
- If you're unsure about something architectural: pick the simpler option and note it

## BLOCKED.md Format (only if WTF > 20%)

\`\`\`markdown
# BLOCKED — ${slug} — ${branch}
Blocked at: [timestamp]
WTF-likelihood: [N]%
Last item attempted: [text]

## Why
[2-3 sentences — the pattern of failures]

## Evidence
[last 3 error outputs]

## Suggested Action
[what the human should investigate]
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are now ready. Read the context. Make your assessment. Plan your sprint. Build. Ship. Reflect.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 1: THINK

Before touching any code, build strategic context.

## 1.1 Read Context Files

Read ALL of the following that exist (skip any that don't):

1. **PROGRAM.md** — your task list for this sprint.
2. **CLAUDE.md** — the repo's conventions, commands, protected files, architecture.
   Pay special attention to \`## Commands\`, \`## Conventions\`, \`## Protected\` sections.
3. **~/.factory/memory/${slug}.md** — learned patterns from prior factory runs.
   These are hard-won lessons. Treat failure patterns as constraints.
4. **~/.factory/manifests/*.json** — what OTHER repos shipped recently.
   Scan for \`capabilities_added\` and \`downstream_hints\` that affect this repo.
5. **NEXT-PROGRAM-HINTS.md** (in this worktree) — feedback from the last run.
   Items in "Do Not Repeat" are HARD BLOCKS — do not attempt those patterns.
   Items in "Confirmed Patterns" are SAFE to build on.
   Items in "Open Threads" should be continued if they appear in PROGRAM.md.
6. **~/.factory/runs/archive/${slug}-*.json** — find the most recent one.
   Read its \`final_status\`, \`items_completed\`, \`items_failed\` to understand
   how the last run went. If it was BLOCKED, understand why before starting.

## 1.2 Classify PROGRAM.md Items

Read PROGRAM.md. For each \`[ ]\` unchecked item, mentally classify it:

- **P0** — High priority, complex, touches core logic or multiple files.
  These items get explicit planning in Phase 2.
- **RISK** — Touches protected files, external APIs, auth, or database.
  These items get explicit planning AND extra caution during build.
- **SAFE** — Simple, well-understood, single-file changes.
  These items skip planning, just execute.

Items tagged with \`[P0]\` or \`[RISK]\` in PROGRAM.md are pre-classified.
If PROGRAM.md doesn't tag items, classify them yourself based on the above.

## 1.3 Write Sprint Intent

Create SCOREBOARD.md now with this header and a "Sprint Intent" section:

\`\`\`
# SCOREBOARD — ${slug} — ${branch}

Started: ${DATE_FULL}
Total items: N
Completed: 0
Failed: 0
Skipped: 0
WTF-likelihood: 0%

## Sprint Intent
[5 lines max: What this run aims to achieve and why. What's the strategic
context? What did we learn from the last run? What cross-repo signals matter?]
\`\`\`

## 1.4 Discover Eval Commands

Check CLAUDE.md for a \`## Commands\` section. If it exists, use those exact
commands as your eval gate. If CLAUDE.md has no commands section, fall back to:
- \`npx tsc --noEmit\` (if tsconfig.json exists)
- \`pnpm build\` or \`npm run build\` (if package.json has a build script)
- \`pnpm test\` or \`npm test\` (if package.json has a test script)
- If no build system exists: note this in SCOREBOARD.md and skip eval gates.

Record the chosen eval commands in SCOREBOARD.md under \`## Baseline\`.

## 1.5 Establish Baseline

Run the eval commands you identified. Record the result:

\`\`\`
## Baseline
Eval commands: [list the exact commands]
Result: [PASS/FAIL with details]
\`\`\`

If the baseline FAILS, note the pre-existing failures. You are not responsible
for fixing pre-existing issues unless PROGRAM.md explicitly asks you to.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 2: PLAN

For each P0 and RISK item in PROGRAM.md, write a brief plan.
SAFE items do not need explicit plans — just execute them in the Build phase.

## 2.1 Sprint Plan

Add a \`## Sprint Plan\` section to SCOREBOARD.md:

\`\`\`
## Sprint Plan

### Item N: [first 60 chars of item text] (P0/RISK)
- Approach: [2-3 sentences — what files to touch, what pattern to follow]
- Risks: [what could go wrong, what's the rollback strategy]
- Memory check: [any relevant failure patterns from ~/.factory/memory/${slug}.md]

### Item M: [first 60 chars] (P0)
- Approach: ...
- Risks: ...
- Memory check: ...
\`\`\`

For SAFE items, just list them as: \`### SAFE items: [count] — no explicit plan needed\`

If memory/${slug}.md contains failure patterns relevant to ANY planned item,
note the conflict explicitly and adjust the approach to avoid the known failure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 3: BUILD

The main implementation loop. Repeat until all items are processed or you must stop.

### Step A — Pick Item
Pick the next unchecked \`[ ]\` item from PROGRAM.md (top to bottom).
If none remain, proceed to Phase 7 (Ship).

### Step B — Research (if non-trivial)
If the item touches unfamiliar APIs or patterns:
- Use WebFetch to read relevant docs (max 2 min, max 2 pages).
- Read existing source files for conventions/patterns.
- Do NOT research trivial changes (typos, config values, simple refactors).

### Step C — Read Source + Conventions
Read every file you will modify before touching it.
Never modify a file you haven't read in this session.

**Also**: before each item, re-check the relevant CLAUDE.md conventions.
If CLAUDE.md has a \`## Conventions\` section, ensure your change follows it.
If the item is P0 or RISK, re-read the Sprint Plan for this item.

### Step D — Implement
Make the change. Keep it atomic — one logical change per commit.
Do not bundle unrelated edits.
For P0/RISK items, follow the planned approach from Phase 2.

### Step E — Eval Gate
Run the eval commands identified in Phase 1 (Step 1.4).
Use the repo's specific commands first. ALL must pass.

### Step F — Gate Decision

**If ALL gates PASS:**
- \`git add -A && git commit -m "factory(${slug}): <item summary>"\`
- Mark the item \`[x]\` in PROGRAM.md.
- Update SCOREBOARD.md: add PASS row with commit SHA, increment Completed.
- Add a \`- [x] <item summary>\` line in SCOREBOARD.md Items section.

**If ANY gate FAILS:**
- \`git reset --hard HEAD\` (discard changes, do NOT commit broken code)
- Log the failure with exact error output in SCOREBOARD.md.
- Add a \`- [F] <item summary> — FAILED: <reason>\` line in SCOREBOARD.md Items section.
- Increment Failed counter and WTF-likelihood by 5%.
- Proceed to next item.

### Step G — WTF Check
After each item (pass or fail), evaluate WTF-likelihood:
- Increase by 5% for each consecutive failure.
- Decrease by 2% for each pass (floor 0%).
- If WTF-likelihood > 20%: STOP. Write BLOCKED.md (see format below). Go to Phase 8 (Reflect).

### Step H — QA Gate (every ${qa_interval} completed items)
When Completed counter is a multiple of ${qa_interval}:

Run the full QA sweep:
1. Run ALL eval commands from Phase 1.
2. Record QA Gate result in SCOREBOARD.md:
   \`\`\`
   ## QA Gate at item N
   [command 1]: [PASS/FAIL — details]
   [command 2]: [PASS/FAIL — details]
   Overall: [PASS/FAIL]
   \`\`\`
3. **Test coverage check**: if you added new code files, did you add test files?
   If a new source file has no corresponding test, log it as a concern.
4. If QA Gate FAILS: stop new items, diagnose, fix, then continue.

### Step I — Review Gate (every ${review_interval} completed items)
When Completed counter is a multiple of ${review_interval}:

Run the deep review sweep:
1. \`git diff HEAD~${review_interval}..HEAD --stat\` — summarize what changed.
2. **Protected file check**: look for changes to CLAUDE.md, schema/migration
   files, auth modules, or any files listed in CLAUDE.md \`## Protected\`.
3. **Security scan**: check for hardcoded secrets, API keys, tokens, or
   credentials in the diff. \`git diff HEAD~${review_interval}..HEAD | grep -iE "(api_key|secret|token|password|credential)" || true\`
4. **Dependency check**: any new deps in package.json? If yes, justify in SCOREBOARD.md.
5. **Pattern consistency**: are new files following the repo's existing patterns?
   Check naming, directory structure, import style against existing files.
6. **Cross-reference CLAUDE.md conventions**: does the diff violate any stated convention?
7. Run eval commands.
8. Record Review Gate result in SCOREBOARD.md:
   \`\`\`
   ## Review Gate at item N
   Files changed: N
   Protected files touched: [none / list them]
   New deps: [none / list them]
   Security scan: [CLEAN / list findings]
   Pattern consistency: [OK / concerns]
   Convention compliance: [OK / violations]
   Eval gate: [PASS/FAIL]
   Overall: [PASS/CLEAN/CONCERNS]
   Concerns: [list any]
   \`\`\`
9. If concerns exist, fix them before continuing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 4: MULTI-AI REVIEW (after every 10 completed items)

Cross-model quality gate. Run this when Completed reaches 10, 20, 30, etc.
Two AI models review the same diff — catches what a single model misses.

## 4.1 Self-Review (Claude — you)
1. Review the last 10 commits: \`git log --oneline -10\`
2. For each commit, check:
   - Is this change minimal? Could it be simpler?
   - Does it follow the repo's existing patterns?
   - Did I duplicate logic that already exists somewhere?
3. **DRY check**: scan for duplicated logic. Fix with \`factory(${slug}): review fix — deduplicate <what>\`
4. **Naming check**: are new names clear and consistent with conventions?
5. **Security scan**: check for hardcoded secrets, exposed credentials, open endpoints.
6. Fix any issues as separate commits with prefix \`factory(${slug}): review fix —\`

## 4.2 Codex Review (OpenAI — independent second opinion)
Run the OpenAI Codex CLI in review mode for a cross-model analysis:

\`\`\`bash
codex exec review --base HEAD~10 -s read-only 2>/dev/null
\`\`\`

If codex CLI is not available (command not found), skip this step and note
"Codex review: SKIPPED (CLI not available)" in SCOREBOARD.md.

If codex returns findings:
- For each P1 (critical) finding: fix it immediately with \`factory(${slug}): codex fix —\` commit
- For each P2 (important) finding: fix if straightforward, otherwise log as concern
- For each P3 (minor) finding: log in SCOREBOARD.md, do not fix

## 4.3 Cross-Model Analysis
After both reviews complete, note where Claude and Codex findings overlap
(high confidence issues) vs. where only one model flagged something
(worth investigating but lower confidence).

Log results in SCOREBOARD.md:

\`\`\`
## Multi-AI Review Gate at item N
Claude self-review: [N issues found, M fixed]
Codex review: [PASS/FAIL/SKIPPED — N findings: X P1, Y P2, Z P3]
Cross-model overlap: [N issues flagged by both models]
Fixes applied: [list commit SHAs]
Overall: [CLEAN / N fixes applied / CONCERNS]
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 5: REVIEW

This is the Review Gate from Step I in the Build loop. It runs every
${review_interval} completed items. The full specification is above in Step I.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 6: TEST

This is the QA Gate from Step H in the Build loop. It runs every
${qa_interval} completed items. The full specification is above in Step H.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 7: SHIP (Final Audit + PR)

When all PROGRAM.md items are processed (or loop exited cleanly):

## 7.1 Final Eval Gate
Run ALL eval commands one final time. Record results.

## 7.2 Full Diff Audit
1. \`git diff origin/main..HEAD --stat\` — full diff summary.
2. Check for protected file modifications:
   \`git diff origin/main..HEAD --name-only | grep -E "(CLAUDE\\.md|schema\\.ts|migrations/|auth\\.ts)"\`
   If any protected files appear, log them as concerns.

## 7.3 Write Final SCOREBOARD.md Summary
Update the header counts. Ensure all items have rows.

## 7.4 Write PROGRESS.md

\`\`\`
# PROGRESS — ${slug} — ${branch}

Completed: [current timestamp]
Status: [DONE | DONE_WITH_CONCERNS | BLOCKED | BUDGET_EXHAUSTED]

## Summary
- Items completed: N / total
- Items failed: N
- Items skipped: N
- QA gates passed: N
- Review gates passed: N
- Multi-AI review gates passed: N
- Final eval: [PASS/FAIL with details]

## Sprint Intent
[copied from SCOREBOARD.md — what this run aimed to achieve]

## What shipped
[bullet list of completed items with commit SHAs]

## What failed
[bullet list of failed items with reasons]

## Multi-AI Review Results
[summary of Claude self-review + Codex findings, cross-model overlaps, fixes applied]

## Concerns
[any protected file touches, unexpected deps, security findings, degradations]

## Reflect
- Patterns learned: N
- Conventions discovered: N
- CLAUDE.md promotion candidates: N
- NEXT-PROGRAM-HINTS.md: written
- Memory updated: yes/no

## PR
[URL from gh pr create]
\`\`\`

Status meanings:
- DONE: All items complete, all gates green, no concerns.
- DONE_WITH_CONCERNS: Items complete, gates green, but concerns exist.
- BLOCKED: WTF-likelihood exceeded 20%. See BLOCKED.md.
- BUDGET_EXHAUSTED: Hit token budget before completing all items.

## 7.5 Create PR
- \`git push origin ${branch}\`
- \`gh pr create --title "factory(${slug}): sprint ${DATE_TAG}" --body "\$(cat PROGRESS.md)"\`
- Record the PR URL in PROGRESS.md and SCOREBOARD.md.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# PHASE 8: REFLECT (most important phase — do this even if BLOCKED)

After the PR is created (or after writing BLOCKED.md), BEFORE you exit:

## 8.1 Write NEXT-PROGRAM-HINTS.md

Create or overwrite NEXT-PROGRAM-HINTS.md in this worktree:

\`\`\`
# NEXT-PROGRAM-HINTS — ${slug}
Generated: [current timestamp] after factory sprint

## Do Not Repeat
[Items that failed, with SPECIFIC reasons — so the next planner avoids these.
Include: item text, what was tried, why it failed, file paths involved.]

## Confirmed Patterns
[Patterns that worked well — so the next planner recommends these.
Include: what pattern, which files, why it worked.]

## Open Threads
[Items that were partially done or blocked — pick up next time.
Include: what was started, what remains, any context needed.]

## Convention Discoveries
[Implicit conventions you discovered during the run that are NOT in CLAUDE.md.
Include: the convention, where you observed it, confidence level.]
\`\`\`

## 8.2 Update Factory Memory

Append a new entry to ~/.factory/memory/${slug}.md (create if it doesn't exist).
Use this exact format:

\`\`\`
## [current date]: ${slug} sprint (${branch})

### Failure patterns
[items that required revert — what file, what error, why]

### Effective patterns
[items that passed first try on complex changes — what approach worked]

### CLAUDE.md hint candidates
[conventions discovered that should potentially become rules in CLAUDE.md]
\`\`\`

Rules for memory updates:
- Add at most 10 new lines per run.
- If the file already has 45+ entries (## date headers), do NOT add more.
  Instead, note "Memory file near capacity" in SCOREBOARD.md.
- Never delete existing memory entries.

## 8.3 Convention Promotion Check

Review ALL conventions you discovered during this run.
If any convention was observed 3+ times during this sprint
(e.g., you followed the same implicit pattern in 3+ items):

Add to SCOREBOARD.md:
\`\`\`
## Convention Promotion Candidates
- PROMOTE TO CLAUDE.md: "[convention description]" — observed N times
  Evidence: [which items demonstrated this]
\`\`\`

## 8.4 Update PROGRESS.md Reflect Section

Go back and fill in the Reflect section of PROGRESS.md:
\`\`\`
## Reflect
- Patterns learned: N
- Conventions discovered: N
- CLAUDE.md promotion candidates: N
- NEXT-PROGRAM-HINTS.md: written
- Memory updated: yes/no
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## BLOCKED.md Format (only if WTF > 20%)

\`\`\`
# BLOCKED — ${slug} — ${branch}

Blocked at: [timestamp]
WTF-likelihood: [N]%
Last item attempted: [item text]

## Why blocked
[2-3 sentences describing the pattern of failures]

## Evidence
[last 3 error outputs that contributed to WTF score]

## Suggested next action
[what a human should look at to unblock]
\`\`\`

When BLOCKED: skip Phase 7 (Ship) but STILL run Phase 8 (Reflect).
The learning from a blocked run is MORE valuable than a clean run.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## SCOREBOARD.md Items Format

Use this format for the Items section so downstream tools can parse it:

\`\`\`
## Items

- [x] Item 1 summary — commit abc1234
- [F] Item 2 summary — FAILED: type error in foo.ts
- [x] Item 3 summary — commit def5678
- [ ] Item 4 summary — not yet attempted
\`\`\`

Prefixes: \`[x]\` = completed, \`[F]\` = failed/reverted, \`[ ]\` = pending.
This format is required for factory-heartbeat.sh and factory-post-run.sh compatibility.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Constraints (DO NOT violate)

### CRITICAL — Fork Safety
- When creating PRs with \`gh pr create\`, ALWAYS use \`--repo\` flag pointing to YOUR fork.
  Detect it: \`ORIGIN_REPO=\$(git remote get-url origin | sed 's|.*github.com[:/]||' | sed 's|.git\$||')\`
  Then: \`gh pr create --repo "\$ORIGIN_REPO" ...\`
  NEVER let gh pr create default to upstream on forked repos. This leaks code to public repos.
- Never commit factory artifacts (NIGHT-TASK.md, factory.log) to the repo.
  Add them to .gitignore FIRST: \`echo -e "NIGHT-TASK.md\\nfactory.log" >> .gitignore && git add .gitignore && git commit -m "chore: ignore factory artifacts"\`

### Code Safety
- Never modify CLAUDE.md, DESIGN.md, schema migration files, or auth modules
  unless PROGRAM.md EXPLICITLY asks you to AND the item is tagged [RISK].
- Never push to main or master branch.
- Never use \`git push --force\`.
- Never install new npm packages without logging them as a concern in SCOREBOARD.md.
- Never make more than 30 commits in a single run (including review fix commits).
- Never commit secrets, tokens, API keys, or credentials.
- Never write to production systems, databases, or external APIs.
- If PROGRAM.md is empty or has no \`[ ]\` items: write PROGRESS.md with
  status DONE and "No items to process" summary. Still run Phase 8 (Reflect).
- If the eval gate doesn't exist (no package.json): note it in SCOREBOARD.md
  and skip eval gates, but still run all other phases.
- Always prefer the repo's own eval commands (from CLAUDE.md ## Commands) over
  the fallback commands.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Execution Order Summary

1. THINK  — Read context, classify items, write sprint intent, find eval commands, baseline
2. PLAN   — Write sprint plan for P0/RISK items
3. BUILD  — Main loop: pick → research → read → implement → eval → gate → WTF check
   - Every ${qa_interval} items: QA Gate (Phase 6/Test)
   - Every ${review_interval} items: Review Gate (Phase 5/Review)
   - Every 10 items: Grill Gate (Phase 4/Grill)
4. SHIP   — Final audit, write PROGRESS.md, create PR
5. REFLECT — Write NEXT-PROGRAM-HINTS.md, update memory, check promotions

If BLOCKED: skip Ship, still run Reflect.
If BUDGET_EXHAUSTED: run Ship with partial results, then Reflect.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## You are now ready to begin.

Start with Phase 1: THINK. Read all context files. Make your assessment. Build something great.
NIGHT_TASK
}

# ── Spawn loop ────────────────────────────────────────────────────────────────
SPAWNED_COUNT=0
declare -a SPAWNED_PIDS
declare -a SPAWNED_SLUGS

for entry in "${DISPATCH_LIST[@]}"; do
  slug="${entry%%|*}"
  repo_path="${entry#*|}"
  branch="${FACTORY_BRANCH_PREFIX}/${DATE_TAG}"
  worktree_name="factory-${DATE_ISO}"
  worktree_path="${repo_path}/.trees/${worktree_name}"
  program_src="$FACTORY_PROGRAMS/${slug}.md"
  session_file="$FACTORY_RUNS/${slug}-${DATE_ISO}.json"

  log "── $slug ──────────────────────────────────────────"
  log "Repo:     $repo_path"
  log "Branch:   $branch"
  log "Worktree: $worktree_path"

  # ── Step 0: Merge pending factory PRs (prevents duplicate work) ──────────
  (cd "$repo_path" && {
    local_prs=$(gh pr list --state open --json number,title,mergeable \
      -q '[.[] | select(.title | startswith("factory")) | select(.mergeable == "MERGEABLE")] | .[].number' 2>/dev/null)
    for pr_num in $local_prs; do
      log "Auto-merging factory PR #$pr_num before new sprint..."
      gh pr merge "$pr_num" --squash --body "Factory auto-merge before next sprint" 2>/dev/null \
        && log "  Merged #$pr_num" \
        || log "  Failed to merge #$pr_num — skipping"
    done
  }) 2>/dev/null

  # ── Step 1: git fetch ────────────────────────────────────────────────────
  log "Fetching origin..."
  (cd "$repo_path" && git fetch origin) || {
    log_err "git fetch failed for $slug — skipping"
    continue
  }

  # ── Step 2: Create branch if it doesn't exist ────────────────────────────
  (cd "$repo_path" && {
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
      log "Branch $branch already exists."
    else
      # Create the branch from origin/main if available, else from HEAD
      if git show-ref --verify --quiet "refs/remotes/origin/main"; then
        git branch "$branch" "origin/main"
        log "Created branch $branch from origin/main."
      elif git show-ref --verify --quiet "refs/remotes/origin/master"; then
        git branch "$branch" "origin/master"
        log "Created branch $branch from origin/master."
      else
        git branch "$branch" HEAD
        log "Created branch $branch from HEAD."
      fi
    fi
  }) || {
    log_err "Failed to create branch $branch for $slug — skipping"
    continue
  }

  # ── Step 3: Create worktree ───────────────────────────────────────────────
  (cd "$repo_path" && {
    if [[ -d "$worktree_path" ]]; then
      log "Worktree $worktree_path already exists — reusing."
    else
      mkdir -p "${repo_path}/.trees"
      git worktree add "$worktree_path" "$branch" 2>/dev/null || {
        # Worktree might already be registered under a different path — prune + retry
        log "Worktree add failed, pruning stale entries and retrying..."
        git worktree prune
        git worktree add "$worktree_path" "$branch"
      }
      log "Worktree created at $worktree_path"
    fi
  }) || {
    log_err "Failed to create worktree for $slug — skipping"
    continue
  }

  # ── Step 4: Copy PROGRAM.md if it exists (optional hints for the agent) ──
  if [[ "$HAS_PROGRAM" == true ]]; then
    cp "$program_src" "${worktree_path}/PROGRAM.md"
    log "Copied PROGRAM.md to worktree (agent will use as input hints)."
  else
    log "No PROGRAM.md — agent will plan from vault context directly."
  fi

  # ── Step 5: Generate and write NIGHT-TASK.md ─────────────────────────────
  generate_night_task "$slug" "$QA_INTERVAL" "$REVIEW_INTERVAL" \
    > "${worktree_path}/NIGHT-TASK.md"
  log "Generated NIGHT-TASK.md."

  # ── Step 6: Spawn agent ───────────────────────────────────────────────────
  AGENT_PROMPT="Read NIGHT-TASK.md. You are a senior developer running an autonomous sprint. Read all context files listed in NIGHT-TASK.md. Make your own assessment. Plan your own backlog. Build, review, test, ship, reflect. Do not ask questions. Do not use AskUserQuestion. Start now."

  log "Spawning agent (model: $AGENT_MODEL)..."
  (
    cd "$worktree_path"
    # Extend PATH so agent can find codex, greptile, and other global tools
    # Ensure codex binary is on PATH — run 'which codex' to find it
    export PATH="${FACTORY_EXTRA_PATH:-}:$PATH"
    # shellcheck disable=SC2094
    nohup claude \
      --dangerously-skip-permissions \
      --model "$AGENT_MODEL" \
      -p "$AGENT_PROMPT" \
      > "${worktree_path}/factory.log" 2>&1 &
    echo $!
  ) > /tmp/factory_pid_$$ 2>&1
  AGENT_PID=$(cat /tmp/factory_pid_$$ 2>/dev/null || echo "0")
  rm -f /tmp/factory_pid_$$

  if [[ -z "$AGENT_PID" || "$AGENT_PID" == "0" ]]; then
    log_err "Failed to get PID for $slug agent — check if claude CLI is on PATH"
    AGENT_PID=0
  else
    log "Agent spawned with PID $AGENT_PID."
  fi

  # ── Step 7: Write session JSON ────────────────────────────────────────────
  mkdir -p "$FACTORY_RUNS"
  cat > "$session_file" <<SESSION_JSON
{
  "repo": "${slug}",
  "repo_path": "${repo_path}",
  "branch": "${branch}",
  "worktree": "${worktree_path}",
  "pid": ${AGENT_PID},
  "program_file": "${program_src}",
  "items_total": null,
  "items_completed": 0,
  "items_failed": 0,
  "status": "RUNNING",
  "started": "${DATE_FULL}",
  "updated": "${DATE_FULL}",
  "completed": null,
  "wtf_likelihood": 0,
  "qa_gates_passed": 0,
  "review_gates_passed": 0,
  "manifest_published": false,
  "telegram_sent": false,
  "pr_url": null,
  "merged": false,
  "agent_model": "${AGENT_MODEL}",
  "log_file": "${worktree_path}/factory.log",
  "scoreboard": "${worktree_path}/SCOREBOARD.md",
  "progress": "${worktree_path}/PROGRESS.md"
}
SESSION_JSON
  log "Session written to $session_file"

  # Track for summary
  SPAWNED_PIDS+=("$AGENT_PID")
  SPAWNED_SLUGS+=("$slug")
  SPAWNED_COUNT=$((SPAWNED_COUNT + 1))

  # ── Step 8: Spawn delay (RPM protection) ─────────────────────────────────
  # Don't sleep after the last agent
  remaining_count=$(( ${#DISPATCH_LIST[@]} - SPAWNED_COUNT ))
  if [[ $remaining_count -gt 0 ]]; then
    log "Sleeping ${SPAWN_DELAY_SECONDS}s before next spawn..."
    sleep "$SPAWN_DELAY_SECONDS"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
log "══════════════════════════════════════════════════"
if [[ $SPAWNED_COUNT -eq 0 ]]; then
  log "No agents dispatched."
else
  log "Dispatched $SPAWNED_COUNT agent(s)."
  echo ""

  # Build PID list string
  PID_LIST=""
  for i in "${!SPAWNED_SLUGS[@]}"; do
    slug="${SPAWNED_SLUGS[$i]}"
    pid="${SPAWNED_PIDS[$i]}"
    PID_LIST="${PID_LIST}${slug}=${pid} "
    log "  $slug → PID $pid | log: $HOME/.factory/runs/${slug}-${DATE_ISO}.json"
  done

  echo ""
  log "Dispatched $SPAWNED_COUNT agents. PIDs: ${PID_LIST% }"
  echo ""
  log "Monitor logs:"
  for i in "${!SPAWNED_SLUGS[@]}"; do
    slug="${SPAWNED_SLUGS[$i]}"
    worktree_name="factory-${DATE_ISO}"
    # Reconstruct worktree path for display
    for entry in "${FACTORY_REPOS[@]}"; do
      if [[ "${entry%%|*}" == "$slug" ]]; then
        repo_path="${entry#*|}"
        log "  tail -f \"${repo_path}/.trees/${worktree_name}/factory.log\""
        break
      fi
    done
  done
  echo ""
  log "Run factory-heartbeat.sh to monitor progress."
fi
log "══════════════════════════════════════════════════"
