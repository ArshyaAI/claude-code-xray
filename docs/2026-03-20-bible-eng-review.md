---
title: Engineering Review — BIBLE.md v1.0
date: 2026-03-20
reviewer: Claude Sonnet 4.6 (subagent)
status: Pre-build gate review
---

# Engineering Review: BIBLE.md

Last review before we build. Five questions answered with line references.

---

## 1. Buildability: Can M0 and M1 be built TODAY?

### M0 — Freeze Contracts (~2 hours)

**Verdict: Partially buildable. Three blockers.**

The checklist (lines 467-471) asks for: `policy.yml`, `evo.db` schema, evaluator scoring scripts, mutation operator scripts, and locking evaluator code read-only.

What's unambiguous and buildable today:

- `evo.db` schema — fully specified at lines 260-333. Copy-paste into SQLite. Done.
- Mutation operator weights — specified at lines 125-132. Straightforward weighted-random dispatch.
- `policy.yml` structure — immutable genes listed at lines 117-121. Writable in 30 minutes.

What's missing or ambiguous:

**Blocker 1: Layer 1 scoring formula constants are undefined.**

Lines 160-175 give the formulas for the 7 Pareto dimensions. The symbols are defined, but the parameters are not:

- `s_C` requires `α_L`, `α_M`, `α_D`, `τ_D` — nowhere in the document.
- `s_R` requires `w_cov`, `w_mut`, `w_hid` — not set.
- `s_Q` requires `λ` (lambda for convention decay) — not set.

You can write the scoring function skeleton, but you cannot run it without choosing these constants. They need explicit values in `policy.yml` before M0 is complete. Placeholder values would work for M0 but create a false sense of closure: M2 will break when you try to produce real scores.

**Blocker 2: "Evaluator code marked immutable" has no implementation spec.**

Line 471 says "Lock evaluator code as read-only from agents." Line 119 says "Evaluator code, scoring formulas, promotion thresholds" are immutable genes. But there is no spec for HOW this enforcement works. Options include: filesystem permissions on the scoring scripts, a hash-based integrity check in `policy.yml`, or a Paperclip-level permission boundary. None are specified. Without a concrete mechanism, this checklist item cannot be verified done.

**Blocker 3: SAST scanner for G_safe (line 149) is not named.**

The hard gate `G_safe` requires "zero critical security findings" via a "SAST scanner." The tool is not named. Semgrep? Snyk? Trivy? Bandit? The choice matters because: (a) installation is required before M0, (b) rulesets determine what "critical" means, and (c) the hidden rule sets referenced in line 191 must come from somewhere. This is a one-line decision that must be made before M0 is callable done.

### M1 — Convert Current Org to Champion Lane

**Verdict: Partially buildable. One ambiguity and one undefined component.**

Completed items (lines 476-477): CEO agent bootstrapped, Founding Engineer working. These are checked.

Remaining items (lines 478-482):

**Builder-1/2 with champion genotype**: Buildable. The genotype YAML schema is fully specified (lines 66-113). You can write the seed genotype today.

**Reviewer (Codex) wired for cross-model review**: The word "wired" is ambiguous. What is the integration surface? Does Reviewer get invoked via a Paperclip worker that calls the Codex API? Via a CLI script? Via a Paperclip agent reading a REVIEW.md artifact? The data flow diagram (line 409) shows `Reviewer → Cross-model review (Claude + Codex)` but the invocation contract is not specified. This needs a one-paragraph integration spec before implementation begins.

**Shared task queue (`~/.factory/queue/`)**: The queue format is not defined. What is a task? A JSON file? A YAML file with what fields? Line 401 says CEO produces `PROGRAM.md` and Builders "self-claim from shared queue" but there is no schema for queue items. Without a schema, Builder-1 and Builder-2 cannot be configured to consume from the queue. This is the single largest gap in M1.

**Merge-first protocol by Conductor**: "Conductor" appears in the data flow diagram (line 403) but has no entry in the Agent Roster (lines 26-38). It is either a 13th agent not in the roster, or it is a script, or it is a function of an existing agent. Undefined.

---

## 2. Dependency Order: Are M0-M6 in the correct order?

**Mostly correct. One hidden dependency and one ordering concern.**

The stated sequence: M0 (contracts) → M1 (champion lane) → M2 (evaluator harness) → M3 (explorer pool) → M4 (archive + promoter) → M5 (first controlled promotion) → M6 (frame audit).

**Hidden dependency: M1 requires a functional evaluation loop before it is useful.**

M1 sets up the champion lane (Builders, Reviewer, QA) but evaluation is M2. This means in the interval between M1 and M2, you have Builders producing output with no scoring. The QA item in M1 (line 481: "QA agent running real eval gates") implies the hard gates (G_build, G_test, G_lint) from M2's Layer 1 must be running. But M2 is not built yet. Either: (a) a subset of the hard gates must be implemented as part of M1 (not M2), or (b) M1 and M2 must be co-developed. The current ordering implies M1 is fully functional before M2, which is false.

**Ordering concern: M4 (archive + promoter) subsumes part of M3.**

M3 (line 493-500) says "Implement frontier archive and cemetery in evo.db." M4 (line 503) says "Implement frontier archive indexed by niche." These overlap. Either M3 creates the frontier archive table (which is already in the schema at M0), or M4 does it. Both milestones claim it. One of them should be removed.

The rest of the order is sound: you need a genotype schema (M3) before you can run a promotion protocol (M4), and you need both before a live promotion test (M5).

---

## 3. Contradictions

**Four contradictions found.**

**Contradiction 1: Agent count — 12 in roster, "Conductor" in data flow.**

Line 23 says "Agent Roster (12 agents)." The roster (lines 26-38) lists exactly 12 agents. But line 403 in the production data flow shows a "Conductor" step between CEO and Builders. Conductor is not in the roster, has no budget allocation, no model assignment, and no heartbeat. Either it is a 13th agent that was forgotten, or it is one of the existing 12 agents under a different name. This is unresolved.

**Contradiction 2: Explorer pool size — "2 agents" in roster vs "8-32" in architecture.**

Line 7 (executive summary) says "8-32 explorers." Lines 31-32 in the agent roster list exactly 2 explorers (Explorer-1, Explorer-2). The open question in line 586 acknowledges this but frames it as a future scaling decision. The contradiction is that the budget math (line 43-45) allocates 25% to the evolution lane, but if you scale to 8-32 explorers, the budget breakdown becomes invalid. The architecture is written as if 8-32 is the design intent while the roster implements 2. Build to 2; the 8-32 claim in the executive summary should be removed or annotated.

**Contradiction 3: Stage 3 sample size — "12 tasks" vs "24 for high-risk."**

Line 229 says Stage 3 (live shadow) uses "12 real production tasks." Line 254 says "If the mutation touches `model_routing` or `prompt_policy`, require Stage 3 minimum sample size of 24 (not 12)." The base number is consistent (12), but M4's checklist item (line 508: "Implement confidence sequences for Stage 3-4 monitoring") does not mention implementing the high-risk 24-task variant. If M4 implements a fixed 12-task Stage 3, the High-Risk Rule is not implemented. This needs an explicit checklist item in M4.

**Contradiction 4: Memory Curator heartbeat — "per-round" vs daily cycle.**

Line 37 gives Memory Curator a heartbeat of "per-round." The daily cycle at line 377 says "Memory Curator processes all observations from past 24 hours" as step 4. These are consistent in principle (runs per-round, but the daily cycle triggers a larger batch pass), but "per-round" is undefined as a time unit. A "round" is not defined in the document. This makes Memory Curator's invocation frequency impossible to implement without a definition.

---

## 4. Hardest Part to Build Correctly

**The evaluator is the hardest part. Specifically: preventing Layer 1 from being gamed while it is also the selection signal for the explorer.**

This is not an implementation difficulty — it is a fundamental design tension that the BIBLE acknowledges (line 185-193: "The explorer never sees these tests") but does not resolve for Layer 1.

Layer 1 (`R_search`) is the signal explorers optimize against (line 143: "Fast, automated, runs on every candidate. This is what explorers optimize against."). The seven Pareto dimensions include metrics like `s_T` (throughput: items completed per hour) and `s_K` (cost efficiency). These are directly gameable under selection pressure:

- An explorer that routes tasks by estimated difficulty will inflate `s_T` by cherry-picking easy tasks.
- An explorer with a lower `max_cost_per_task_usd` will mechanically inflate `s_K` without improving actual output quality.
- `s_C` depends on lint violations and cyclomatic complexity — gameable by splitting functions or adding trivial docstrings.

The document's answer to this is the three-layer evaluator: Layer 2 and Layer 3 catch gaming that Layer 1 misses. But this assumes Layer 2 (hidden holdout) is sufficiently independent of Layer 1. The hidden holdout is "a private regression suite with rotating fuzz seeds" (line 187) — but if the same agent that games Layer 1 also interacts with (or can observe the effect of) Layer 2, the separation degrades over time.

The hardest implementation question the BIBLE leaves open: **who writes the hidden holdout tests, and how are they kept secret from the system?** Line 471 says evaluator code is "locked as read-only from agents," but the hidden holdout content must be stored somewhere. If it lives in evo.db (which explorers can read per line 342: "Explorer reads: conventions, genotypes, cemetery"), then the separation is already broken.

This is where implementation will get stuck: you will build the evaluator, run the first explorer batch, and discover that explorer performance on Layer 1 is rising while Layer 2 pass rates fall. At that point you need the hidden holdout isolation to be correct, and if the storage design was wrong, you are refactoring the database schema and access control under live evaluation. Decide the isolation architecture before M2 is built.

---

## 5. First Failure: What Breaks First

**The shared task queue will be the first failure point.**

When the system runs for the first time (M1 complete, M2 not yet done), the production flow is: CEO produces PROGRAM.md → Conductor merges PRs and branches → Builder-1 and Builder-2 self-claim from `~/.factory/queue/`.

The failure mode: two Builders claiming the same task simultaneously.

The BIBLE says Builders "self-claim from shared queue" (line 406) but does not specify the atomicity mechanism. A filesystem-based queue at `~/.factory/queue/` with no locking will have a race condition on every run where two Builders are active at the same time. Both Builders read the same unclaimed task, both write a claim file, and both start working on the same ticket. The result is two conflicting branches, two PRs for the same task, and a merge conflict in main.

The existing factory dispatch scripts (`bin/factory-dispatch.sh`) may handle some of this, but the BIBLE does not reference them or specify that the queue implementation must be atomic. This is not a design flaw — it is an implementation gap that will surface immediately on the first multi-Builder run.

The second thing to break: **the `G_review` hard gate** (line 149 — "Cross-model review score >= threshold" via Codex + Claude). This gate requires a running Codex integration. Codex is listed as the Reviewer agent's model (line 33: "Codex xhigh") but the integration spec does not exist (see Buildability section above). The gate will be wired in M2 before the integration is validated, and the first real task review will fail with a connection error or undefined response format.

---

## Summary Table

| Question           | Finding                                                                                                      | Severity |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | -------- |
| M0 buildable today | Yes, with 3 blockers: scoring constants undefined, immutability enforcement unspecified, SAST tool not named | High     |
| M1 buildable today | Yes, with 2 gaps: task queue schema undefined, Conductor agent undefined                                     | High     |
| Milestone ordering | Mostly correct; M1/M2 co-dependency not acknowledged; M3/M4 frontier archive overlap                         | Medium   |
| Contradictions     | 4 found: Conductor count, explorer pool size, Stage 3 high-risk variant in M4, "per-round" undefined         | Medium   |
| Hardest part       | Hidden holdout isolation from explorer read access; storage architecture must be decided before M2           | Critical |
| First failure      | Shared task queue race condition on multi-Builder claim; followed by Codex integration gap in G_review       | High     |

---

## Pre-Build Decisions Required

Before writing the first line of code, these must be decided (not deferred):

1. **Scoring constants**: Set α_L, α_M, α_D, τ_D, w_cov, w_mut, w_hid, λ in `policy.yml`. Can be provisional but must be nonzero.
2. **SAST tool**: Name it. Semgrep is the obvious choice for multi-language; add to install.sh.
3. **Task queue schema**: Define the JSON/YAML schema for a queue item before Builder agents are configured.
4. **Hidden holdout storage**: Decide whether hidden tests live in a separate database, a filesystem path not in evo.db's explorer-accessible tables, or an environment that agents literally cannot query. This is an access control architecture decision.
5. **Conductor identity**: Is it Agent 13, a shell script, or Builder-1 in a different mode? Name it and add it to the roster if it is an agent.
6. **"Per-round" definition**: Define "round" as a time unit or event trigger for Memory Curator's heartbeat.
