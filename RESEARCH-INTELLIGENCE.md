# Research Intelligence — Papers Read for Design Doc

Generated: 2026-03-31

## Paper 1: ARTEMIS — Automated Optimization of LLM-based Agents

**Source:** arxiv.org/abs/2512.09108
**Relevance:** DIRECT COMPETITOR CONCEPT. Does for generic LLM agents what we want to do for Claude Code.

### Key Architecture

- Black-box evolutionary optimization. No access to agent internals needed.
- Configuration space: **C = (P, T, M, Θ)** — Prompts, Tools, Model assignments, Parameters
- Two modes: Local (independent GA per component) and Global (Bayesian optimization for interactions)
- Hierarchical evaluation: cheap LLM-based scoring before expensive benchmark runs

### Semantic Genetic Operators

- LLM-ensemble-driven mutations (not random string perturbation)
- Mutations preserve semantic validity while exploring variations
- Crossover merges successful elements from different candidates
- **Key insight: "Non-trivial component interactions mean optimizing prompts in isolation results in lower performance"**

### Results

| Agent                         | Improvement        | p-value |
| ----------------------------- | ------------------ | ------- |
| ALE (competitive programming) | +13.6% accuracy    | 0.10    |
| Mini-SWE (code optimization)  | +10.1%             | <0.005  |
| CrewAI (cost)                 | -36.9% token usage | <10⁻⁶   |
| MathTales (math)              | +22% accuracy      | <0.001  |

### What Produces Biggest Improvements

1. **Structured decomposition** outperformed generic CoT (ALE: "decompose into subcomponents" beat "consider edge cases")
2. **Explicit verification steps** (MathTales: "verify each arithmetic operation before proceeding")
3. **Bottleneck-driven optimization** over general improvements (Mini-SWE)
4. **Pattern: mutations addressing KNOWN FAILURE PATTERNS produce the largest gains**

### Limitations

- High variance: ALE improvement was 13.6% but non-significant (p=0.10) due to evaluation variance
- **Overfitting to benchmarks: "establishing robust validation setups that avoid overfitting remains challenging"**
- Ceiling effects: well-tuned agents show limited improvement potential
- Cost: ALE required 671.7 hours total ($24-60 per eval run)

### Critical Insight for Our Product

"Practitioners should first assess baseline configuration quality; agents with vague or generic prompts are BETTER CANDIDATES than carefully tuned systems."
→ This means: our audit should identify users with unoptimized setups first. They'll see the biggest gains.

---

## Paper 2: Hyperagents — Meta AI (March 2026)

**Source:** arxiv.org/abs/2603.19461
**Relevance:** The theoretical ceiling for self-improvement. Not directly implementable but shapes our vision.

### Architecture

- Task agent + meta agent in ONE editable program
- Meta agent can rewrite its own modification procedures (self-referential)
- Extends Darwin Gödel Machine by removing domain-specific assumptions
- **Key: meta-level improvements transfer across domains and accumulate across runs**

### Darwin Gödel Machine Results (predecessor)

- SWE-bench: 20.0% → 50.0% (+150% improvement)
- Polyglot: 14.2% → 30.7% (+116%)
- Automatically developed: better code editing tools, long-context management, peer-review mechanisms
- Maintained archive of diverse, high-quality agents (tree structure)

### Relevance to Us

- The "archive" concept maps to our evo.db lineage tracking
- "Meta-level improvements transfer across domains" validates cross-project learning
- But this is academic research, not a product. The gap: nobody has productized this.

---

## Paper 3: Comprehensive Survey of Self-Evolving AI Agents

**Source:** arxiv.org/abs/2507.21046v4 (27 authors, January 2026)
**Relevance:** THE taxonomy that structures our product design.

### What-When-How-Where Framework

**WHAT evolves (4 pillars):**

1. **Models** — policy evolution via self-generated supervision
2. **Context** — memory evolution (ADD/UPDATE/DELETE) + prompt optimization
3. **Tools** — autonomous discovery, mastery, management
4. **Architecture** — single-agent optimization + multi-agent workflow topology

**WHEN evolution triggers:**

- Intra-test-time (within a task) vs Inter-test-time (between tasks)
- In-context learning, supervised fine-tuning, reinforcement learning

**HOW evolution happens:**

- Reward-based (textual feedback, internal rewards, external rewards)
- Imitation and demonstration learning
- Population-based and evolutionary methods

**WHERE evolution occurs:**

- General domain vs specialized (coding, GUI, financial, medical)

### Key Evaluation Dimensions

1. **Adaptivity** — performance gain per task, convergence speed
2. **Retention** — knowledge preservation, catastrophic forgetting
3. **Generalization** — transfer to OOD tasks, compositional ability
4. **Efficiency** — computational cost, sample efficiency
5. **Safety** — alignment preservation, constraint satisfaction

### Open Problems

- Scalable architecture design beyond single-task specialization
- Cross-domain adaptation (transferring evolved skills)
- Continual learning without catastrophic forgetting
- Emergent risks in self-evolving systems
- Lack of standardized evaluation protocols

### Most Impactful Papers Cited

- Voyager (open-ended embodied agent)
- Reflexion (verbal RL via self-reflection)
- Self-Refine (iterative refinement without retraining)
- DSPy (declarative self-improving pipelines)
- TextGrad (automatic differentiation via text feedback)
- PromptBreeder (self-referential prompt evolution)

### Critical Insight: Parameter-Free vs Parameter-Driven

- **Parameter-free** (prompt optimization, memory, tool selection) is faster but brittle
- **Parameter-driven** (fine-tuning, RL) is slower but persistent
- **Our product operates in parameter-free space** (we change prompts, configs, skills — not model weights)

---

## Paper 4: Self-Evolving AI Agents Survey (15 authors, August 2025)

**Source:** arxiv.org/abs/2508.07407
**Relevance:** Unified framework. Bridges foundation models with lifelong learning.

### Inclusion Criteria for "Self-Evolving"

1. Experience-dependent (updates driven by agent trajectories/feedback)
2. Persistent policy-changing (durable effects, not transient)
3. Autonomous exploration (self-initiated learning)

### Key Framework

- System Inputs → Agent System → Environment → Optimisers (closed loop)
- Domain-specific strategies: Biomedicine, Programming, Finance

### Spectrum of Evolution

- Proto-evolution (iterative bootstrapping, early stage)
- Strong self-evolution (fully autonomous, aspirational)
- "Fully autonomous self-evolution without human intervention represents an ASPIRATIONAL GOAL"

---

## Synthesis: What This Means for Our Product

### From ARTEMIS:

- **Configuration space C = (P, T, M, Θ)** maps directly to our genotype:
  P = prompt_policy, T = tool_policy, M = model_routing, Θ = cadence/budget/thresholds
- Semantic mutations (LLM-driven) > random mutations (our current operators are random)
- **Agents with vague/generic prompts benefit most** → target unoptimized users first
- Multi-objective optimization is needed (accuracy + cost, not just one metric)
- **Component interactions matter** — optimize holistically, not per-dimension

### From Hyperagents/DGM:

- Archive-based evolution with lineage tracking (we have this in evo.db)
- SWE-bench 20%→50% proves dramatic improvements are possible for coding agents
- Meta-level improvements (better tools, better evaluation) transfer across domains

### From the Surveys:

- Our product operates in the "parameter-free, context-level" evolution space
- The What-When-How-Where framework structures our feature roadmap:
  - WHAT: prompts + tools + memory + model routing (all four pillars)
  - WHEN: inter-session (between coding sessions)
  - HOW: population-based evolutionary + LLM-based semantic mutation
  - WHERE: coding domain (Claude Code specifically)
- Five evaluation dimensions should map to our scoring:
  Adaptivity ≈ Throughput, Retention ≈ Convention Adherence,
  Generalization ≈ cross-project transfer, Efficiency ≈ Cost,
  Safety ≈ Safety gate

### The Product Gap (confirmed by all papers):

- ARTEMIS is academic (generic agents, not Claude Code specific)
- Hyperagents is theoretical (no product)
- Surveys identify the need but no tool fills it
- Nobody has built a PRODUCTIZED, CLAUDE-CODE-SPECIFIC setup optimizer
  with evolutionary improvement and community benchmarking
- The Langfuse case study proves the concept works for skills
- Karpathy's autoresearch proves the loop works for code

### What Our MVP Must Do (from first principles + papers):

1. **AUDIT** — analyze C = (P, T, M, Θ) against research-backed patterns
2. **SCORE** — multi-dimensional evaluation (ARTEMIS-style fitness function)
3. **FIX** — semantic mutations (LLM-driven, not random) targeting known failure patterns
4. **PROVE** — before/after validation on real tasks (autoresearch loop)
5. **SHARE** — community benchmark so improvements spread (network effect)
