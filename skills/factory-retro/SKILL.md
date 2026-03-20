---
name: factory-retro
version: 1.0.0
description: |
  Weekly factory retrospective feeding the CEO Weekly Review.
  Reads all ~/.factory/runs/archive/*.json from the current week,
  aggregates metrics across repos, and generates a structured retro
  in CEO Weekly Review format. Writes to ~/.factory/retros/ and
  optionally to the vault staging folder.
  Trigger: "factory retro", "weekly retro", "what shipped this week"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---

# /factory-retro — Weekly Factory Retrospective

Generates a weekly retrospective from factory run data, feeding into the CEO Weekly Review template. Reads session archives, SCOREBOARD.md files, git logs, and memory patterns. Outputs structured markdown aligned to the vault Weekly Review format.

## Trigger phrases
- "factory retro"
- "weekly retro"
- "what shipped this week"

---

## Step 0: Load config and establish week boundaries

```bash
source ~/.factory/config.sh 2>/dev/null || true

# Determine current week (Monday 00:00:00 → Sunday 23:59:59)
WEEK_MONDAY=$(date -v-mon +%Y-%m-%d 2>/dev/null || date -d "last monday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
WEEK_SUNDAY=$(date -v+sun +%Y-%m-%d 2>/dev/null || date -d "next sunday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
ISO_YEAR=$(date +%Y)
ISO_WEEK=$(date +%V)

echo "WEEK: $WEEK_MONDAY → $WEEK_SUNDAY"
echo "ISO: ${ISO_YEAR}-W${ISO_WEEK}"
echo "FACTORY_HOME: ${FACTORY_HOME:-$HOME/.factory}"
```

Set `FACTORY_HOME` to `~/.factory` if the config didn't define it.

---

## Step 1: Collect run archives for this week

```bash
ARCHIVE_DIR="${FACTORY_HOME:-$HOME/.factory}/runs/archive"
ls "$ARCHIVE_DIR"/*.json 2>/dev/null || echo "NO_ARCHIVES"
```

For each `.json` file in the archive directory, read the file (using the Read tool) and check if the `started` field falls within Monday–Sunday of the current week. Collect all in-window sessions into a working list. If no sessions exist for the current week, check last week (subtract 7 days) and note that in the output.

Parse each session JSON for:
- `repo` — repository slug
- `repo_path` — full path on disk
- `branch` — factory branch name
- `status` — DONE | DONE_WITH_CONCERNS | BLOCKED | BUDGET_EXHAUSTED | CRASHED
- `items_total` — planned items
- `items_completed` — completed items
- `items_failed` — failed items
- `wtf_likelihood` — final WTF score
- `quality_gates_passed` — number of quality gates passed
- `pr_url` — PR URL if created
- `merged` — boolean
- `started` / `completed` — ISO timestamps
- `scoreboard_path` — path to SCOREBOARD.md (if present in JSON; otherwise derive from `worktree` field)

---

## Step 2: Read SCOREBOARD.md files

For each in-window session that has a `worktree` or `scoreboard_path` field:

1. Derive the SCOREBOARD.md path: `{worktree}/SCOREBOARD.md`
2. Read the file using the Read tool (skip gracefully if missing)
3. Parse each row for:
   - Item description
   - Pass/fail outcome
   - Failure notes or revert reason (if present)
   - WTF-likelihood recorded at that point

Extract the top failure patterns: lines that contain "revert", "fail", "BLOCKED", "WTF", or "reset". Collect all unique failure descriptions across all sessions. These are the raw failure evidence.

---

## Step 3: Read git logs across all registered repos (last 7 days)

For each repo in `FACTORY_REPOS` (from config), run:

```bash
# For each slug|path pair:
SLUG="connectos"
REPO_PATH="/Users/arshya/Desktop/AI.nosync/ConnectOS"

git -C "$REPO_PATH" log --oneline --since="${WEEK_MONDAY}T00:00:00" --until="${WEEK_SUNDAY}T23:59:59" \
  --branches="factory/*" 2>/dev/null || echo "${SLUG}: no factory commits this week"

# Count merged PRs (factory branches merged into main/master)
git -C "$REPO_PATH" log --oneline --since="${WEEK_MONDAY}T00:00:00" --merges 2>/dev/null | \
  grep -i "factory" | wc -l || echo "0"
```

Collect per-repo:
- Factory commit count this week
- Merged factory branches (PRs merged count)
- Discarded factory branches (session JSON has pr_url but merged=false and status not RUNNING)

---

## Step 4: Read memory files for accumulated patterns

```bash
MEMORY_DIR="${FACTORY_HOME:-$HOME/.factory}/memory"
ls "$MEMORY_DIR"/*.md 2>/dev/null || echo "NO_MEMORY_FILES"
```

Read each `~/.factory/memory/{repo}.md` using the Read tool. Extract:
- Entries with dates in the current or previous week (recent learnings)
- Any "CLAUDE.md hint candidates" sections — these are pre-identified failure patterns
- "Effective patterns" sections — these are working approaches to preserve

---

## Step 5: Read prior retro for week-over-week comparison

```bash
RETRO_DIR="${FACTORY_HOME:-$HOME/.factory}/retros"
ls "$RETRO_DIR"/*.md 2>/dev/null | sort -r | head -5 || echo "NO_PRIOR_RETROS"
```

Load the most recent prior retro (if any) using the Read tool. Extract last week's metrics for comparison:
- Total runs
- Items completed / total planned
- Pass rate
- Top failure pattern

If no prior retro exists, note "First factory retro — no comparison available."

---

## Step 6: Aggregate metrics

Compute the following from Steps 1–4:

| Metric | Calculation |
|--------|-------------|
| Total runs this week | Count of in-window session JSONs |
| Items completed | Sum of `items_completed` across all sessions |
| Items planned | Sum of `items_total` across all sessions |
| Completion rate | items_completed / items_planned × 100 |
| Pass rate | Sessions with status DONE or DONE_WITH_CONCERNS / total sessions × 100 |
| First-try pass rate | Items with no revert/fail entries in SCOREBOARD / items_completed × 100 (approximate from SCOREBOARD data) |
| Repos active | Count of distinct `repo` values across sessions |
| PRs merged | Count of sessions where `merged = true` |
| PRs discarded | Count of sessions where pr_url exists and merged = false and status is terminal |
| PRs in review | Count of sessions where pr_url exists and merged = false and status is DONE or DONE_WITH_CONCERNS |
| Blocked sessions | Count of sessions with status BLOCKED |
| Budget exhausted | Count of sessions with status BUDGET_EXHAUSTED |
| Crashed sessions | Count of sessions with status CRASHED |
| Avg WTF likelihood | Mean of final `wtf_likelihood` values across completed sessions |
| Top failure patterns | Top 3 recurring failure descriptions from SCOREBOARD parsing |
| Cross-repo items | Items in any SCOREBOARD that reference another repo slug (e.g., "ConnectOS adapter") |
| API cost estimate | If `api_cost_usd` present in session JSON, sum it; otherwise note "not tracked" |

**Week-over-week deltas** (if prior retro exists):
- Throughput trend: compare items_completed this week vs last week → "up N%" or "down N%"
- Failure rate trend: compare (1 - pass_rate) vs last week → "improving" or "degrading"
- Planner accuracy: completion_rate this week vs last week

---

## Step 7: Identify cross-repo connections

From the SCOREBOARD.md files and capability manifests:

```bash
MANIFESTS_DIR="${FACTORY_HOME:-$HOME/.factory}/manifests"
ls "$MANIFESTS_DIR"/*.json 2>/dev/null | head -20 || echo "NO_MANIFESTS"
```

Read any manifests published during the week. Look for `downstream_hints` fields. Cross-reference against SCOREBOARD items that mention another repo — these are cross-repo items that connected (a manifest triggered a downstream task).

List at most 5 such connections in the retro.

---

## Step 8: Identify top 3 failure patterns

From the raw failure evidence collected in Step 2, group by similarity:
- Same file path mentioned in 2+ failures → file-specific pattern
- Same error type (TypeScript, test mock, import alias, etc.) → error-type pattern
- Same stage (quality gate, revert, WTF threshold) → stage pattern

Pick the top 3 by frequency. For each, note:
- Pattern description (one sentence)
- How many times observed (N occurrences across M sessions)
- Whether it already has a CLAUDE.md hint candidate in memory

---

## Step 9: Generate the retro document

Compose the full retro document. Use the CEO Weekly Review template structure. Fill each section with factory data. Sections that have no factory data (e.g., "Nicholas Engagement") are left as template placeholders — do not fabricate data for non-factory sections.

The document structure follows below (use exact section numbering from the vault template):

---

```markdown
---
type: weekly-review
date: {YYYY-MM-DD}  (Friday of current week)
week: {ISO_YEAR}-W{ISO_WEEK}
source: factory-retro
---

# CEO Weekly Review — Week {ISO_WEEK}, {YEAR}

> Generated by /factory-retro on {date}. Factory sections are auto-populated.
> Non-factory sections require manual completion.

---

## 1) Outcome review

**3 priorities this week (from factory perspective):**
- [ ] {Repo 1}: {top shipped item or goal}
- [ ] {Repo 2}: {top shipped item or goal}
- [ ] {Repo 3 if active}: {top shipped item or goal}

**Completed this week (factory):**
{For each merged PR: "- [{repo}] {branch}: {items_completed}/{items_total} items — PR: {pr_url}"}
{If no merged PRs: "- No PRs merged this week. N sessions in review."}

**Unfinished and why:**
{For each BLOCKED or BUDGET_EXHAUSTED session: "- [{repo}] {branch}: {status} — {reason from BLOCKED.md or last SCOREBOARD entry}"}
{If none: "- All sessions completed or in review."}

**Weekly goal reached:** {yes / no / partial — based on completion_rate >= 70% = yes, 40-70% = partial, <40% = no}

---

## 2) KPI review

### Factory Metrics

| Metric | This Week | Last Week | Delta |
|--------|-----------|-----------|-------|
| Total runs | {N} | {N or —} | {↑/↓/—} |
| Items completed / planned | {N}/{N} ({pct}%) | {N or —} | {↑/↓/—} |
| Pass rate (sessions) | {N}% | {N or —}% | {↑/↓/—} |
| First-try item pass rate | {N}% | {N or —}% | {↑/↓/—} |
| Repos active | {N} | {N or —} | — |
| PRs merged | {N} | {N or —} | {↑/↓/—} |
| PRs discarded | {N} | {N or —} | — |
| PRs in review | {N} | — | — |
| Avg WTF likelihood | {N}% | {N or —}% | {↑/↓/—} |
| API cost estimate | {$N or "not tracked"} | — | — |

### Per-Repo Summary

| Repo | Status | Items (done/total) | PR |
|------|--------|--------------------|----|
{For each repo with sessions: "| {repo} | {status} | {completed}/{total} | {pr_url or —} |"}
{If no sessions for a repo: "| {repo} | no run | — | — |"}

---

## 3) Decision log

**Decisions deferred by factory (BLOCKED sessions):**
{List each BLOCKED session with the blocking reason. If none: "None — all sessions ran to completion or budget."}

**What was blocked by missing information:**
{Any items in SCOREBOARD.md that mention "needs founder input", "architecture decision", "unclear spec". If none: "None flagged."}

**Should be escalated next week:**
{Items from BLOCKED.md files or high-WTF items that couldn't be resolved autonomously.}

---

## 4) Next week planning

**Carry forward top 3 factory priorities:**
1. {Highest-impact unfinished item from sessions, or next logical step from manifests}
   - Risk: {e.g., "high WTF likelihood based on memory"}
   - Mitigation: {e.g., "add explicit CLAUDE.md hint before next run"}
2. {Second priority}
   - Risk: {}
   - Mitigation: {}
3. {Third priority}
   - Risk: {}
   - Mitigation: {}

---

## 5) System upkeep

- [ ] Archive completed session JSONs (move from runs/ to runs/archive/) — {N already archived}
- [ ] Review and merge/discard open factory PRs: {list pr_urls in review}
- [ ] Update ~/.factory/memory/ with this week's learnings (see Factory Health section below)
- [ ] Keep programs/ clean: archive PROGRAM.md files from completed cycles

---

## 6) Promotion operating dashboard

> Manual section — not auto-populated by factory-retro.

- [ ] Open [[70 Sources/Multi-Source Promotion Dashboard]]
- [ ] Open [[01 CEO/Multi-Source Promotion Brief]]

---

## 7) Source promotion ledgers

> Manual section — not auto-populated by factory-retro.

- [ ] Open [[70 Sources/X Promotion State Ledger]]
- [ ] Open [[70 Sources/AI Promotion State Ledger]]
- [ ] Open [[70 Sources/ChatGPT Promotion State Ledger]]
- [ ] Open [[70 Sources/Readwise Promotion State Ledger]]
- [ ] Open [[70 Sources/Instagram Promotion State Ledger]]
- [ ] Open [[70 Sources/TikTok Promotion State Ledger]]

---

## 8) Founder intelligence brief

> Manual section — not auto-populated by factory-retro.

- [ ] Open [[70 Sources/Founder Intelligence Brief]]
- [ ] Open [[01 CEO/Founder Intelligence Brief]]
- [ ] Decide what changes next week because of the strongest promoted signals

---

## 9) Project-linked synthesis

> Manual section — not auto-populated by factory-retro.

- [ ] Open [[70 Sources/Project Action Board]]
- [ ] Open [[01 CEO/Execution Focus Brief]]
- [ ] Decide which project gets the highest-leverage execution focus next week

---

## 10) Overnight Agent Output

- [ ] PRs merged this week: **{N}**
- [ ] Artifacts produced (tests, docs, scaffolding):
  {Summarize from SCOREBOARD.md: list file types created or modified across all sessions}
- [ ] Total API cost this week: **{$N or "not tracked"}** (target: <CHF 25/week)
- [ ] Rejected PRs this week: **{N discarded}**
  {If any: list repo + reason from session JSON or Telegram discard message}

---

## 11) Infrastructure Health

- [ ] Factory tools operational:
  - factory-dispatch.sh: {check ~/.factory/bin/factory-dispatch.sh exists}
  - factory-heartbeat.sh: {check ~/.factory/bin/factory-heartbeat.sh exists}
  - factory-telegram.sh: {check ~/.factory/bin/factory-telegram.sh exists}
  - FACTORY_REPOS registry: {N repos configured}
- [ ] Factory spend vs budget: see API cost in Section 10
- [ ] Any factory tool added/modified this week: {check git log on ~/.factory/ if it's a git repo, else "not tracked"}
- [ ] Worktree cleanup needed: {list any .trees/factory/ directories still present in repos}

---

## 12) Nicholas Engagement

> Manual section — not auto-populated by factory-retro.

- [ ] How many morning briefings were sent this week? (target: 4+)
- [ ] Any feedback received from Nicholas?
- [ ] Revenue progress: engagement terms status, payment status
- [ ] Nicholas' reported time saved this week

---

## 13) Pilot operations

> Manual section — not auto-populated by factory-retro.

- [ ] Open [[60 Outputs/Founder Pilot Candidate Tracker]]
- [ ] Open [[60 Outputs/Founder Pilot Outreach Actions]]
- [ ] Decide the first 1–3 concrete founder names to contact
- [ ] Send the first outreach message if the package is ready

---

## Factory Health

### Throughput Trend

{One of:}
- "Throughput UP {N}% vs last week ({items_completed} items this week vs {last_week_items} last week). Planner accuracy at {completion_rate}%."
- "Throughput DOWN {N}% vs last week ({items_completed} items this week vs {last_week_items} last week). Investigate: {top failure pattern}."
- "Throughput STABLE ({items_completed} items, similar to last week). Planner accuracy at {completion_rate}%."
- "No comparison available (first retro or no last week data)."

### Failure Rate Trend

{One of:}
- "Failure rate IMPROVING: {this_week_fail_rate}% this week vs {last_week_fail_rate}% last week."
- "Failure rate DEGRADING: {this_week_fail_rate}% this week vs {last_week_fail_rate}% last week. Top cause: {top failure pattern}."
- "Failure rate STABLE at {this_week_fail_rate}%."
- "No comparison available."

### Planner Accuracy

Completion rate: **{completion_rate}%** ({items_completed}/{items_total} items)

{One of:}
- ">= 80%: Planner accuracy is STRONG. Items are appropriately scoped."
- "60-79%: Planner accuracy is ACCEPTABLE. Consider: {suggestion from failure patterns}."
- "< 60%: Planner accuracy is WEAK. PROGRAM.md items may be too vague or too risky. See failure patterns below."

### Top 3 Failure Patterns This Week

{For each of top 3 patterns:}
1. **{Pattern name}** — {N occurrences across M sessions}
   Evidence: {1-2 specific SCOREBOARD entries}
   Status: {already in memory / new pattern}

2. **{Pattern name}** — {N occurrences}
   Evidence: {}
   Status: {}

3. **{Pattern name}** — {N occurrences}
   Evidence: {}
   Status: {}

### Cross-Repo Connections This Week

{For each cross-repo connection identified:}
- {Source repo} shipped {capability} → {downstream repo} picked up {dependent task}

{If none: "No cross-repo manifest connections observed this week."}

---

## Recommended CLAUDE.md Updates

> Patterns that appeared 3+ times across runs are candidates for CLAUDE.md rules.
> Review each candidate before applying. Applying a rule that's wrong is worse than not having it.

### Candidates for repo CLAUDE.md rules

{For each failure pattern with 3+ occurrences:}

**[{repo}] Candidate rule:**
```
{Exact proposed CLAUDE.md line}
```
Evidence: {N occurrences} | Runs: {list session IDs or branches}
Action required: [ ] Apply to `{repo_path}/CLAUDE.md` | [ ] Reject (false pattern)

{If no patterns meet the threshold:}
"No patterns exceeded the 3-occurrence threshold this week. No CLAUDE.md updates recommended."

### Candidates for global ~/.claude/CLAUDE.md

{Only patterns that appeared in 2+ distinct repos qualify for global promotion.}

{For each cross-repo pattern:}
**Global candidate:**
```
{Exact proposed global CLAUDE.md line}
```
Evidence: Appeared in {repos list} | {N} total occurrences
Action required: [ ] Apply to `~/.claude/CLAUDE.md` | [ ] Reject

{If none: "No cross-repo patterns this week."}

### Candidates for .claude/conventions.md

{Conventions are structural patterns (file layout, naming, import style) rather than rules.}
{For each convention candidate discovered in run logs:}

**Convention:**
> {Description of the convention}

Repo: {repo} | Observed: {what in SCOREBOARD or memory triggered this}
Action required: [ ] Add to `{repo_path}/.claude/conventions.md` | [ ] Reject

{If none: "No new conventions discovered this week."}

---

## What Shipped (Merged PRs)

{For each merged PR this week:}
### [{repo}] {branch}

- **Status:** {DONE | DONE_WITH_CONCERNS}
- **Items:** {completed}/{total} ({pct}%)
- **PR:** {pr_url}
- **Top items delivered:**
  {List first 5 completed items from SCOREBOARD with [x] markers}
- **Concerns (if DONE_WITH_CONCERNS):** {list concerns from PROGRESS.md}

{If no merged PRs: "No PRs merged this week. All completed sessions are in review or awaiting merge."}

---

## What Blocked

{For each BLOCKED or CRASHED session:}
### [{repo}] {branch} — {status}

- **Reason:** {from BLOCKED.md first section, or "BLOCKED.md not found — check factory.log"}
- **Items completed before block:** {N}/{total}
- **Last SCOREBOARD entry:** {last line of SCOREBOARD.md}
- **Recommended action:** {one of: "Re-run with tighter scope", "Add CLAUDE.md hint: {hint}", "Architecture decision required: {decision}", "Manual investigation needed"}

{If none: "No blocked sessions this week."}

---

*Auto-generated by /factory-retro — {timestamp}*
*Factory config: {N} repos registered | Archive: {N} sessions total*
```

---

## Step 10: Write retro to disk

Determine output paths:

```bash
RETRO_DIR="${FACTORY_HOME:-$HOME/.factory}/retros"
mkdir -p "$RETRO_DIR"

RETRO_FILE="$RETRO_DIR/${ISO_YEAR}-W${ISO_WEEK}-retro.md"
echo "Writing to: $RETRO_FILE"

# Check if vault staging directory exists
VAULT_PATH="${VAULT_PATH:-/Users/arshya/Arshya's Brain Network}"
STAGING_DIR="$VAULT_PATH/80 Reviews/Staging"
FRIDAY_DATE=$(date -v+fri +%Y-%m-%d 2>/dev/null || date -d "next friday" +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)
VAULT_FILE="$STAGING_DIR/${FRIDAY_DATE} CEO Weekly Review.md"

echo "Vault staging: $VAULT_FILE"
ls "$STAGING_DIR" 2>/dev/null | head -5 || echo "Vault staging dir not found — will skip vault write"
```

Write the document using the Write tool to `$RETRO_FILE`.

If the vault staging directory exists, also write the same document to `$VAULT_FILE`.

If the vault staging directory does not exist, print:
```
NOTE: Vault staging directory not found at $STAGING_DIR
      Retro saved to ~/.factory/retros/ only.
      To enable vault sync, create the directory or update VAULT_PATH in ~/.factory/config.sh
```

---

## Step 11: Print completion summary

After writing files, print a concise summary to the conversation:

```
FACTORY RETRO — Week {ISO_YEAR}-W{ISO_WEEK} ({WEEK_MONDAY} → {WEEK_SUNDAY})

Sessions:      {total_runs} total | {passed} passed | {blocked} blocked | {crashed} crashed
Throughput:    {items_completed}/{items_total} items ({completion_rate}%)
Pass rate:     {pass_rate}% sessions succeeded
PRs:           {merged} merged | {in_review} in review | {discarded} discarded
Repos active:  {repos_active} ({list repo slugs})
Trend:         {throughput direction vs last week}
Top failure:   {top failure pattern description}

CLAUDE.md candidates: {N} (across {repos} repos)

Written to:
  ~/.factory/retros/{ISO_YEAR}-W{ISO_WEEK}-retro.md
  {vault path if written, else "vault: skipped (dir not found)"}

Run /factory-planner to incorporate these learnings into next week's programs.
```

---

## Completion status

Report using one of:
- **DONE** — Retro generated and written. All sessions parsed successfully.
- **DONE_WITH_CONCERNS** — Retro generated, but note any: sessions with missing SCOREBOARD.md, repos in config that couldn't be reached, manifests that failed to parse.
- **BLOCKED** — State what is blocking (e.g., ~/.factory/runs/archive/ empty, config.sh not found, all reads failed).
- **NEEDS_CONTEXT** — State exactly what's missing.

---

## Error handling

- If `~/.factory/config.sh` doesn't exist: use hardcoded defaults from the blueprint (`FACTORY_HOME=~/.factory`, four repos). Print a warning.
- If `~/.factory/runs/archive/` is empty or doesn't exist: check `~/.factory/runs/*.json` for completed sessions. If still empty, report "No completed sessions found for week {WEEK}. Retro cannot be generated from factory data — check if factory-dispatch.sh has been run this week."
- If a SCOREBOARD.md path can't be read (file missing): note "SCOREBOARD not found for {repo} {branch} — failure pattern analysis skipped for this session."
- If a git repo path is unreachable: skip that repo's git log and note it in DONE_WITH_CONCERNS.
- If the vault staging directory doesn't exist: skip vault write silently (already handled in Step 10).
- Never fail hard — always produce a partial retro with "DATA UNAVAILABLE" placeholders rather than no output.

---

## Important rules

- Do not fabricate metrics. If data is unavailable for a field, write "not available" or "—".
- The factory sections (1, 2, 3, 4, 5, 10, 11, Factory Health, Recommended CLAUDE.md Updates, What Shipped, What Blocked) are auto-populated. All other sections (6, 7, 8, 9, 12, 13) are left as template placeholders with "> Manual section" notes.
- Do not read or modify any repo's source code or CLAUDE.md — only read SCOREBOARD.md, PROGRESS.md, BLOCKED.md, session JSONs, memory files, and manifests.
- All timestamps are in local timezone (do not override TZ).
- The retro is a read-only analysis artifact. It does not apply CLAUDE.md updates — it only recommends them for founder review.
- CLAUDE.md update candidates require explicit founder approval before application. Never apply them autonomously.
