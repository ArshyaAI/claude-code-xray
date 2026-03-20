# Continuous Factory v2 — Architecture

## Executive Summary

The Continuous Factory is a multi-agent autonomous build system that runs overnight, producing tested code across multiple repositories while a human sleeps. v1 proved the concept: 68 rounds, ~475 items, ~85 PRs across 4 repos in a single overnight session. It works. But it works like a cannon — powerful, inaccurate, and expensive.

v2 exists because v1 has no brain. The dispatch loop spawns identical agents that cannot communicate, cannot learn, and cannot distinguish a P0 revenue fix from an umlaut correction. The result: 20-30 duplicate implementations across PRs (FLAW 4), 4,000 lines of code nobody asked for (FLAW 1), 221 tests that never touched a real API (FLAW 2), and 50+ convention candidates that never reached CLAUDE.md (FLAW 3). The system measures "items completed" when it should measure "value delivered."

v2 replaces the dumb for-loop with a four-layer architecture: Strategy sets priorities, Orchestration manages rounds with merge-between-rounds, Execution uses specialist agents that self-claim from a shared queue, and Learning auto-promotes conventions and tracks cost-per-item. The core philosophy: **git is the source of truth** (never trust memory for state), **merge before dispatch** (every round starts from a clean baseline), and **measure value, not volume** (a P1 bug fix outweighs 30 umlaut corrections).

## Design Principles

1. **Git is the only source of truth.** Memory files, scoreboards, and agent claims are advisory. Only committed code and merged PRs count as "done." v1 agents fabricated completion claims in memory — v2 verifies against `git log`, not `SCOREBOARD.md`. From Karpathy: branch-per-experiment, git reset on failure.

2. **Merge before dispatch.** Every round starts by merging the previous round's approved PRs into main, then branching from the new baseline. This eliminates FLAW 4 (duplicate work from stale baselines). The 12-round overnight produced 7 PRs with overlapping `renderToolSpec` implementations because no round saw the previous round's output.

3. **Non-overlapping task specs.** Each task in the queue specifies exact file ownership. Two agents never touch the same file in the same round. From Anthropic's multi-agent research (90.2% improvement): explicit task decomposition with non-overlapping specs eliminates merge conflicts by construction.

4. **Self-claiming shared queue over pre-assignment.** Agents pull tasks from a shared queue rather than receiving pre-assigned lists. If an Architect agent finishes early, it pulls the next available task instead of idling. From Anthropic: shared task queue with self-claiming outperforms static allocation.

5. **Fixed time budget per task.** Every task has a wall-clock cap (default: 30 minutes). Agent either ships or writes BLOCKED.md. No open-ended exploration. From Karpathy's autoresearch: single measurable metric + fixed time budget produces higher quality than unbounded sessions.

6. **Artifact-based communication.** Agents write to files, not through an orchestrator bottleneck. A Reviewer writes `REVIEW.md` in the worktree; the Builder reads it. A Memory Curator writes `CONVENTION-CANDIDATE.md`; the Conductor reads it at round end. From Anthropic: artifact-based communication scales better than orchestrator-mediated messaging.

7. **Repo-type-aware prompts.** A documentation repo gets a different NIGHT-TASK than a TypeScript backend. v1 used the same 960-line TypeScript-focused prompt for every repo, including ones with no TypeScript. v2 maintains a repo-type registry that selects prompt variants, eval commands, and review criteria.

8. **Cost is a first-class metric.** Every task logs its token cost. The Conductor tracks $/item and detects diminishing returns (cost-per-item rising while value-per-item falls). When $/item exceeds a threshold, the round auto-stops or switches to deep audit mode.

9. **Exhaustion declarations are lies until proven.** v1 data shows 100% of "exhaustion" declarations were premature — deep audit always found more bugs. v2 replaces "I'm done" with a verification step: the Conductor runs a deep audit agent before accepting any round as complete.

10. **Convention auto-promotion is the compound interest.** A convention confirmed 3+ times across runs automatically generates a PR to update CLAUDE.md. v1 generated 50+ convention candidates and promoted 0. The learning loop is the entire point of running overnight — without it, you're just burning tokens.

## Architecture Overview

```
                          ┌──────────────┐
                          │    HUMAN     │
                          │  (approves   │
                          │  PROGRAM.md, │
                          │  merges PRs) │
                          └──────┬───────┘
                                 │ Telegram: summaries, escalations
                                 │ Morning: PR review queue
                                 v
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 1: STRATEGY                           │
│  CEO Agent: vault → repo state → memory → PROGRAM.md/repo     │
│  Product architecture validation gate                          │
│  Budget allocation: tokens/repo based on priority + ROI        │
└────────────────────────────┬───────────────────────────────────┘
                             │ PROGRAM.md (prioritized task specs)
                             v
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 2: ORCHESTRATION                      │
│  Conductor: merge → assess → plan → dispatch → monitor → merge│
│  Round caps (12 max), diminishing returns detection            │
│  Cost tracking, human escalation, quality gates                │
└──────────┬──────────┬──────────┬──────────┬───────────────────┘
           │          │          │          │ Shared task queue
           v          v          v          v
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 3: EXECUTION                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │Architect │ │ Builder  │ │ Reviewer │ │   QA     │         │
│  │validates │ │implements│ │Claude +  │ │real tests│         │
│  │plans     │ │code      │ │Codex     │ │+ integ.  │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│  ┌──────────────────┐                                         │
│  │ Memory Curator   │  All agents: self-claim from queue      │
│  │ promotes convns  │  All agents: artifact-based comms       │
│  └──────────────────┘  All agents: fixed time budget          │
└────────────────────────────┬───────────────────────────────────┘
                             │ Commits, artifacts, scoreboard
                             v
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 4: LEARNING                           │
│  Convention auto-promotion (3+ confirms → CLAUDE.md PR)       │
│  Cross-repo knowledge transfer (_shared.md)                   │
│  Cost/value tracking + ROI analysis                           │
│  Self-retro: analyze own performance, improve prompts         │
│  Append-only experiment log (JSONL)                           │
└────────────────────────────────────────────────────────────────┘

External Integrations:
  ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐
  │Composio │  │ Codex Pro │  │ Telegram │  │ GitHub │
  │actions  │  │ review +  │  │ notify + │  │ PR     │
  │layer    │  │ fixes     │  │ escalate │  │ merge  │
  └─────────┘  └───────────┘  └──────────┘  └────────┘
```

## Layer 1: Strategy (CEO Agent)

### Purpose

The CEO Agent is the strategic brain that v1 never had. It reads the founder's priorities, analyzes repo state, and produces PROGRAM.md files with prioritized, non-overlapping task specs. It answers the question v1 never asked: "Does this work align with the product's core value?"

### Inputs

| Source               | What it reads                                                                 | Why                                          |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| Vault (Obsidian)     | `01 CEO/Quarterly Priorities.md`, `Execution Focus Brief.md`, `Scoreboard.md` | Strategy lens — what matters this week       |
| Repo state           | `git log --oneline -20`, open PRs, branch activity                            | What was recently shipped, what's in flight  |
| Architecture docs    | `CLAUDE.md`, `docs/architecture/`, existing code patterns                     | Product architecture validation (FLAW 1 fix) |
| Memory               | `~/.factory/memory/{repo}.md`                                                 | Known failure patterns to avoid              |
| Cost history         | `~/.factory/metrics/cost-log.jsonl`                                           | Budget allocation based on ROI               |
| Capability manifests | `~/.factory/manifests/*.json`                                                 | Cross-repo integration opportunities         |

### Outputs

One `PROGRAM.md` per repo, containing:

```markdown
# PROGRAM.md — ConnectOS

Generated: 2026-03-21
Strategy lens: Revenue-critical — morning briefing for Nicholas by March 24
Architecture validation: PASSED — all items use trust-gated proxy pattern (Modus 1)

## Task Queue

| #   | Task                             | Files (owned)                    | Behavior Change                                  | Value | Risk | Budget |
| --- | -------------------------------- | -------------------------------- | ------------------------------------------------ | ----- | ---- | ------ |
| 1   | Add retry logic to Shopify proxy | `src/adapters/shopify/client.ts` | Returns cached on API timeout (currently throws) | P0    | SAFE | 20min  |
| 2   | Wire morning briefing to proxy   | `src/briefing/composer.ts`       | Calls proxy instead of direct Shopify API        | P0    | RISK | 30min  |

...

## File Ownership Map

src/adapters/shopify/ → Task 1, Task 5
src/briefing/ → Task 2, Task 8
[No file appears in more than one task]

## Anti-Patterns (from memory, DO NOT repeat)

- "Never modify src/lib/auth.ts in autonomous runs"
- "All adapter files must handle null API responses with type guards"
```

### Product Architecture Validation Gate

This is the FLAW 1 fix. Before generating items, the CEO Agent must:

1. Read the repo's `CLAUDE.md` and any architecture docs
2. Read the top 5 most-imported files to understand the actual code patterns
3. Answer: "What is the core value pattern of this product?"
4. For each candidate item, answer: "Does this use the core pattern or invent a new one?"
5. Items that invent new patterns are flagged `RISK` with a note: `ARCHITECTURE: new pattern — requires human approval`

Example: For ConnectOS, the core pattern is "agent-driven trust-gated proxy." The CEO Agent would have rejected 4,000 lines of pre-built briefing endpoints because they duplicate what the agent does natively through the proxy.

### Budget Allocation

```
Total overnight budget: $X (configured in ~/.factory/config.sh)

Allocation algorithm:
  1. Priority weight: P0 items get 3x budget, P1 get 2x, P2 get 1x
  2. ROI weight: repos with higher value-per-dollar in prior runs get more
  3. Minimum: every active repo gets at least 15% of budget
  4. Cap: no repo gets more than 50% of total budget

Example allocation for $50 overnight budget:
  ConnectOS:    $20 (40%) — P0 revenue items, high prior ROI
  nikin-wrapper: $15 (30%) — P0 briefing items
  founderos:    $10 (20%) — P1 improvements
  brandos:      $5  (10%) — P2 cleanup only
```

### How It Differs from v1's `/factory-planner`

v1's planner reads vault docs and generates items — but never validates against product architecture, never reads existing code patterns, never tracks cost history, and uses identical prompts for all repo types. v2's CEO Agent adds architecture validation (FLAW 1 fix), file ownership mapping (FLAW 4 fix), cost-aware budget allocation, and repo-type-specific item generation.

## Layer 2: Orchestration (Conductor)

### Purpose

The Conductor manages the round lifecycle, enforces the merge-first protocol, monitors health/cost/quality, and makes the decision v1 couldn't: "Should we keep going or stop?" It replaces the human-between-rounds requirement with an automated merge-assess-dispatch loop.

### Round Lifecycle

```
Round N:
  ┌─────────────────────────────────────────────────┐
  │ 1. MERGE                                        │
  │    - Merge approved PRs from Round N-1 into main│
  │    - Run CI on merged main                      │
  │    - If CI fails: STOP, escalate to human       │
  │                                                  │
  │ 2. ASSESS                                       │
  │    - Count remaining tasks in PROGRAM.md queue   │
  │    - Calculate cost-per-item trend               │
  │    - Check diminishing returns threshold         │
  │    - If <3 tasks remain: switch to deep audit    │
  │                                                  │
  │ 3. PLAN                                         │
  │    - Select next batch of tasks from queue       │
  │    - Assign agent types (Architect/Builder/etc)  │
  │    - Verify file ownership is non-overlapping    │
  │                                                  │
  │ 4. DISPATCH                                     │
  │    - Create git worktree from fresh main         │
  │    - Spawn agents with 30s stagger               │
  │    - Write session state to ~/.factory/runs/     │
  │                                                  │
  │ 5. MONITOR                                      │
  │    - Heartbeat every 5 min (PID, progress, cost) │
  │    - Detect completion, crash, or stall          │
  │    - Enforce per-task time budget                 │
  │                                                  │
  │ 6. COLLECT                                      │
  │    - Gather artifacts from completed agents      │
  │    - Run Reviewer agent on all diffs             │
  │    - Create PR if review passes                  │
  │    - Log cost, items, value to metrics JSONL     │
  └──────────────────────┬──────────────────────────┘
                         │
                         v
                    Round N+1 (or STOP)
```

### Merge-First Protocol

This is the FLAW 4 fix. The most important change from v1.

```
v1: dispatch(round1) → dispatch(round2) → dispatch(round3) → human merges all
    Result: 3 rounds see same stale baseline, rebuild same features

v2: dispatch(round1) → MERGE round1 PRs → dispatch(round2 from new main) → MERGE → ...
    Result: each round builds on previous round's work, no duplicates
```

The merge step requires either:

- **Auto-merge**: If CI passes and review score > 80%, merge without human approval (for SAFE tasks only)
- **Queue-and-skip**: If human approval required, skip those files in next round's task assignments

### Diminishing Returns Detection

```
After each round, compute:
  marginal_value = value_delivered_this_round / cost_this_round

  If marginal_value < 0.3 * round_1_value:
    → Switch to "deep audit" mode (only run Reviewer + QA agents)

  If marginal_value < 0.1 * round_1_value:
    → STOP. Send Telegram: "Diminishing returns after round N. Stopping."
```

The 12-round cap comes from overnight data showing <5% marginal value after round 12 across all 4 repos. v2 makes this adaptive rather than hard-coded — some repos exhaust value in 6 rounds, others have productive work through 15.

### Cost Tracking and Budget Enforcement

Every agent reports token usage. The Conductor maintains a running ledger:

```jsonl
{"round":1,"repo":"connectos","agent":"builder","task":3,"tokens_in":45000,"tokens_out":12000,"cost_usd":0.42,"items":1,"value":"P1","duration_sec":840}
{"round":1,"repo":"connectos","agent":"reviewer","task":3,"tokens_in":30000,"tokens_out":8000,"cost_usd":0.28,"items":1,"value":"review","duration_sec":320}
```

Budget gates:

- Per-task: Kill agent if task exceeds 2x its budget allocation
- Per-round: Warn at 80% of round budget, stop at 100%
- Per-session: Hard stop at overnight budget cap

### Human Escalation Protocol

The Conductor sends Telegram messages at three severity levels:

| Level | Trigger                                        | Message                                          | Action Required      |
| ----- | ---------------------------------------------- | ------------------------------------------------ | -------------------- |
| INFO  | Round complete                                 | "Round 3 done: 8/10 tasks, $4.20, 2 PRs created" | None                 |
| WARN  | Diminishing returns, budget 80%, agent stall   | "Round 7: cost/item up 3x. Continue?"            | Reply "go" or "stop" |
| ALERT | CI failure on merge, agent crash, cost overrun | "CI FAILED after merge. Round stopped."          | Human must intervene |

### How It Differs from v1's `factory-dispatch.sh`

v1's dispatch is a one-shot for-loop: spawn all agents, walk away, come back in the morning. No merge between rounds, no cost tracking, no diminishing returns detection, no round orchestration. v2's Conductor is a state machine that runs the full merge-assess-plan-dispatch-monitor-collect cycle autonomously, stopping or adapting based on real-time data.

## Layer 3: Execution (Specialist Agents)

### Atomic Task Checkout (from Paperclip)

Paperclip's single best primitive: atomic checkout with 409 Conflict. Factory v2 adapts this without a database:

```
Checkout protocol (file-based):
  1. Agent reads ~/.factory/queue/{repo}.jsonl for first "pending" task matching its type
  2. Agent attempts atomic write: mv queue.jsonl queue.jsonl.lock (advisory)
  3. Agent updates task status to "claimed" + writes claimed_by + timestamp
  4. Agent releases lock: mv queue.jsonl.lock queue.jsonl
  5. If lock file already exists (another agent is claiming): skip, try next task
  6. On completion: update to "done" with evidence path
  7. On failure/timeout: update to "failed", release file ownership
```

This eliminates the double-work problem from v1 where two agents could start the same PROGRAM.md item. Zero infrastructure — just file-level advisory locking.

### Shared Task Queue

Tasks live in a shared JSONL file at `~/.factory/queue/{repo}-{date}.jsonl`:

```jsonl
{"id":1,"status":"pending","type":"build","task":"Add retry to Shopify proxy","files":["src/adapters/shopify/client.ts"],"value":"P0","budget_min":20,"goal":"Revenue: NIKIN morning briefing by March 24","claimed_by":null}
{"id":2,"status":"claimed","type":"build","task":"Wire morning briefing","files":["src/briefing/composer.ts"],"value":"P0","budget_min":30,"goal":"Revenue: NIKIN morning briefing by March 24","claimed_by":"builder-1"}
{"id":3,"status":"done","type":"review","task":"Review task 1 diff","files":["src/adapters/shopify/client.ts"],"value":"review","budget_min":10,"goal":null,"claimed_by":"reviewer-1"}
```

Note the `goal` field — every task traces back to a vault priority (Paperclip's goal ancestry pattern). Agents always know WHY they're doing something.

Claiming protocol:

1. Agent reads queue, finds first `status: pending` task matching its type
2. Agent writes `status: claimed, claimed_by: {agent-id}` (atomic file write)
3. Agent executes task within its time budget
4. Agent writes `status: done` or `status: failed` with evidence

File-level locking: if a task's `files` array overlaps with any `claimed` task, it is skipped until the claiming agent finishes or fails.

### Agent Types and Their NIGHT-TASK Variants

#### Architect Agent

**Purpose**: Validates that a plan is sound before a Builder starts implementing. Catches FLAW 1 (wrong architecture) and FLAW 3 (wrong integration pattern) before code is written.

**When used**: Before any RISK task, or any task touching >3 files.

**Prompt variant**: Reads the task spec, reads the target files, reads existing patterns in the repo, and produces an implementation plan with file-by-file changes. Does NOT write code.

**Output**: `PLAN-{task-id}.md` in the worktree. Builder reads this before starting.

**Eval**: Plan must specify exact files, exact function signatures, and exact test assertions. Vague plans are rejected.

#### Builder Agent

**Purpose**: Implements code changes. The workhorse.

**Prompt variant**: Repo-type-aware. Examples:

| Repo Type             | Eval Command                                | Extra Context                            |
| --------------------- | ------------------------------------------- | ---------------------------------------- |
| `typescript-backend`  | `npm run lint && npm test`                  | tsconfig paths, import alias conventions |
| `typescript-frontend` | `npm run lint && npm test && npm run build` | Component patterns, design system tokens |
| `python-backend`      | `ruff check . && pytest`                    | Virtual env, import conventions          |
| `docs-only`           | `markdownlint docs/`                        | Section structure, frontmatter schema    |

A Builder agent for ConnectOS would use:

```
eval: npm run lint && npm test
extra_context: "Trust-gated proxy is the core pattern. All adapters go through src/adapters/{provider}/client.ts. Tests use vitest with MSW for mocking."
```

**Output**: Committed code + updated SCOREBOARD entry.

**Directives**: NEVER STOP — agent runs until time budget expires or task is complete. From Karpathy: the directive prevents premature exhaustion declarations.

#### Reviewer Agent (Claude + Codex)

**Purpose**: Multi-model review catches bugs that the implementing model misses. v1 data shows Codex cross-model review finds real P1-P2 bugs in every repo.

**Protocol**:

1. Claude reviews the diff for logic errors, style violations, test coverage gaps
2. Codex Pro reviews the same diff independently (parallel, via API)
3. Results are merged: any finding flagged by both models is P1; single-model findings are P2

**Output**: `REVIEW-{task-id}.md` with findings categorized by severity.

**When used**: After every Builder task completes. No code merges without review.

#### QA Agent

**Purpose**: Runs real tests and integration verification. The FLAW 2 fix — goes beyond `npm test` to verify real-world behavior.

**Protocol**:

1. Run the repo's eval gate (`npm test`, `pytest`, etc.)
2. If test credentials exist (`~/.factory/credentials/{repo}.env`), run one real API call against staging
3. If no credentials, flag the task as `MOCK_ONLY` in the scoreboard — do NOT claim "production ready"
4. Run smoke test against any deployed staging URL

**Output**: `QA-{task-id}.md` with pass/fail + evidence (actual API responses or explicit mock-only notice).

#### Memory Curator Agent

**Purpose**: Promotes conventions from transient session knowledge to durable CLAUDE.md rules. Closes the learning loop that v1 left open.

**When used**: At the end of each round, reads all artifacts from that round.

**Protocol**:

1. Scan all REVIEW, QA, and SCOREBOARD files from the round
2. Extract patterns: what failed repeatedly? What worked consistently?
3. Cross-reference against `~/.factory/memory/{repo}.md` — has this pattern been seen before?
4. If a pattern has 3+ confirmations across runs: generate a PR adding it to CLAUDE.md
5. If cross-repo (same pattern in 2+ repos): promote to `~/.factory/memory/_shared.md`

**Output**: Convention candidate PRs + updated memory files.

### Repo-Type Registry

```bash
# ~/.factory/config/repo-types.sh

declare -A REPO_TYPES=(
  ["connectos"]="typescript-backend"
  ["nikin-wrapper"]="nodejs-express"
  ["founderos"]="typescript-frontend"
  ["brandos"]="typescript-frontend"
  ["nikin-ai"]="docs-only"
)

declare -A REPO_EVALS=(
  ["typescript-backend"]="npm run lint && npm test"
  ["nodejs-express"]="npm run lint && npm test"
  ["typescript-frontend"]="npm run lint && npm test && npm run build"
  ["docs-only"]="markdownlint docs/ || true"
)
```

### Inter-Agent Communication via Artifact Files

```
worktree/
  .factory/
    queue-claim.json       # Agent's current task claim
    PLAN-3.md              # Architect → Builder: implementation plan
    REVIEW-3.md            # Reviewer → Conductor: review results
    QA-3.md                # QA → Conductor: test results
    CONVENTION-CANDIDATE.md # Memory Curator → round-end collection
    BLOCKED.md             # Any agent → Conductor: escalation
```

Agents never communicate through the Conductor. They write files; other agents and the Conductor read files. This scales to any number of agents without the orchestrator becoming a bottleneck.

### Fixed Time Budget Per Task

From Karpathy's autoresearch pattern:

```
Default budgets by task type:
  Architect: 15 min (plan validation, no code)
  Builder (SAFE): 20 min
  Builder (RISK): 30 min
  Reviewer: 10 min
  QA: 15 min
  Memory Curator: 10 min per round (not per task)

On timeout:
  - Agent writes current state to PROGRESS.md
  - Task marked "timeout" in queue (not "failed" — it may be resumable)
  - Conductor decides: assign to next round or escalate
```

### WTF-Likelihood Accumulator (from /autoresearch)

The existing `/autoresearch` skill (610 lines) already has this primitive — directly portable:

```
WTF-likelihood starts at 0%. Increments:
  +15% per reverted item
  +5% per change touching >3 files
  +1% per change after the 20th in a session
  +10% if remaining items are all low-priority

Gates:
  >20%: HARD STOP — write BLOCKED.md, notify Conductor
  >40 total changes: absolute cap regardless of WTF score
```

This replaces v1's premature exhaustion declarations with a quantified risk signal. The agent doesn't decide "I'm done" — the accumulator decides based on evidence.

### Budget Enforcement (from Paperclip)

Paperclip's budget enforcement is atomic — cost check + task checkout happen in the same transaction. Factory v2 adapts this:

```
Per-agent budget:
  - Read ~/.claude/stats or wrap claude CLI with token counter
  - Write costs to ~/.factory/runs/{run-id}/cost.jsonl
  - Soft warn at 80% of FACTORY_BUDGET_PER_RUN (Telegram WARN)
  - Hard stop at 100% (agent terminated, state saved)
  - Per-session cap: FACTORY_BUDGET_OVERNIGHT_USD in config.sh

Per-task budget:
  - Each queue entry has budget_min (time) and budget_usd (tokens)
  - Conductor kills agent if task exceeds 2x its budget
  - Cost-per-item tracked in experiment log for trend analysis
```

## Layer 4: Learning (Research Lab)

### Two-Tier Memory

| Tier              | Location                          | Durability                     | Who Writes              | Who Reads             |
| ----------------- | --------------------------------- | ------------------------------ | ----------------------- | --------------------- |
| Session log       | `~/.factory/runs/{session}.jsonl` | Ephemeral (archived weekly)    | All agents              | Conductor, Retro      |
| Durable knowledge | `{repo}/CLAUDE.md`                | Permanent (version-controlled) | Memory Curator (via PR) | All agents, CEO Agent |

The critical distinction: session logs are evidence. CLAUDE.md rules are conclusions. v1 conflated the two — agents wrote "conclusions" to memory files that were never validated, creating a pile of unreliable claims. v2 requires the Memory Curator to promote from evidence to conclusion only after 3+ confirmations.

### Convention Auto-Promotion Pipeline

```
Observation (single run):
  "Agent failed because src/adapters/ file didn't handle null API response"
  → Written to ~/.factory/memory/connectos.md as OBSERVATION

Confirmation (3+ runs):
  Same observation appears in 3 different sessions across 2+ weeks
  → Promoted to CANDIDATE in ~/.factory/memory/connectos.md

Promotion (auto-PR):
  Memory Curator generates a PR:
    CLAUDE.md += "All adapter files must handle null API responses with explicit type guards"
  → PR assigned to human for review
  → If merged: pattern moves to PROMOTED status
  → If rejected: pattern moves to REJECTED with reason

Tracking:
  ~/.factory/memory/connectos.md maintains a ledger:
  | Pattern | Status | Confirmations | First Seen | Last Seen | PR |
  |---------|--------|---------------|------------|-----------|-----|
  | Null API guard | PROMOTED | 5 | 2026-03-20 | 2026-03-25 | #42 |
  | Auth file protected | PROMOTED | 3 | 2026-03-20 | 2026-03-22 | #38 |
  | Import alias required | CANDIDATE | 2 | 2026-03-21 | 2026-03-22 | — |
```

### Cross-Repo Shared Memory

`~/.factory/memory/_shared.md` holds patterns observed in 2+ repos:

```markdown
## Cross-Repo Conventions

### Git fetch at sprint start (PROMOTED, 20+ confirmations)

Every agent must run `git fetch origin` before reading repo state.
Confirmed in: connectos (8x), nikin-wrapper (6x), founderos (4x), brandos (3x)
Status: ENFORCED — hardcoded in Conductor dispatch step

### Explicit TypeScript strict null checks (CANDIDATE, 4 confirmations)

Adapters that call external APIs must use explicit null type guards.
Confirmed in: connectos (3x), nikin-wrapper (1x)
```

### Git as Source of Truth

v1 agents claimed tasks were "done" in memory files without committing code. v2 enforces:

```
"Done" means:
  1. Code committed to branch ✓
  2. Eval gate passes on committed code ✓
  3. Review artifact exists ✓
  4. QA artifact exists ✓

"Done" does NOT mean:
  - Agent says "I completed this" in memory
  - SCOREBOARD.md has a checkmark
  - Agent logged success to JSONL

Verification command (run by Conductor):
  git log --oneline <worktree-branch> | grep <task-id>
  → If no commit references this task, it is NOT done regardless of what memory says
```

### Append-Only Experiment Log

`~/.factory/metrics/experiment-log.jsonl` — never edited, only appended:

```jsonl
{"ts":"2026-03-21T02:15:00Z","round":3,"repo":"connectos","task_id":7,"agent":"builder-1","result":"pass","cost_usd":0.42,"duration_sec":840,"value":"P1","files_changed":2,"tests_added":3}
{"ts":"2026-03-21T02:28:00Z","round":3,"repo":"connectos","task_id":7,"agent":"reviewer-1","result":"pass","cost_usd":0.28,"duration_sec":320,"value":"review","findings_p1":0,"findings_p2":2}
```

This log is the raw data for all metrics, trend analysis, and cost optimization. It is never modified — only queried.

### Chain-on-Completion (from /autoresearch)

The existing `/autoresearch` skill has a powerful primitive: when a run completes, the heartbeat auto-launches the next run FROM the completed branch. This compounds gains — run 2 starts with everything run 1 built.

Factory v2 adopts this for round orchestration:

```
Round N completes (all agents done, PRs created):
  → Conductor merges approved PRs to main
  → Conductor branches Round N+1 from NEW main (includes Round N's work)
  → Agents in Round N+1 see everything Round N shipped
  → This is the merge-first protocol in action — but automatic, not manual
  → Max chain depth: configurable (default 12 rounds)
```

This is the single most impactful change from v1 — it eliminates the entire class of "duplicate work from stale baseline" bugs.

### Self-Retro After Each Session

At session end, the Conductor runs a retro agent that reads the experiment log and answers:

- Which tasks took >2x their budget? Why?
- Which agent type had the highest failure rate? Why?
- What patterns appeared in 3+ REVIEW artifacts?
- Is cost-per-item trending up or down?
- What should change in the next session's PROGRAM.md?

Output goes to `~/.factory/retros/{date}-retro.md` and feeds into the next CEO Agent run.

### Adapter Abstraction (from Paperclip)

v1 is Claude-Code-only. v2 supports multiple runtimes via adapter configs:

```bash
# ~/.factory/config/adapters.sh
declare -A AGENT_ADAPTERS=(
  ["architect"]="claude-opus-4-6"      # Architecture needs strongest model
  ["builder"]="claude-sonnet-4-6"      # Best cost/performance for implementation
  ["reviewer"]="codex"                 # Cross-model review is the whole point
  ["qa"]="claude-sonnet-4-6"           # Needs to run tests, write assertions
  ["memory-curator"]="claude-haiku-4-5" # Pattern matching, cheap + fast
)
```

This implements the model matrix from the Elite Workflow Laws: 10-20% Opus / 70-80% Sonnet / 10-20% Haiku. Codex gets the review role it's purpose-built for.

## External Integrations

### Composio: Augmentation Layer for External Systems

Composio is already live in NIKIN's OpenClaw production (tool calls observed: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_MULTI_EXECUTE_TOOL`). For Factory v2, Composio is an **augmentation layer, not a dependency**:

**Use Composio for** (services the Factory currently can't reach):

- **Slack**: Sprint completion notifications, failure alerts alongside Telegram
- **Linear**: Sync Factory tasks ↔ Linear issues (when a Factory task maps to a ticket)
- **Notion**: Write session summaries to team wiki
- **Sentry**: QA agent reads production error reports to prioritize fixes

**Keep CLI for** (battle-tested, zero-latency, local):

- **GitHub**: `gh` CLI for all PR/issue operations — no cloud dependency for core Git workflow
- **Git**: Direct git commands for worktree management, branching, merging

**Integration**: Composio's Rube MCP server in `~/.claude.json`. All Factory agents gain Composio tools automatically — no SDK code, no new dependency. One config line.

**Do NOT use** Composio's `ao` orchestrator (Bug #373, and our dispatch is simpler/proven at current scale).

**Architectural reference**: Composio's OpenClaw plugin uses `api.registerTool()` — this is the canonical pattern for ConnectOS integration. Factory agents building OpenClaw integrations must examine this plugin before proposing alternatives (FLAW 3 fix).

### Codex Pro: Parallel Review + Bounded Fixes

Codex Pro serves two roles:

1. **Cross-model review**: Every Builder output is reviewed by both Claude and Codex. Findings flagged by both models are automatically P1. v1 data shows cross-model review catches real bugs that same-model review misses.

2. **Bounded fix tasks**: When a Reviewer finds a P1 bug, Codex can be dispatched to fix it in parallel with the next Builder task. Codex tasks are always bounded: single file, single function, <10 minute budget.

### Telegram: Notifications + Escalation

```
Notification flow:
  Conductor → ~/.factory/bin/factory-telegram.sh → Telegram Bot API → Human

Message types:
  [INFO]  "Round 3 complete: 8 tasks, 2 PRs, $4.20"
  [WARN]  "Diminishing returns detected. Reply 'go' or 'stop'"
  [ALERT] "CI failed after merge round 5. Manual intervention required."
  [DAILY] Morning summary: overnight results, PRs to review, cost report

Human can reply:
  "go"     → Continue to next round
  "stop"   → Graceful shutdown after current tasks complete
  "merge"  → Auto-merge specified PR
  "skip X" → Remove task X from queue
```

### GitHub: PR Lifecycle Management

Every round that produces passing code creates a PR via `gh pr create`. PRs include:

- Title: `[factory] Round N: {summary of tasks}`
- Body: Task list with pass/fail, review summary, QA results, cost
- Labels: `factory`, `round-N`, priority labels from task specs
- Auto-assign: human reviewer

## Migration Path: v1 to v2

### Phase 1: Repository Setup + Config Templating (Week 1)

**What we keep from v1**: Git worktree isolation, heartbeat monitoring (PID-based), NIGHT-TASK prompt structure (8 phases), post-run pipeline (archive, manifest, notify).

**What we add**:

- `~/.factory/config/repo-types.sh` — repo-type registry with per-type eval commands
- `~/.factory/queue/` — shared task queue directory
- `~/.factory/metrics/` — experiment log + cost tracking directory
- `~/.factory/credentials/` — optional test credentials per repo (for QA agent)

**Deliverable**: `factory-dispatch.sh` accepts a repo-type flag and selects the correct NIGHT-TASK variant.

### Phase 2: Conductor Layer (Week 1-2)

**The big change**: Replace the one-shot dispatch loop with the round lifecycle state machine.

- Implement merge-first protocol (FLAW 4 fix)
- Add diminishing returns detection (cost-per-item trending)
- Add round cap (default 12, adaptive)
- Heartbeat upgraded from 15-min to 5-min with cost tracking
- Telegram integration upgraded with escalation levels

**Deliverable**: Conductor can run multiple rounds autonomously, merging between each, and stops when value drops.

### Phase 3: Specialist Agents (Week 2-3)

- Implement shared task queue + self-claiming protocol
- Build NIGHT-TASK variants for each agent type (Architect, Builder, Reviewer, QA)
- Add repo-type-specific prompts and eval commands
- Implement artifact-based communication protocol
- Add fixed time budgets per task type

**Deliverable**: A round dispatches specialist agents that self-claim tasks, communicate via artifacts, and respect time budgets.

### Phase 4: Learning Engine (Week 3-4)

- Implement Memory Curator agent
- Build convention auto-promotion pipeline (3+ confirms → PR)
- Create cross-repo shared memory (`_shared.md`)
- Build append-only experiment log
- Implement self-retro at session end

**Deliverable**: Conventions automatically promoted to CLAUDE.md PRs. Cost and value tracked per item.

### Phase 5: CEO Agent (Week 4-5)

- Build product architecture validation gate (FLAW 1 fix)
- Implement budget allocation algorithm
- Add file ownership mapping (non-overlapping specs)
- Integrate with vault reading (existing planner capability)

**Deliverable**: PROGRAM.md files that are architecture-validated, budget-aware, and produce non-overlapping task specs.

### Phase 6: Composio + Codex Pro Integration (Week 5-6)

- Wire Composio for GitHub PR lifecycle (replaces `gh` shell calls)
- Wire Codex Pro for cross-model review
- Add bounded-fix dispatch to Codex for P1 findings
- Add Composio-based QA for repos with external API dependencies

**Deliverable**: Full external integration layer operational.

## Metrics and Success Criteria

### Primary Metrics

| Metric                    | v1 Baseline                           | v2 Target                             | How Measured                                            |
| ------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Duplicate work rate       | ~20-30% (7 PRs with overlapping code) | <5%                                   | Count tasks with overlapping file changes across rounds |
| Convention promotion rate | 0% (50+ candidates, 0 promoted)       | >50% of 3+ confirmed                  | Count auto-promoted PRs / total 3+ confirmed patterns   |
| Value per item            | Not tracked (all items equal)         | Tracked, P0 items weighted 3x         | Weighted sum from experiment log                        |
| Cost per item             | Not tracked                           | Tracked, trend visible                | Total cost / total items from experiment log            |
| Architecture alignment    | 0% validation (FLAW 1)                | 100% of items validated               | CEO Agent gate pass rate                                |
| Real-world test coverage  | 0% (FLAW 2)                           | >1 real API call per repo per session | QA agent reports                                        |

### Operational Metrics

| Metric                          | Target               | Why                                                            |
| ------------------------------- | -------------------- | -------------------------------------------------------------- |
| Items per round (trend)         | Stable or increasing | Declining trend = diminishing returns not detected fast enough |
| Time to first merge per round   | <5 min               | Merge-first protocol efficiency                                |
| Agent exhaustion accuracy       | >80% true positive   | Exhaustion claims verified by deep audit                       |
| Rounds per session              | 8-12 adaptive        | Hard data shows <5% value after 12                             |
| Cost per session                | <$50                 | Budget enforcement working                                     |
| Human interventions per session | <3                   | System is autonomous enough                                    |

### Leading Indicators

- **Convention promotion velocity**: If this is 0 after 2 weeks, the learning loop is broken
- **Cost-per-item trend**: Should decrease week-over-week as conventions improve agent accuracy
- **RISK task pass rate**: Should increase as Architect Agent catches bad plans early
- **Cross-repo items completed**: Should increase as capability manifests drive integration

## Risk Analysis

### What Could Go Wrong

| Risk                                                                         | Likelihood | Impact                                | Mitigation                                                                                                               |
| ---------------------------------------------------------------------------- | ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Merge-first creates CI failures that block all subsequent rounds             | Medium     | High — entire session stops           | Conductor falls back to "skip and continue" mode: creates new branch from last-good main, continues with remaining tasks |
| Self-claiming queue causes race conditions (two agents claim same task)      | Low        | Medium — wasted work                  | Atomic file writes with advisory locks; worst case is one agent's work discarded                                         |
| CEO Agent's architecture validation is too conservative (rejects valid work) | Medium     | Medium — reduced throughput           | Validation gate has a "SUGGEST" mode for first 2 weeks: flags but doesn't block                                          |
| Convention auto-promotion promotes wrong patterns to CLAUDE.md               | Low        | High — pollutes codebase rules        | All promotions go through PRs requiring human merge; bad patterns caught at review                                       |
| Cost tracking is inaccurate (token counting varies by provider)              | Medium     | Low — budget slightly off             | Use 20% safety margin on budget caps; true-up monthly against API billing                                                |
| Codex Pro API has downtime during overnight run                              | Medium     | Low — review degrades to single-model | Reviewer falls back to Claude-only review; logs the degradation                                                          |
| Specialist agents are slower than v1's generalist agents                     | Medium     | Medium — fewer items per session      | First 2 weeks run v1 and v2 in parallel on different repos; compare throughput                                           |
| Conductor state machine has bugs that cause infinite loops                   | Low        | High — burns budget                   | Hard round cap (12) is enforced outside the state machine; watchdog kills after N hours                                  |

### Structural Risks

**Complexity budget**: v2 is significantly more complex than v1. The merge-first protocol, specialist agents, shared queue, and learning loop are all new moving parts. Mitigation: phased migration (each phase is independently useful), and v1 remains available as fallback.

**Over-engineering**: There is a real risk that the overhead of the Conductor + specialist agents + learning loop produces less total output than v1's dumb-but-fast approach. Mitigation: track items-per-dollar in both systems for the first month.

## Appendix: v1 Lessons Learned

### The 4 FLAWs and Their Root Causes

| FLAW | Description                                                  | Root Cause                                                                    | v2 Fix                                              |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| 1    | Factory builds features nobody validated the need for        | Planner reads vault strategy but never validates against product architecture | CEO Agent: product architecture validation gate     |
| 2    | Factory tests are 100% mocks — zero real-world verification  | Eval gate only checks `npm test` (mocks)                                      | QA Agent: real API call phase, mock-only flagging   |
| 3    | Factory never analyzes existing plugin architecture          | Planner reads vault and git logs but never examines runtime environment       | CEO Agent: runtime environment analysis step        |
| 4    | Factory doesn't merge between rounds — causes duplicate work | Dispatch creates worktrees from stale main, never merges intermediate results | Conductor: merge-first protocol, file ownership map |

### Top 14 Unpromoted Conventions (from 2,749 lines of factory memory)

These were confirmed 3+ times in v1 runs but never reached CLAUDE.md:

1. `git fetch origin` at sprint start (20+ confirmations)
2. All adapter files must handle null API responses with type guards
3. Never modify `src/lib/auth.ts` in autonomous runs
4. Test files mirror `src/` structure in `__tests__/`
5. Import alias `@/` required, not relative paths
6. New adapters should copy existing adapter as template
7. `CLAUDE.md` eval gate must include `tsc --noEmit`
8. Briefing templates need explicit null checks for missing data sources
9. OAuth callback URLs must match environment (staging vs production)
10. Nango integration requires explicit token refresh error handling
11. PR descriptions must include "files changed" summary
12. SCOREBOARD updates after every commit, not just at end
13. Environment variables loaded from `.env.local`, not `.env`
14. CI-specific test config differs from local — always test with `CI=true`

v2's Memory Curator would have auto-promoted all 14 of these after their third confirmation.

### Memory System Failures

v1's memory accumulated 2,749 lines across 4 repos but was unreliable because:

- Agents wrote "I completed X" to memory without verifying against git
- Memory entries contradicted each other (one agent says pattern A works, another says it doesn't)
- No dedup — the same observation appears 5-10 times in different wordings
- No promotion pipeline — observations pile up but never become rules

v2 fixes this with the two-tier memory model (session log vs durable knowledge) and the confirmation-based promotion pipeline.

### Optimal Round Count Data

From 68 rounds across 4 repos:

```
Rounds 1-4:   ~70% of total value delivered (high-priority P0/P1 items)
Rounds 5-8:   ~20% of total value (P1/P2 items, some cleanup)
Rounds 9-12:  ~8% of total value (P2 items, diminishing returns visible)
Rounds 13+:   ~2% of total value (mostly duplicate work or trivial fixes)

Conclusion:
  - Hard stop at 12 rounds is safe (captures ~98% of value)
  - Adaptive stop at 8-10 rounds is optimal for most repos
  - Repos with deep backlogs (ConnectOS) benefit from full 12
  - Repos with shallow backlogs (brandos) should stop at 6
```

---

_Continuous Factory v2 Architecture — March 2026_
_This document is the basis for building Factory v2. Each section answers what, why, how, and how it differs from v1._
