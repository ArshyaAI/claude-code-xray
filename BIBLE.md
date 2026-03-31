# DeFactory -- The Implementation Bible

Version: 1.0 | Date: 2026-03-20 | Status: Canonical

## Executive Summary

DeFactory is a continuously self-improving AI development company that ships code across multiple repositories while evolving its own configuration through natural selection. One champion config runs production. An archive of elite configs, indexed by niche, feeds 8-32 explorers that mutate one variable at a time. A three-layer evaluator (cheap public score, hidden private gate, delayed real-world truth) decides who gets promoted. The system improves monotonically because only statistically validated winners survive a four-stage promotion protocol. Two co-founders (Arshya, technical; Nicholas, business/NIKIN) govern as the board. The first external customer is NIKIN. The target is CHF 1M ARR from 8-12 inventory-heavy, brand-led SMEs within 18 months. Everything runs on Paperclip (localhost:3100) with a $400/month model budget.

## The One-Sentence Architecture

"Search on a cheap proxy. Promote on hidden reality. Retrain the proxy on delayed truth."

## Company Structure

### Identity

- **Company**: DeFactory (newco, clean cap table, clean IP)
- **Mission**: Governed autonomy with measurable ROI for inventory-heavy, brand-led SMEs
- **Paperclip instance**: `~/.paperclip/instances/default/` on `127.0.0.1:3100`
- **Database**: embedded-postgres on port 54329, hourly backups, 30-day retention
- **GitHub**: ArshyaAI/continuous-factory

### Agent Roster (12 agents)

| #   | Agent              | Adapter      | Model ID          | Effort/Reasoning | Heartbeat | Budget | Role                                    | Why this model                                       |
| --- | ------------------ | ------------ | ----------------- | ---------------- | --------- | ------ | --------------------------------------- | ---------------------------------------------------- |
| 1   | CEO                | claude_local | claude-opus-4-6   | max              | 2 hours   | 15%    | Strategy, hiring, unblocking, P&L       | Deepest reasoning for strategic decisions            |
| 2   | CTO                | claude_local | claude-opus-4-6   | high             | 2 hours   | 10%    | Architecture judgment, tech debt        | Architecture needs depth, not max                    |
| 3   | Builder-1          | claude_local | claude-sonnet-4-6 | —                | on-demand | 12%    | Code implementation (champion lane)     | Speed + quality balance for shipping code            |
| 4   | Builder-2          | claude_local | claude-sonnet-4-6 | —                | on-demand | 12%    | Code implementation (champion lane)     | Same as Builder-1, parallel capacity                 |
| 5   | Explorer-1         | claude_local | claude-sonnet-4-6 | —                | hourly    | 5%     | Mutation experiments (explorer pool)    | Fast + cheap for throwaway experiments               |
| 6   | Explorer-2         | codex_local  | gpt-5.4-mini      | medium           | hourly    | 3%     | Mutation experiments (explorer pool)    | Cross-model diversity in experiments, cheapest       |
| 7   | Reviewer           | codex_local  | gpt-5.3-codex     | xhigh            | on-demand | 5%     | Cross-model adversarial review          | Cross-model catches Claude blind spots, deep review  |
| 8   | QA                 | claude_local | claude-sonnet-4-6 | —                | on-demand | 5%     | Real tests, integration verification    | Speed for test execution, tool use                   |
| 9   | Evaluator          | claude_local | claude-sonnet-4-6 | —                | hourly    | 5%     | Score computation, promotion decisions  | Execution (not judgment), needs speed                |
| 10  | Memory Curator     | claude_local | claude-opus-4-6   | high             | per-round | 5%     | Convention extraction, promotion, decay | Convention judgment requires strong reasoning        |
| 11  | Objective Auditor  | claude_local | claude-opus-4-6   | max              | 4 hours   | 10%    | External-reality grounding, frame audit | Existential questions need deepest reasoning         |
| 12  | Research Scientist | codex_local  | gpt-5.4           | high             | daily     | 3%     | Benchmark curation, archive maintenance | Cross-model perspective on metrics, strong reasoning |

#### Board Advisors (on-demand, no heartbeat)

| #   | Advisor    | Adapter      | Model ID        | Effort/Reasoning | Role                                    | Why this model                                    |
| --- | ---------- | ------------ | --------------- | ---------------- | --------------------------------------- | ------------------------------------------------- |
| B1  | Analyst    | codex_local  | gpt-5.4         | xhigh            | Quantitative analysis, ROI, cost trends | Best at quantitative analysis, cross-model        |
| B2  | Critic     | codex_local  | gpt-5.3-codex   | xhigh            | Red-teams everything, finds flaws       | Adversarial by design, catches Claude blind spots |
| B3  | Strategist | claude_local | claude-opus-4-6 | max              | Long-term thinking, paradigm shifts     | Deepest abstract reasoning                        |

#### Model Routing Principles

1. **Judgment → Opus max**: CEO, Objective Auditor, Strategist. These make irreversible decisions.
2. **Judgment → Opus high**: CTO, Memory Curator. Important reasoning but not existential.
3. **Execution → Sonnet**: Builders, QA, Evaluator. Speed matters, quality is gated by review.
4. **Cross-model → Codex/GPT**: Reviewer, Explorer-2, Analyst, Critic, Research Scientist. Prevents groupthink from all-Claude roster.
5. **Speed → Spark/Mini**: When near-instant iteration matters more than depth. Spark for rapid code iteration loops, Mini for cheap parallel work.
6. **Budget → cheapest viable**: Explorer-2 on gpt-5.4-mini ($0.75/MTok). Experiments are throwaway.
7. **Never**: route judgment roles to fast models. Never route execution roles to expensive models.

#### Available Model Tiers (by use case)

| Tier                   | Claude                  | OpenAI                 | Use for                                                  |
| ---------------------- | ----------------------- | ---------------------- | -------------------------------------------------------- |
| **Deep reasoning**     | claude-opus-4-6 (max)   | gpt-5.4 (xhigh)        | CEO, Board, Auditor — irreversible decisions             |
| **Strong reasoning**   | claude-opus-4-6 (high)  | gpt-5.3-codex (xhigh)  | CTO, Reviewer, Memory Curator — judgment + cross-model   |
| **Balanced execution** | claude-sonnet-4-6       | gpt-5.3-codex (medium) | Builders, QA, Evaluator — speed + quality                |
| **Fast iteration**     | claude-sonnet-4-6 (low) | gpt-5.3-codex-spark    | Rapid code loops, instant feedback, inner-loop iteration |
| **Cheap parallel**     | claude-haiku-4-5        | gpt-5.4-mini           | Explorers, bulk experiments, routing, classification     |
| **Ultra-cheap**        | —                       | gpt-5.4-nano           | Scoring, filtering, high-volume low-stakes tasks         |

**Key models for the CEO to know when hiring:**

- `gpt-5.3-codex-spark` — Near-instant coding iteration. Pro subscription only. Best for tight build-test-fix loops where latency matters more than reasoning depth. Use for inner-loop work inside a Builder's heartbeat.
- `gpt-5.4-mini` — $0.75/MTok input, 400k context. SOTA for its price tier. Use for Explorers, parallel experiments, or any agent that runs many cheap iterations.
- `gpt-5.4-nano` — $0.20/MTok input. Use for scoring, classification, routing decisions where volume is high and stakes are low.
- `claude-haiku-4-5` — $1.00/MTok input, 200k context. Fastest Claude. Use when you need Claude-family capabilities at budget pricing.

#### Paperclip Adapter Config Reference

| Adapter      | Effort key               | Values                             | Permission flag                            |
| ------------ | ------------------------ | ---------------------------------- | ------------------------------------------ |
| claude_local | effort                   | low, medium, high, max (Opus only) | dangerouslySkipPermissions: true           |
| codex_local  | modelReasoningEffort     | minimal, low, medium, high, xhigh  | dangerouslyBypassApprovalsAndSandbox: true |
| gemini_local | (thinking_level via API) | minimal, low, medium, high         | (varies)                                   |

Full model catalog: `/Users/arshya/Arshya's Brain Network/01 CEO/model-catalog-2026-03.md`

### Budget Allocation

- **Total**: $400/month (Claude Max 20x + ChatGPT Pro)
- **Champion lane** (agents 1-4, 7-8): ~60% -- production work
- **Evolution lane** (agents 5-6, 9, 12): ~16% -- experiments (lean)
- **Governance** (agents 10-11, B1-B3): ~24% -- memory + audit + board

### CEO Persona (from SOUL.md)

- Owns the P&L. Default to action. Ship over deliberate.
- Protect focus hard. Say no to low-impact work.
- Direct voice: lead with the point, no filler, no exclamation points.
- Match intensity to stakes. Own uncertainty when it exists.

### Engineering Protocol (from SPRINT.md)

Six phases, no shortcuts: THINK > PLAN > BUILD > REVIEW > SHIP > REFLECT.

- Architecture gate before every task: does this use the core pattern or invent a new one?
- WTF circuit breaker: >20% failure rate = STOP and mark blocked.
- Max 30 commits per sprint. Always PR, never push to main.

## The Genotype (What Mutates)

A genotype is a YAML document that defines one complete agent-company configuration. This is the unit of selection.

```yaml
# genotype.yaml -- the "organism" under evolution
version: 1
id: "gen-0042"
parent_id: "gen-0038"
created_at: "2026-03-20T14:00:00Z"

model_routing:
  ceo: { model: "claude-opus-4-6", effort: "max" } # IMMUTABLE
  cto: { model: "claude-opus-4-6", effort: "high" } # IMMUTABLE
  builder: { model: "claude-sonnet-4-6" } # MUTABLE
  reviewer: { model: "gpt-5.3-codex", reasoning: "xhigh" } # MUTABLE
  qa: { model: "claude-sonnet-4-6" } # MUTABLE
  explorer: { model: "claude-sonnet-4-6" } # MUTABLE
  evaluator: { model: "claude-sonnet-4-6" } # MUTABLE
  memory_curator: { model: "claude-opus-4-6", effort: "high" } # IMMUTABLE
  auditor: { model: "claude-opus-4-6", effort: "max" } # IMMUTABLE
  analyst: { model: "gpt-5.4", reasoning: "xhigh" } # MUTABLE
  critic: { model: "gpt-5.3-codex", reasoning: "xhigh" } # MUTABLE
  strategist: { model: "claude-opus-4-6", effort: "max" } # IMMUTABLE

prompt_policy:
  builder_system: "sha256:abc123" # MUTABLE (ref to prompt file)
  reviewer_system: "sha256:def456" # MUTABLE
  qa_system: "sha256:ghi789" # MUTABLE

tool_policy:
  builder_tools: ["read", "edit", "bash", "glob", "grep"] # MUTABLE
  reviewer_tools: ["read", "grep", "glob"] # IMMUTABLE

cadence:
  explorer_batch_interval_min: 60 # MUTABLE (30-180)
  evaluator_interval_min: 60 # MUTABLE (30-120)
  memory_curator_interval_min: 120 # MUTABLE (60-360)
  audit_interval_min: 240 # MUTABLE (120-480)

permissions:
  auto_merge_safe: true # MUTABLE
  max_files_per_task: 5 # MUTABLE (1-10)
  max_commits_per_sprint: 30 # IMMUTABLE

memory_retrieval:
  max_conventions_in_context: 20 # MUTABLE (5-50)
  memory_decay_days: 30 # MUTABLE (7-90)
  cross_repo_inheritance: true # MUTABLE

review_strategy:
  require_cross_model: true # MUTABLE
  min_review_score: 80 # MUTABLE (60-100)

budget:
  max_cost_per_task_usd: 2.00 # MUTABLE (0.50-5.00)
  max_cost_per_round_usd: 20.00 # MUTABLE (5.00-50.00)
```

### Immutable Genes (never mutate)

- `permissions.max_commits_per_sprint`: 30 (safety cap)
- `tool_policy.reviewer_tools`: read-only (evaluator integrity)
- Evaluator code, scoring formulas, promotion thresholds
- Safety gates (build must pass, no critical security findings)
- Human approval requirement for high-risk changes

### Mutation Operators and Weights

| Operator           | Weight | Description                                |
| ------------------ | ------ | ------------------------------------------ |
| `swap_model`       | 0.25   | Change model for one agent role            |
| `tweak_cadence`    | 0.20   | Adjust one interval by +/- 25%             |
| `swap_prompt`      | 0.20   | Replace one agent's system prompt variant  |
| `adjust_threshold` | 0.15   | Change one numeric threshold within bounds |
| `toggle_policy`    | 0.10   | Flip one boolean policy flag               |
| `adjust_budget`    | 0.10   | Change one cost cap within bounds          |

Rule: mutate exactly ONE gene per generation. Never mutate evaluator or safety gates.

## The Evaluator Stack

### Layer 1: R_search (Cheap Public Score)

Fast, automated, runs on every candidate. This is what explorers optimize against.

**Hard Gates** (must all pass, binary):

| Gate     | Check                                   | Tool           |
| -------- | --------------------------------------- | -------------- |
| G_build  | `npm run build` / `tsc --noEmit` passes | CI             |
| G_test   | `npm test` / `pytest` passes            | CI             |
| G_lint   | Lint + format passes                    | CI             |
| G_review | Cross-model review score >= threshold   | Codex + Claude |
| G_safe   | Zero critical security findings         | SAST scanner   |

$$G(p) = \prod_{i} \mathbf{1}[\text{gate}_i \text{ passes}]$$

If $G(p) = 0$, reject immediately. No further evaluation.

**Pareto Dimensions** (7 scores, each in [0,1]):

| Dim | Name                 | Symbol | Formula                                                                                   |
| --- | -------------------- | ------ | ----------------------------------------------------------------------------------------- |
| C   | Code Quality         | $s_C$  | $\exp(-\alpha_L L) \cdot \exp(-\alpha_M M) \cdot \sigma(\alpha_D(D - \tau_D))$            |
| R   | Test Reliability     | $s_R$  | $w_{cov} \cdot cov_\Delta + w_{mut} \cdot mut + w_{hid} \cdot hcov$                       |
| H   | Human Approval       | $s_H$  | $\Pr(\theta_p \geq \tau_H \mid \text{data})$ via $\text{Beta}(\alpha_0 + A, \beta_0 + R)$ |
| Q   | Convention Adherence | $s_Q$  | $\exp(-\lambda \cdot v(p) / \max(1, \text{KLOC}))$                                        |
| T   | Throughput           | $s_T$  | items_completed / time_hours, normalized to [0,1]                                         |
| K   | Cost Efficiency      | $s_K$  | $1 - \min(1, \text{cost\_per\_item} / \text{budget\_per\_item})$                          |
| S   | Safety               | $s_S$  | $\prod_j \mathbf{1}[\text{guardrail}_j \text{ passes}]$ (binary post-gate)                |

Where:

- $L$ = lint violations weighted by severity
- $M$ = cyclomatic complexity penalty
- $D$ = documentation coverage on changed surfaces
- $cov_\Delta$ = diff-hunk coverage, $mut$ = mutation score, $hcov$ = hidden holdout pass rate
- $v(p)$ = convention violations count
- $\sigma(z) = 1/(1+e^{-z})$

**Tie-break Utility** (only when Pareto-equivalent):

$$U(p) = w_C s_C + w_R s_R + w_H s_H + w_Q s_Q + w_T s_T + w_K s_K + w_S s_S$$

Default weights (set by leadership, never learned by agents):
$w_C = 0.15, w_R = 0.20, w_H = 0.15, w_Q = 0.10, w_T = 0.15, w_K = 0.15, w_S = 0.10$

### Layer 2: Gate (Hidden Private Evaluation)

Runs only on candidates that pass Layer 1 and are nominated for promotion. The explorer never sees these tests.

- **Hidden holdout tests**: private regression suite with rotating fuzz seeds
- **Mutation testing**: on a secret mutant subset (not the public one)
- **Security probes**: SAST + dependency scan with hidden rule sets
- **Cross-repo compatibility**: candidate must not break other repos

Feedback to explorer: PASS/FAIL only. No test details. No failing line numbers. This prevents overfitting to the hidden set.

### Layer 3: Truth (Delayed Outcomes)

Measured after merge, on a 7-30 day delay. Used to recalibrate R_search weights.

- Post-merge incident rate on touched modules
- Rollback frequency
- Production error rate delta
- Customer complaint correlation
- Convention violations discovered post-merge

This creates a delayed penalty for "flashy but brittle" hacks. Agents that game Layer 1 get caught here.

## The Promotion Protocol

### Stage 1: Frontier Admission

Explorer produces a candidate genotype. Evaluator runs it through 8 benchmark tasks (pre-declared, rotated weekly).

- **Test**: One-sided sign test. Candidate must be non-inferior to champion on ALL 7 Pareto dimensions.
- **Threshold**: $p < 0.05$ on sign test for primary metric ($s_T$ or $s_R$ depending on niche).
- **Result**: Admitted to frontier archive, or rejected with causal notes to cemetery.

### Stage 2: Champion Challenge -- Hidden Holdout

Candidate runs 12 tasks from the hidden holdout set. Champion runs same 12 tasks.

- **Test**: Welch's t-test on utility $U(p)$ with last 12 task scores per side (from PBT).
- **Threshold**: Candidate mean > Champion mean AND $p < 0.05$.
- **Guardrails**: For each guardrail metric $g$: $\text{UCB}_{0.95}(\Delta g) \leq \delta_g$.
- **Result**: Advance to Stage 3, or return to archive with notes.

### Stage 3: Champion Challenge -- Live Shadow

Candidate config shadows the champion on 12 real production tasks. Both produce outputs; only champion's output is merged.

- **Test**: Same as Stage 2, but on real tasks (not benchmarks).
- **Monitoring**: Anytime-valid confidence sequences for continuous monitoring. Can stop early for harm.
- **Result**: Advance to Stage 4, or return to archive.

### Stage 4: Canary (10% Live Traffic)

Candidate handles 10% of real production tasks. Champion handles 90%.

- **Duration**: Minimum 24 hours, maximum 72 hours.
- **Monitoring**: All 7 Pareto dimensions tracked with confidence sequences.
- **Promotion decision**:

$$D(p, p_0) = 1 \iff \begin{cases} G(p) = 1 \\ \Pr(\Delta_T > 0) \geq 0.95 \\ \forall j: \Pr(\Delta g_j \leq \delta_j) \geq 0.95 \\ s_H(p) \geq 0.80 \end{cases}$$

### Rollback Triggers (any one = immediate rollback)

- Any critical security finding
- Build/test failure rate > 2x champion baseline
- Cost per item > 3x champion baseline
- Human approval rate drops below 0.60
- Confidence sequence crosses harm boundary

### High-Risk Rule

If the mutation touches `model_routing` or `prompt_policy`, require Stage 3 minimum sample size of 24 (not 12). Model swaps have higher variance and need more data.

## Memory Architecture

### SQLite Schema (evo.db)

```sql
-- The evolutionary record
CREATE TABLE genotypes (
  id            TEXT PRIMARY KEY,      -- "gen-0042"
  parent_id     TEXT,                  -- "gen-0038" or NULL for seed
  yaml          TEXT NOT NULL,         -- full genotype YAML
  created_at    TEXT NOT NULL,         -- ISO 8601
  status        TEXT NOT NULL,         -- 'active'|'frontier'|'champion'|'cemetery'
  niche         TEXT,                  -- e.g. "typescript-backend" or "docs-only"
  generation    INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES genotypes(id)
);

CREATE TABLE evaluations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  genotype_id   TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  stage         TEXT NOT NULL,         -- 'search'|'hidden'|'shadow'|'canary'
  scores        TEXT NOT NULL,         -- JSON: {"C":0.8,"R":0.9,"H":0.7,...}
  utility       REAL NOT NULL,
  cost_usd      REAL NOT NULL,
  duration_sec  INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (genotype_id) REFERENCES genotypes(id)
);

CREATE TABLE promotions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  winner_id     TEXT NOT NULL,
  loser_id      TEXT NOT NULL,
  stage         TEXT NOT NULL,         -- which stage decided it
  evidence      TEXT NOT NULL,         -- JSON: test stats, p-values, CIs
  created_at    TEXT NOT NULL,
  FOREIGN KEY (winner_id) REFERENCES genotypes(id),
  FOREIGN KEY (loser_id) REFERENCES genotypes(id)
);

CREATE TABLE conventions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,
  status        TEXT NOT NULL,         -- 'observation'|'candidate'|'promoted'|'rejected'|'revoked'
  confirmations INTEGER DEFAULT 1,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  scope         TEXT NOT NULL,         -- 'repo:connectos' or 'cross-repo'
  confidence    REAL DEFAULT 0.5,      -- 0.0-1.0
  pr_url        TEXT,                  -- link to promotion PR
  revocation    TEXT                   -- reason if revoked
);

CREATE TABLE memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,         -- 'rule'|'evidence'|'observation'|'procedure'
  content       TEXT NOT NULL,
  scope         TEXT NOT NULL,         -- repo or 'global'
  confidence    REAL DEFAULT 0.5,
  ttl_days      INTEGER DEFAULT 30,
  created_at    TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count  INTEGER DEFAULT 0,
  superseded_by INTEGER,               -- FK to newer memory entry
  FOREIGN KEY (superseded_by) REFERENCES memory(id)
);

CREATE TABLE cemetery (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  genotype_id   TEXT NOT NULL,
  cause         TEXT NOT NULL,         -- why it failed
  stage         TEXT NOT NULL,         -- where it failed
  scores        TEXT NOT NULL,         -- JSON of final scores
  lessons       TEXT,                  -- causal notes for future search
  created_at    TEXT NOT NULL,
  FOREIGN KEY (genotype_id) REFERENCES genotypes(id)
);
```

### Retrieval Contracts Per Agent Type

| Agent              | Reads                                       | Writes                     |
| ------------------ | ------------------------------------------- | -------------------------- |
| CEO                | conventions (promoted), memory (all)        | memory (rule, procedure)   |
| Builder            | conventions (promoted), memory (rule)       | memory (observation)       |
| Explorer           | conventions (promoted), genotypes, cemetery | evaluations (search stage) |
| Evaluator          | evaluations (all), genotypes                | evaluations, promotions    |
| Memory Curator     | memory (all), conventions (all)             | conventions, memory        |
| Objective Auditor  | everything (read-only)                      | memory (rule) -- flagged   |
| Research Scientist | evaluations, genotypes, cemetery            | genotypes (frontier)       |

### Confirmation Rules

- **Observation**: first sighting of a pattern. Confidence 0.3.
- **Candidate**: 3+ confirmations across 2+ sessions. Confidence 0.6. Auto-generates PR.
- **Promoted**: PR merged by human. Confidence 0.9. Added to CLAUDE.md.
- **Revoked**: human rejects OR post-merge incidents correlate. Confidence drops to 0.1.

### TTL and Decay

- Observations: 14-day TTL. If not confirmed, archived.
- Candidates: 30-day TTL. If not promoted, demoted to observation.
- Rules/procedures: no TTL, but `last_accessed` tracked. If not accessed in 60 days, flagged for review.
- Memory entries with `confidence < 0.2` are excluded from retrieval.

## Three Timescales

### Hourly: Explorer Batches

1. Explorer pool (2-8 agents) each take the current champion genotype.
2. Each applies exactly one mutation (weighted random from operator table).
3. Each runs a batch of tasks from the shared queue.
4. Evaluator scores all results against Layer 1 (R_search).
5. Non-dominated candidates admitted to frontier archive.
6. Dominated candidates go to cemetery with causal notes.

### Daily: Benchmark Curation + Champion Challenges

1. Research Scientist reviews frontier archive.
2. Top frontier candidate enters Stage 2 (hidden holdout challenge).
3. If passes: enters Stage 3 (live shadow).
4. Memory Curator processes all observations from past 24 hours.
5. Conventions with 3+ confirmations get auto-PR.
6. CEO reviews budget burn: cost per item trend, budget remaining.
7. Daily report to board: items shipped, promotions attempted, cost.

### Weekly: Frame Audit + Drift Detection

1. Objective Auditor asks: "Is the system solving the right problem?"
2. Benchmark drift check: are hidden holdout tasks still representative?
3. Stale memory pruning: archive observations past TTL.
4. Rotate 25% of hidden holdout tests (prevent overfitting).
5. Cemetery review: any failed genotypes worth revisiting?
6. Weekly report to founders: revenue impact, system health, recommendations.

## Data Flow Diagrams

### Production Flow (Champion Lane)

```
Ticket/Task
    |
    v
CEO Agent -----> PROGRAM.md (prioritized, file-ownership mapped)
    |
    v
Conductor -----> Merge previous round PRs into main
    |             Branch from fresh main
    v
Builder-1/2 ---> Self-claim from shared queue
    |             Fixed time budget per task
    |             Artifact-based comms (PLAN.md, REVIEW.md, QA.md)
    v
Reviewer ------> Cross-model review (Claude + Codex)
    |
    v
QA Agent ------> Real tests + integration checks
    |             Flag MOCK_ONLY if no real API calls
    v
Evaluator -----> Score against Layer 1 (R_search)
    |
    v
PR Created -----> Human merge (SAFE) or auto-merge
    |
    v
Archive --------> Task result logged to evo.db
```

### Evolution Flow (Explorer Lane)

```
Champion Genotype
    |
    v
Mutation Operator -----> New Genotype (one gene changed)
    |
    v
Explorer Agent --------> Runs batch of tasks with new config
    |
    v
Evaluator (Layer 1) ---> Score on R_search (7 Pareto dims)
    |
    +--> FAIL: Cemetery (with causal notes + lessons)
    |
    +--> PASS: Frontier Archive (indexed by niche)
              |
              v
         Research Scientist selects top candidate
              |
              v
         Stage 2: Hidden Holdout (12 tasks, Welch t-test)
              |
              +--> FAIL: Back to archive
              |
              +--> PASS: Stage 3: Live Shadow (12 real tasks)
                         |
                         +--> FAIL: Back to archive
                         |
                         +--> PASS: Stage 4: Canary (10% traffic, 24-72h)
                                    |
                                    +--> FAIL: Rollback, archive
                                    |
                                    +--> PASS: PROMOTED to Champion
                                               Old champion -> archive (not cemetery)
```

## Milestone Build Sequence

### M0: Freeze Contracts [~2 hours]

- [ ] Write `policy.yml` (immutable genes, safety gates, mutation bounds)
- [ ] Create `evo.db` with schema above
- [ ] Write evaluator scoring scripts (Layer 1 only)
- [ ] Write mutation operator scripts
- [ ] Lock evaluator code as read-only from agents

### M1: Convert Current Org to Champion Lane [WE ARE HERE]

- [x] DeFactory company created in Paperclip
- [x] CEO agent bootstrapped (SOUL.md, HEARTBEAT.md)
- [x] Founding Engineer hired, working DEFA-5
- [ ] Builder-1 and Builder-2 configured with champion genotype
- [ ] Reviewer (Codex) wired for cross-model review
- [ ] QA agent running real eval gates
- [ ] Shared task queue operational (`~/.factory/queue/`)
- [ ] Merge-first protocol enforced by Conductor

### M2: Build Evaluator Harness [~4 hours]

- [ ] Implement Layer 1 scoring (all 7 dimensions)
- [ ] Build hidden holdout test suite (Layer 2)
- [ ] Set up evaluation cascade (Gate A through Gate E)
- [ ] Wire evaluator to evo.db for result storage
- [ ] Implement hard gates (build/test/lint/review/safety)
- [ ] Evaluator code marked immutable in policy.yml

### M3: Add Explorer Pool [~3 hours]

- [ ] Implement genotype YAML schema with validation
- [ ] Build mutation operators (6 operators, weighted selection)
- [ ] Configure Explorer-1 and Explorer-2
- [ ] Wire explorers to evaluator pipeline
- [ ] Implement frontier archive and cemetery in evo.db
- [ ] Verify: explorer cannot read hidden holdout tests

### M4: Add Archive + Promoter [~3 hours]

- [ ] Implement frontier archive indexed by niche
- [ ] Build promotion protocol (all 4 stages)
- [ ] Implement Welch t-test for Stage 2
- [ ] Implement confidence sequences for Stage 3-4 monitoring
- [ ] Build rollback triggers
- [ ] Wire Research Scientist to archive curation

### M5: First Controlled Promotion [~2 hours]

- [ ] Seed archive with 3 hand-crafted genotype variants
- [ ] Run full promotion protocol end-to-end
- [ ] Verify: failing candidate goes to cemetery with notes
- [ ] Verify: winning candidate becomes new champion
- [ ] Verify: old champion moves to archive (not deleted)
- [ ] Verify: rollback trigger works within 5 minutes

### M6: Weekly Frame Audit [~2 hours]

- [ ] Configure Objective Auditor (replaces "Consciousness Layer")
- [ ] Wire to external outcome data (post-merge incidents, rollbacks)
- [ ] Implement benchmark rotation (25% weekly)
- [ ] Implement stale memory pruning
- [ ] Build weekly report template
- [ ] Verify: auditor can flag "wrong problem" and trigger strategy review

## Business Context

### Co-Founders

- **Arshya** (Zurich): Technical system, platform architecture, agent engineering
- **Nicholas Hanny** (NIKIN CEO): Business partner, first deployment, GTM

### NIKIN = Design Partner (Must Pay)

- Design partner pricing, not free. NIKIN pays from day one.
- Engagement: retainer (CHF 3-5K/month) + setup fee (CHF 5-7K)
- Deliverable: morning briefing, task prioritization, bounded research, inbox prep

### ICP (Ideal Customer Profile)

- Inventory-heavy, brand-led SMEs
- 20-250 employees
- Switzerland-first, DACH-expandable
- Already experimenting with AI (34% of Swiss SMEs per 2026 data)
- Pain: AI experiments but no measurable ROI

### Revenue Math

| Target   | Customers | ACV          | Notes                           |
| -------- | --------- | ------------ | ------------------------------- |
| CHF 1M   | 8-12      | CHF 80-150K  | Swiss wedge, year 1-2           |
| CHF 10M  | 70-100    | CHF 100K     | DACH expansion, year 3-4        |
| CHF 100M | 1,000     | CHF 100K ARR | Software-led, European, year 5+ |

### Positioning

"Swiss-governed autonomous development operations: a 24/7 engineering system that ships safely, is auditable by design, and optimized for ROI."

Three defensible claims:

1. **Governance-first autonomy**: humans remain the board; agents operate under measurable gates
2. **Continuous improvement with approved mutation**: agents propose workflow changes; promotion requires statistical validation
3. **Compliance-ready**: DPIA support, memory security, audit exports

## What We Already Have

- **Paperclip running** on localhost:3100 (embedded Postgres, hourly backups)
- **CEO agent bootstrapped** with SOUL.md, HEARTBEAT.md
- **Founding Engineer** working (DEFA-5 fetch timeout fix in progress)
- **SPRINT.md** written (62-line engineering execution protocol)
- **gstack** with 44 skills (plan-ceo-review, plan-eng-review, review, ship, qa, browse)
- **`/autoresearch` skill** (610 lines, WTF-likelihood accumulator, chain-on-completion)
- **Factory repo on GitHub** (ArshyaAI/continuous-factory) with v1.5 fixes
- **19 conventions promoted** to CLAUDE.md across 4 repos
- **15 Deep Research reports synthesized** (evaluator design, ADAS landscape, governance, Swiss market)
- **871-line ARCHITECTURE.md** (v2 vision, superseded by this document but has implementation details)
- **v1 data**: 68 rounds, ~475 items, ~85 PRs, optimal 10-12 rounds/repo
- **4 Codex-identified dispatcher bugs** fixed (HAS_PROGRAM leak, session collision, broad auto-merge, stale branches)
- **Key finding**: empty quadrant (high self-improvement + high governance = nobody there)

## Open Questions

1. **Explorer pool size**: Start with 2 or scale to 8-32? GPT Pro says 8-32; budget says start with 2 and add as cost per explorer drops.
2. **Benchmark task source**: Use SWE-bench-style tasks or real repo backlog? Probably both: SWE-bench for apples-to-apples, real backlog for ecological validity.
3. **Cross-repo genotypes**: Should one genotype govern all repos, or per-repo genotypes? Start with per-repo-type (typescript-backend, docs-only) and merge if they converge.
4. **CUPED implementation**: Do we have enough pre-experiment covariate data to use variance reduction? Not yet -- start collecting from M1; use in promotions from M5 onward.
5. **Equity split**: 50/50 only if both full-time. Otherwise 65/35 or 70/30. Decision pending.
6. **ConnectOS redundancy**: May overlap with Composio. Evaluate after NIKIN morning briefing ships.
7. **Hidden holdout rotation cadence**: 25% weekly is the default. May need to be faster if explorers learn the distribution.

## References

### Academic Papers

- ADAS: Hu et al. (2024). "Automated Design of Agentic Systems." arXiv:2408.08435
- AlphaEvolve: Novikov et al. (2025). arXiv:2505.22954
- Population Based Training: Jaderberg et al. (2017). arXiv:1711.09846
- Reward Hacking / Goodhart: Skalse et al. (2022). arXiv:2209.13085
- LLM Error Correlation: arXiv:2506.07962
- Lost in the Middle: Liu et al. (2024). ACL 2024.tacl-1.9
- A/B Testing Protocols: arXiv:2408.02821
- Darwin Godel Machine: self-modifying coding agents with empirical validation
- CUPED: Deng et al. (2013). Controlled-experiment Using Pre-Experiment Data
- Confidence Sequences: Howard et al. (2021). Time-uniform inference

### Industry References

- Microsoft Experimentation Guidance: STEDI criteria, metric taxonomy
- Netflix Kayenta: sequential testing, anytime-valid inference
- Google Search Ads: short-term vs long-term optimization tradeoffs
- PwC CEO Survey 2026: Swiss AI adoption below global average on realized ROI
- Carta 2025: solo founder share rose from 23.7% (2019) to 36.3% (H1 2025)

### System References

- Paperclip: github.com/paperclip-company/paperclip (AI company orchestration)
- gstack: github.com/garrytan/gstack (role-based skill workflows)
- Factory v1 ARCHITECTURE.md: ~/Desktop/AI.nosync/continuous-factory/ARCHITECTURE.md
- CEO Plan: ~/.gstack/projects/ArshyaAI-prompt-os/ceo-plans/2026-03-20-evolution-engine.md
- GPT Pro Critique: ~/Desktop/AI.nosync/continuous-factory/docs/2026-03-20-gpt-pro-architecture-critique.md
