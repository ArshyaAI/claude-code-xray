---
name: "factory-planner"
description: "Generate prioritized PROGRAM.md files for factory agents by reading strategy vault, git logs, capability manifests, and per-repo memory. The most important output is file-specific, risk-classified work items that autonomous agents can execute overnight."
argument-hint: "[optional: 'all', 'revenue-critical', or repo slug like 'connectos']"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, AskUserQuestion
---

# Factory Planner — PROGRAM.md Generator

Reads your strategy vault, git activity, capability manifests, and per-repo memory to generate prioritized PROGRAM.md files for each repo's factory agent.

## Trigger Examples

- "plan factory run"
- "factory planner"
- "what should agents build tonight"
- "plan factory for connectos"
- "plan revenue-critical factory run"

## Preamble

1. Source config: `source ~/.factory/config.sh`
2. Parse the optional focus argument:
   - No argument or `"all"` → plan all repos in `FACTORY_REPOS`
   - `"revenue-critical"` → plan only `connectos` and `nikin-wrapper`
   - A specific slug (e.g. `"connectos"`) → plan that repo only
3. Set `_DATE=$(date +%Y-%m-%d)` and `_TODAY=$(date +%b%d | tr '[:upper:]' '[:lower:]')`

## Step 1: Read Strategy Context

Read these vault files (skip any that don't exist):

```bash
VAULT="/Users/arshya/Arshya's Brain Network/01 CEO"
```

| File | What to extract |
|------|----------------|
| `$VAULT/AI System Vision.md` | North star, system architecture goals, what "done" looks like |
| `$VAULT/Quarterly Priorities.md` | Current quarter's ranked priorities — this determines item ordering |
| `$VAULT/Execution Focus Brief.md` | This week's focus — narrow the scope to what matters NOW |
| `$VAULT/Scoreboard.md` | Current metrics — identify gaps between targets and actuals |

Distill into a `_STRATEGY_CONTEXT` summary (max 20 lines). This is the lens through which all PROGRAM.md items are prioritized.

## Step 2: Read Per-Repo Context

For each target repo (from the focus filter), gather context using an Agent for parallelism:

### 2a. Git Activity

```bash
cd "<repo_path>" && git log --oneline -20
```

Extract: what was recently shipped, what branches are active, momentum direction.

### 2b. Capability Manifests

```bash
ls ~/.factory/manifests/*.json 2>/dev/null
```

Read each manifest. Extract:
- Capabilities recently added by OTHER repos (cross-repo integration opportunities)
- `downstream_hints` that name this repo as a consumer
- Breaking changes that require adaptation

### 2c. Per-Repo Memory

```bash
cat ~/.factory/memory/<slug>.md 2>/dev/null
```

Extract:
- Known failure patterns to AVOID (do not generate items that repeat these)
- Effective patterns to REUSE (scaffold new items using proven approaches)
- CLAUDE.md hint candidates that were not yet applied

### 2d. Repo CLAUDE.md

```bash
cat "<repo_path>/CLAUDE.md"
```

Extract: stack, eval gate commands, protected files, conventions. Items must respect protected files and follow conventions.

### 2e. NEXT-PROGRAM-HINTS.md (if exists)

```bash
cat "<repo_path>/NEXT-PROGRAM-HINTS.md" 2>/dev/null
```

Extract:
- "Do Not Repeat" patterns → exclude from PROGRAM.md
- "Confirmed Patterns" → reference in item descriptions
- "Open Threads" → continue partial work
- "Estimated Next Areas" → seed item generation

## Step 3: Generate PROGRAM.md Per Repo

For each target repo, synthesize all context into a PROGRAM.md. This is the most important output of the skill — quality here determines overnight agent success.

### PROGRAM.md Format

```markdown
# PROGRAM.md — [Repo Name]

Generated: [_DATE]
Strategy lens: [one-line from Execution Focus Brief]
Memory patterns avoided: [count]
Cross-repo integrations: [count]

## Items

| # | Item | File(s) | Behavior Change | Risk | Priority |
|---|------|---------|----------------|------|----------|
| 1 | [verb] [specific thing] | `src/path/file.ts` | [before → after] | SAFE | P0 |
| 2 | ... | ... | ... | RISK | P0 |
...

## Constraints

- Protected files: [from CLAUDE.md]
- Eval gate: [from CLAUDE.md]
- Max items: 30
- WTF-likelihood cap: 20%

## Cross-Repo Integration Items

[Items derived from capability manifests — wire new capabilities from other repos]

## Known Failure Patterns (DO NOT REPEAT)

[From memory + NEXT-PROGRAM-HINTS.md — the agent must skip these patterns]
```

### Item Quality Rules

Every item MUST have:

1. **A specific file path** — not "improve error handling" but "add retry logic to `src/adapters/shopify/client.ts:fetchOrders()`"
2. **A specific behavior change** — not "make it better" but "returns cached result when API is down (currently throws)"
3. **Risk classification**:
   - `SAFE` — proven pattern, no architectural impact, eval gate will catch regressions
   - `RISK` — touches >3 files, new dependency, or pattern not seen in this repo before
4. **Priority** based on strategy context:
   - `P0` — directly advances quarterly priority or fixes revenue-impacting issue
   - `P1` — advances weekly focus or improves key metric from scoreboard
   - `P2` — technical improvement, test coverage, refactoring

### Item Ordering

1. P0 items first, then P1, then P2
2. Within each priority: SAFE before RISK
3. Cross-repo integration items go after P1 (they depend on other repos being stable)
4. Max 30 items per repo — the agent won't finish more than that overnight

### What NOT to Include

- Items that touch protected files (from CLAUDE.md)
- Items matching "Do Not Repeat" patterns from memory
- Vague items without file paths ("improve performance")
- Architecture decisions that require human judgment
- Items that need external service credentials the agent won't have
- Items that duplicate recently shipped work (check git log)

## Step 4: Present for Approval

For EACH repo's PROGRAM.md, present using AskUserQuestion with this format:

```
1. RE-GROUND: Factory planner for [repo], targeting [_DATE] overnight run.
   Strategy lens: [one-line from Execution Focus Brief].

2. SIMPLIFY: I've generated [N] items for [repo]. [X] are SAFE mechanical
   improvements, [Y] are RISK items that touch multiple files. The agent
   will work through these overnight, stopping if WTF-likelihood exceeds 20%.

3. RECOMMEND: Approve as-is. The SAFE items are proven patterns from this
   repo's history, and RISK items have been flagged for the agent to handle
   carefully.

4. OPTIONS:
   A) Approve this PROGRAM.md as-is ([N] items)
   B) Approve but remove all RISK items ([X] SAFE items only)
   C) Edit — I'll show the full list for line-item review
   D) Skip this repo tonight
```

Wait for response before proceeding to the next repo.

## Step 5: Write Approved Programs

For each approved PROGRAM.md:

```bash
mkdir -p ~/.factory/programs
cat > ~/.factory/programs/<slug>.md << 'PROGRAM'
[approved PROGRAM.md content]
PROGRAM
```

After all repos are written, summarize:

```
--- FACTORY PLAN READY ------------------------------------

Programs written:
  ~/.factory/programs/connectos.md     (24 items: 18 SAFE, 6 RISK)
  ~/.factory/programs/nikin-wrapper.md (12 items: 10 SAFE, 2 RISK)

Skipped:
  founderos (user chose to skip)
  brandos (no items generated — recent run covered everything)

To dispatch now:  bash ~/.factory/bin/factory-dispatch.sh
To dispatch later: programs will persist until overwritten

-------------------------------------------------------
```

## Step 6: Optional Immediate Dispatch

```
RE-GROUND: Factory programs are written for [N] repos.

SIMPLIFY: I can launch the factory agents right now, or you can
run factory-dispatch.sh later (e.g., before bed).

RECOMMEND: Launch now if you're done for the day. The agents will
work overnight and you'll have PRs to review in the morning.

OPTIONS:
A) Launch factory-dispatch.sh now
B) I'll launch later manually
```

If A: run `bash ~/.factory/bin/factory-dispatch.sh` and report PIDs.

## Quality Checklist (self-check before presenting)

Before presenting any PROGRAM.md to the user, verify:

- [ ] Every item has a specific file path
- [ ] Every item has a before/after behavior change description
- [ ] No items touch protected files from CLAUDE.md
- [ ] No items repeat patterns from ~/.factory/memory/<slug>.md
- [ ] Items are ordered: P0 SAFE → P0 RISK → P1 SAFE → P1 RISK → P2
- [ ] Cross-repo items reference specific manifest capabilities
- [ ] Total items <= 30
- [ ] Eval gate commands are included in Constraints section
