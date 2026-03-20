# Governance Wrappers for 24/7 Self-Improving Coding Agents in 2025–2026

## How ADAS-style systems are structured

The current “ADAS frontier” can be read as formalizing an *outer-loop* optimization problem over *inner-loop* agentic execution. The ADAS framing defines three core components: (1) a **search space** of agentic systems (e.g., prompt graphs, tool-using workflows, or agents defined in code), (2) a **search algorithm** that proposes new candidates, and (3) an **evaluation function** that scores candidates against objectives. citeturn4view3

A key move in the 2025 wave is to represent agent systems **in code**, so the outer loop can search over a far richer design space than “prompt-only” tuning. ADAS argues that because programming languages are Turing-complete, code-defined agents supply a theoretically unbounded search space that can include prompts, tool-use patterns, workflow structure, and other building blocks—then uses foundation models as “meta agents” to program new agents in that space. citeturn4view3

Within this frame, a practical fault line emerges: **search efficiency** (how you explore the space without exploding compute) and **evaluation realism** (how you score candidates so improvements transfer). AFLOW (AFlow) explicitly positions itself as addressing ADAS’s inefficiency in workflow discovery by moving from a linear/heuristic exploration style to a **Monte Carlo Tree Search (MCTS)-style** workflow search in code space. citeturn4view2

The implication for a “productized governance wrapper” is straightforward: your differentiator is less about inventing the outer-loop abstraction (ADAS already did that) and more about making the outer loop **safe, budget-aware, and continuously operable** under production constraints—akin to turning AutoML into “AutoML + corporate governance + DevOps.”

## Self-improving agent architectures in 2025–2026

### What “self-improving” means in practice

Across the systems you cited, “self-improvement” usually means: **generate variants → evaluate automatically → select survivors → retain artifacts** (an archive, database, or experience log), then repeat. What differs is the *unit of evolution* (prompt, workflow graph, agent codebase, or algorithmic program), the *selection mechanism* (best-of-n, bandits, MCTS backprop, archive-based novelty/quality), and the *evaluation signal* (unit tests, benchmark scores, verifiers, cost/latency, or human review).

### Comparative map: mutation, selection, evaluation

The table below summarizes how the most central 2025–2026 self-improving systems instantiate mutation/selection/evaluation (interpreting “mutation” broadly as “proposal operator”).

| System (research focus) | Mutation / proposal | Selection / retention | Evaluation signal (what is “fitness”) |
|---|---|---|---|
| ADAS (Meta Agent Search) | Meta-agent generates new agentic systems **in code**, expanding building blocks beyond prompts. citeturn4view3 | Selects designs that improve objective; retains discovered designs (archive / transfer). citeturn4view3 | Task performance on target objectives (e.g., accuracy). citeturn4view3 |
| AFlow (AFLOW) | LLM proposes workflow expansions; search is formulated over code-represented nodes/edges; expansion + execution cycles resemble MCTS. citeturn4view2 | Variant of MCTS with “experience backpropagation” and selection policies to balance exploration/exploitation. citeturn4view2 | Executed workflow performance on target tasks/benchmarks; repeat until convergence/iteration limit. citeturn4view2 |
| Darwin Gödel Machine | Samples an agent from an **archive**, then uses a foundation model to generate a new version of its **own code**, building a growing tree of agents. citeturn23view0 | Archive-based open-ended exploration (diverse branches), retaining high-quality variants; parallel path exploration. citeturn23view0 | Empirical validation on coding benchmarks; reports improvement on SWE-bench and Polyglot, with sandboxing + human oversight. citeturn23view0 |
| AlphaEvolve | LLM ensemble proposes programs; paired with automated evaluators + an evolutionary programs database. citeturn12view0 | Evolutionary database determines what to sample and feed back into prompts, iteratively improving programs. citeturn12view0 | Automated evaluators that “verify, run and score” programs; suited to domains with objective metrics/verifiers. citeturn12view0 |
| Autoresearch loop | Agent iteratively edits training code, runs fixed-budget experiments, keeps/discards changes based on metric deltas; instructions live in a program file. citeturn9view4turn9view3 | Hill-climb-ish retention (“keep if improved”), logged experiments; designed as a repeatable loop. citeturn9view4turn9view3 | A fast, repeatable proxy metric (e.g., val_bpb over a fixed 5-minute training budget) enabling many iterations. citeturn9view4turn9view3 |

Two observations matter for your “24/7 company” design:

First, the systems with the strongest self-improvement claims lean heavily on **objective, automatable evaluation** (unit tests, verifiers, benchmark harnesses, time-bounded metrics). AlphaEvolve emphasizes the pairing of generative proposal with automated evaluators as the mechanism that makes evolution reliable. citeturn12view0 Autoresearch makes the same point implicitly by restricting itself to an evaluation loop that can run frequently under a fixed budget. citeturn9view4turn9view3

Second, the “self-improving coding agents” approach (Darwin Gödel Machine) is architecturally closest to your intent: it explicitly self-modifies its own tooling and behaviors and reports large benchmark jumps (e.g., SWE-bench 20.0% → 50.0%), while also calling out safety precautions like sandboxing and human oversight. citeturn23view0

### “Coding agents” as evaluation substrates, not just products

Systems like SWE-agent, Agentless, and AutoCodeRover matter here less as “self-improving architectures” and more as **reference implementations of the inner loop**—i.e., how a coding agent navigates repositories, edits code, runs tests, and produces patches.

SWE-agent’s core contribution is the **agent-computer interface (ACI)** as an abstraction layer between the model and the computer environment, with strong benchmark results on SWE-bench and HumanEvalFix in its original release. citeturn1search29

Agentless is a deliberately simplified pipeline (localization → repair → patch validation) that disallows autonomous tool use and complex action selection, yet achieved strong open-source results on SWE-bench Lite (32% with low cost) and uses reproduction + regression tests to select patches. citeturn24view0turn24view1

AutoCodeRover emphasizes program-structure-aware search (AST-aware retrieval) and (when available) test-based localization to sharpen context, with the project listing substantial verified benchmark performance and low per-task costs in published updates. citeturn25view0turn25view1

For an always-on organization, these are best treated as **baseline worker archetypes** (interactive ACI agent; workflow/agentless fixer; structure-aware repair agent) that your outer loop can swap, specialize, or evolve.

## Multi-agent orchestration platforms for always-on coding work

A distinct 2025–2026 shift is that “multi-agent orchestration” is no longer mostly a research abstraction. Several systems now describe production-grade patterns: parallel sandboxes, ticket-driven delegation, continuous webhook-triggered work, and explicit quality gates.

### Production-oriented orchestration patterns

**Paperclip** positions itself as a “control plane for AI-agent companies,” centered on org charts, budgets, heartbeats, a ticket system, and governance (“you’re the board”). Its public repo emphasizes 24/7 operation (“agents running autonomously 24/7”) with cost control (monthly budgets per agent) and auditability. citeturn9view1turn9view2

**Devin** (from entity["company","Cognition AI","ai agent startup"]) pitches a workflow that looks like enterprise engineering: tickets, plans, tests, PRs, and integrations with tools like Slack/Linear. The public site also suggests explicit “knowledge approval” mechanics (“Approved new knowledge” / “Rejected new knowledge”), implying a governance gate between agent-learned “tribal knowledge” and durable system memory. citeturn2search0turn7view0

**Cursor** (entity["company","Cursor","ai code editor"]) is unusually informative about real long-horizon scaling failures. In its long-running agent program, Cursor describes a custom harness for long-horizon completion and notes that “long-running agents” enable delegating tasks for hours/days, while also emphasizing the problem of safely deploying large volumes of generated code. citeturn14view2turn14view4 In a separate post, Cursor describes multi-agent coordination failures (locks becoming bottlenecks; brittle coordination; risk-averse behavior without hierarchy) and reports moving toward role separation (planners/workers/judges), with large-scale experiments (hundreds of agents; millions of lines; trillions of tokens). citeturn15view1turn15view0

**GitHub Copilot Workspace** (within entity["company","GitHub","code hosting platform"], owned by entity["company","Microsoft","technology company"]) frames orchestration as a task-centric “idea → plan → build/test/run” environment with editable plans and integrated execution. citeturn20view1 GitHub’s Universe 2024 press release adds a rare quantitative datapoint: tens of thousands of users and thousands of merged PRs attributed to Workspace usage, plus explicit “build and repair agent” and command-running repair loops in newer iterations. citeturn20view0

**Codex** (from entity["company","OpenAI","ai lab"]) is explicitly a multi-agent *cloud* system: “many tasks in parallel,” each in an isolated cloud sandbox preloaded with the repo, with the ability to run tests/linters/type checkers and return evidence via logs/test outputs. Codex also highlights the role of repo-level instruction files (AGENTS.md) for reliability. citeturn19view0 The Codex desktop app formalizes this as “a command center for agents,” with separate threads, worktrees, and collaboration over long-running tasks; it further describes security defaults and permission gating (e.g., asking for permission for elevated actions like network access). citeturn19view1 Reuters reports that Codex had crossed 2 million weekly active users as of March 19, 2026, and that OpenAI planned to acquire entity["company","Astral","python tools company"] to strengthen coding tooling. citeturn19view2

**Factory** (entity["company","Factory.ai","ai coding agent platform"]) pushes an “agent-native software development” narrative with “Droids,” and provides public signals of long-running work: Missions are described as multi-hour to multi-day workloads, with a reported longest run of 16 days and extensive use of execution-heavy validation (builds, test suites, linting, typechecking, browsing the app). citeturn18view0 Factory also describes a closed-loop self-improvement system (“Signals”) where friction patterns trigger ticket filing and self-assigned fixes, but still includes a human approval step. citeturn18view2 An independent Stack Overflow interview with a Factory leader emphasizes “harness engineering,” context management for multi-hour sessions, and the need to leverage many validation signals (compiles, lint, tests, docs) as autonomy substitutes for humans. citeturn18view1

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Paperclip AI dashboard screenshot orchestration zero-human company","OpenAI Codex app multi-agent command center screenshot","Devin AI software engineer dashboard screenshot","Cursor long-running agents interface screenshot"],"num_per_query":1}

### Orchestration comparison: assignment, communication, quality gates

The most salient differences across these platforms are not “how smart the model is,” but how they structure the workflow around it:

Task assignment ranges from **org-chart delegation and heartbeats** (Paperclip) citeturn9view1turn9view2 to **issue/ticket-centric flows** (Copilot Workspace from GitHub issues; Devin from Linear/Slack-style assignments) citeturn20view1turn7view0 to **parallel task queues** in isolated sandboxes (Codex). citeturn19view0

Agent communication ranges from explicit **hierarchies and coordination rules** (Cursor’s planners/workers/judges) citeturn15view1turn15view0 to tool-mediated traceability (Codex “threads” and evidence logs) citeturn19view0turn19view1 and ticketing/audit logs (Paperclip ticket system “every conversation traced; every decision explained”). citeturn9view2

Quality gates increasingly converge on a “software factory” stack: tests, linters, type checks, reproducible environments, PR review, and staged deployments. Codex explicitly calls out running test harnesses/linters/type checkers and returning verifiable logs. citeturn19view0 Cursor’s automation architecture describes agents opening PRs only “once tests pass” and then using a canary deployment pipeline as a final safety gate. citeturn14view1 Factory’s framing similarly treats “validation signals” as a core substrate of autonomy. citeturn18view1turn18view0

For your design goal—“a single human as board chair while agents run 24/7”—the governance gap is that most products still assume the human is a developer/PM; few turn oversight into a formal **board-control interface** with policy, risk, and capital allocation semantics. Paperclip comes closest in language (“You’re the board. Approve hires, override strategy, pause or terminate any agent”), but the broader ecosystem suggests what “board chair” must concretely mean: budget setting, permission gating, and approval checkpoints integrated into CI/CD and tooling. citeturn9view2turn19view1turn18view2turn14view1

## Population-based and quality-diversity search over agent configurations

Your third question—whether anyone is applying PBT or quality-diversity methods to optimize prompts, tool configs, or workflows—has a 2025–2026 answer: **yes, increasingly**, but results are fragmented across “prompt optimization,” “workflow search,” and “agent configuration tuning.”

### Prompt evolution and QD exploration

Promptbreeder is a canonical “prompt evolution” system: it mutates a population of task prompts and evaluates them on a training set, with the distinctive twist that it also evolves “mutation prompts” that control how prompts mutate (self-referential improvement). citeturn3search1turn3search7

Quality-diversity methods are now explicitly applied to prompts. “Diverse Prompts” uses a context-free grammar plus MAP-Elites to explore prompt space for both quality and structural diversity, reporting evaluation across multiple tasks and models. citeturn3search0

### Workflow and multi-agent topology optimization

AFLOW can be read as a workflow-level search algorithm (MCTS-like) that treats workflow structure and prompt parameters as searchable objects in code. citeturn4view2

EvoAgentX explicitly tries to operationalize this into an integrated “evolution layer” for multi-agent systems, claiming support for prompt, tool configuration, and workflow topology optimization via TextGrad, AFlow, and MIPRO, and reporting measurable gains on code generation (MBPP pass@1 +10%) and other benchmarks. citeturn22view0

### Agent configuration optimization as a productizable primitive

A notable 2025–2026 step is moving from “optimize a prompt” to “optimize an agent pipeline configuration” as a black-box search problem. The Artemis platform describes “semantically-aware genetic operators” that jointly optimize prompts, tool descriptions, and parameters; it reports improvements across multiple agent systems, including SWE-oriented setups and cost reductions (e.g., token reductions for a reasoning agent). citeturn27view0

Population-based training (PBT) shows up in agent settings in a different way: as **curation/propagation of successful trajectories**. A NeurIPS 2025 poster on self-generated in-context examples reports database-level curation via PBT to propagate high-performing example collections, pushing success on ALFWorld to 93% and showing large gains from accumulating and curating successful trajectories. citeturn4view0

### What’s missing for “24/7 autonomous coding companies”

Most of the above work optimizes on benchmark proxies (BigBench-style tasks, MBPP, ALFWorld), not on a production codebase’s long-term fitness. Your opportunity is to treat “agent configuration evolution” as a first-class continuous process, but with a richer fitness function: correctness, regression rate, security findings, latency, cost budgets, PR acceptance, and human interruption frequency—precisely the kinds of signals Factory and Cursor emphasize, but not yet standardized into an “agent configuration PBT” discipline. citeturn18view1turn18view0turn15view1turn14view2

## Memory architectures for long-running learning agents

The memory problem for 24/7 systems is not “how to store more,” but how to store *without degrading behavior*—often described as context pollution or context irrelevance. Recent sources converge on three principles: **compression**, **structured externalization**, and **role separation**.

### Context pollution management as a first-class engineering discipline

entity["company","Anthropic","ai lab"] explicitly argues that long-horizon tasks require techniques beyond “just using bigger context windows,” because context pollution and relevance constraints persist. They recommend **compaction** (summarize and restart), **structured note-taking**, and **multi-agent architectures** to maintain coherence over extended time horizons; they describe implementing compaction in Claude Code by summarizing message history while preserving key technical decisions and keeping recently accessed files. citeturn6view1

A recent arXiv paper on building terminal coding agents reports similar empirical lessons: early versions that gave subagents the same tools as the main agent created context pollution and role conflicts; restricting tool sets per role and adding explicit stop conditions reduced looping and improved focus. citeturn6view0

### Memory systems: from RAG to mutable, typed, evolving memory

MemGPT is a widely cited “virtual memory management” framing: an agent manages multiple memory tiers to overcome fixed context windows, borrowing operating-system concepts. citeturn5search1

2025–2026 papers increasingly argue that vanilla RAG is structurally limited because it treats memory as static and read-only. “Continuum Memory Architectures” defines a class of systems with persistent storage, selective retention, associative routing, temporal chaining, and consolidation into higher-order abstractions—explicitly contrasting this with stateless retrieval. citeturn6view3

A-MEM (NeurIPS 2025) pushes further toward “agentic memory”: rather than fixed schemas and predefined memory operations, it proposes dynamic memory structuring inspired by Zettelkasten, where new memories trigger link generation and “memory evolution” (updating representations of existing memories). citeturn6view4

At the model-architecture layer, entity["company","Google DeepMind","ai research lab"] describes Titans + MIRAS as a direction for handling massive contexts with mechanisms that update “core memory” as data streams in, positioning it as real-time adaptation rather than purely static compression. citeturn6view2

### Design implications for 24/7 “company memory”

For your governance wrapper, the most relevant synthesis is to treat memory as **typed and permissioned**, not as a flat vector store. Production systems hint at this: Devin’s site suggests explicit accept/reject gating of “new knowledge,” which is essentially a human approval layer on memory writes. citeturn7view0turn2search0

A practical architecture that follows from the literature above is:

* A **workstream memory** (per-ticket/per-branch) that can be aggressively compacted and eventually discarded.
* A **procedural memory** (skills, runbooks, checklists) that is curated and versioned (similar to how Codex uses AGENTS.md as durable repo guidance). citeturn19view0
* A **strategic memory** (company objectives, risk posture, architectural decisions) that is typed, provenance-tracked, and requires governance approvals for mutation—aligned with Anthropic’s structured note-taking and with A-MEM’s typed linking, but with explicit board-chair controls. citeturn6view1turn6view4

The “context pollution” threat is then reframed as an access-control and retrieval-ranking problem: who (which agent role) can read/write which memory types, under what budgets, and with what decay/summarization schedules.

## Continuous autonomous coding and one-person AI companies

### Who is doing “continuous autonomous coding” beyond demos

The strongest publicly documented “continuous autonomous coding” evidence in early 2026 comes from Cursor’s long-running agent program. Cursor reports running coding agents autonomously “for weeks,” aimed at projects that typically take months for human teams, and describes concrete coordination failures and mitigations (coordination locks bottlenecking to 2–3 effective agents; brittleness; risk-averse stagnation without hierarchy; adopting planners/workers/judges). citeturn15view1turn15view0 They also describe a browser-from-scratch experiment where agents ran close to a week and generated a very large codebase, and they emphasize that coordination remains hard and that “periodic fresh starts” are still needed to combat drift/tunnel vision. citeturn15view1turn15view0

Cursor’s security automations provide a second “production pattern” signal: the security team describes using automations to build a fleet of agents that continuously identify and repair vulnerabilities, with quantitative claims (PR velocity increased 5×; security agents reviewing thousands of PRs weekly and catching hundreds of vulnerabilities), plus a quality-gated flow (tests, PRs, canary deployment). citeturn14view1

Factory’s Missions framing is another explicit “long-running” pattern: missions as persistent, multi-hour to multi-day workloads where much of runtime is spent on execution (builds, tests, typechecks), not token generation. citeturn18view0 Factory’s Signals post describes a closed-loop agent self-improvement mechanism triggered by session-level friction analysis, but still includes human approval checkpoints. citeturn18view2

OpenAI’s Codex also supports the “continuous” pattern technically: multi-task parallel work in isolated sandboxes with verifiable evidence logs, and a desktop app designed for supervising coordinated agents and long-running tasks. citeturn19view0turn19view1

### What fails and what works

Across these sources, failure modes recur:

Coordination collapses under naive concurrency. Cursor’s first multi-agent attempt (equal agents + shared coordination + locks) degraded throughput and became brittle; removing hierarchy induced risk-avoidant churning. citeturn15view1turn15view0

Drift and context churn are leading indicators of user/agent frustration. Factory explicitly calls “context churn” (repeatedly adding/removing the same file from context) a strong predictor of eventual friction. citeturn18view2 Anthropic similarly argues that long-horizon tasks require compaction and structured note-taking specifically to counter context-window pathologies. citeturn6view1

Tooling and validation signals matter as much as prompting. Factory emphasizes compiles, lint, tests, docs, and “hundreds of signals” as the substrate of autonomy. citeturn18view1 Codex likewise centers “run commands including test harnesses, linters, and type checkers,” returning logs and test outputs as evidence. citeturn19view0 Cursor’s security automations make the same point operationally (only opening PRs after tests pass; canary gate). citeturn14view1

What seems to work is also consistent:

Role specialization and constrained tool access. Cursor’s planners/workers/judges pattern and the terminal-agent paper’s tool restriction per subagent both suggest that role clarity prevents many long-horizon failure cascades. citeturn15view1turn6view0

Human role shifts from “coder” to “governor of the pipeline.” Multiple systems explicitly preserve human approvals at leverage points: Codex positions agents as producing changes you review and then merge, and describes permission gating for elevated actions. citeturn19view0turn19view1 Factory’s loop includes “human approval step.” citeturn18view2 Cursor’s security flow routes findings to security teams and stages merges via deployment gates. citeturn14view1

### Evidence for one-person AI companies

The “one-person AI company” is simultaneously (a) partially real as “AI-augmented solo founders,” and (b) still largely speculative as “fully autonomous companies with real revenue and no humans.”

On the “cultural adoption” side, there is clear evidence that solo operators are assembling agent stacks. entity["people","Garry Tan","y combinator ceo"] released gstack as a skill-based workflow pack for Claude Code, with the repo describing a suite of role-based tools (CEO/engineering review/shipping/QA/browsing) and the surrounding news cycle documenting rapid uptake. citeturn26view0turn26view2 Paperclip’s public repository and website are explicitly oriented at “zero-human companies,” with governance and budgets as core primitives rather than incidental features. citeturn9view1turn9view2

The Paperclip “2.7M views” datapoint appears to refer to the associated article/launch visibility; the author entity["people","Corey Ganim","paperclip article author"] posted that his Paperclip article hit 2.7 million views. citeturn13search1

On the “practical solo-founder operation” side, a Business Insider report describes a solo founder using a “council” of 15 AI agents, claiming ~20 hours/week saved and emphasizing role separation and cross-checking to reduce hallucinations. citeturn13search11 This is still “human-run with agent assistance,” but it is evidence that the managerial posture (governance, delegation, review) is becoming the human’s primary contribution.

On the “revenue generated by agent-run businesses” question, public evidence is noisier: revenue claims in the ecosystem are often self-reported (e.g., newsletters, Medium case studies, LinkedIn posts) and rarely independently audited. citeturn13search12turn13search7turn13search33 For product design, this matters: a governance wrapper should treat “self-reported success” as anecdotal, and instead optimize for measurable internal outcomes (cycle time, escape defects, cost per merged PR, incident rate, security findings) that high-signal production platforms already instrument. citeturn14view1turn20view0turn19view0turn18view0

## Landscape map: where your system fits, what to borrow, and what to invent

### Landscape map

A useful way to place your proposed system (Paperclip + gstack + autoresearch loop + multiple coding agents running continuously under one human board chair) is across two axes:

*Axis A: What is being optimized?*  
From static execution → workflow tuning → self-modifying agent code → algorithm discovery.

*Axis B: How objective is evaluation?*  
From subjective/human taste → CI/tests/verifiers → benchmark harnesses and production metrics.

A third dimension—*governance maturity*—separates demos from productizable operations.

**Research frontier (outer-loop search, objective eval):** AlphaEvolve (program evolution with automated evaluators and production deployment) citeturn12view0; Darwin Gödel Machine (self-modifying coding agents with empirical validation and safety precautions) citeturn23view0; AFLOW and ADAS (workflow search in code space) citeturn4view2turn4view3; autoresearch (fast experimental loop) created by entity["people","Andrej Karpathy","ai researcher"]. citeturn9view4turn9view3

**Production platforms (parallel agents + sandboxes + gates):** Codex and the Codex app citeturn19view0turn19view1; Cursor’s long-running agents and automations citeturn15view1turn14view1turn14view2; Factory Missions and Signals citeturn18view0turn18view2; GitHub Copilot Workspace and agent mode. citeturn20view1turn20view2turn20view0

**Open platforms for building and scaling agents:** OpenHands (fka OpenDevin) describes a sandboxed runtime, multi-agent coordination, and evaluation benchmark integration, and is ICLR 2025 accepted. citeturn17view0

**Governance primitives appearing in production, but not yet “productized governance”:** Paperclip’s “you’re the board” framing and budgets citeturn9view2turn9view1; Codex’s permission gating and sandboxing defaults citeturn19view1turn19view0; Cursor’s canary deployment gate and security workflows citeturn14view1; Factory’s human approval step in a recursive improvement loop. citeturn18view2

**Where your system sits:** your concept is an explicit attempt to occupy the intersection of (1) production orchestration, (2) ADAS-style outer-loop improvement, and (3) formal governance (Board Chair) as a first-class product surface. In the current landscape, these are mostly treated separately (research papers vs coding-agent products vs governance/autonomy rhetoric). Your “governance wrapper” can be the connective tissue.

### What you can borrow vs. what you likely need to invent

**Borrow (high leverage, already demonstrated):**

A code-sandbox + evidence pattern: isolated environments per task, with verifiable logs/tests/outputs and worktree-style parallelism. citeturn19view0turn19view1

A “validation-signal first” philosophy: push autonomy by increasing objective signals (tests, lint, type checks, security scanners) rather than by asking for more model intelligence. citeturn18view1turn14view1turn19view0

Coordination role separation: planners/workers/judges (or planner/executor/verifier) beats flat multi-agent swarms with shared locks. citeturn15view1turn15view0

Long-horizon context engineering: compaction, structured note-taking, and explicit multi-agent decomposition to manage context pollution. citeturn6view1turn6view0

Outer-loop evolution of agent/tooling: DGM-style archive + empirical validation for coding agents; AFLOW/ADAS-style workflow search; Artemis-style configuration evolution as a productizable primitive. citeturn23view0turn4view2turn4view3turn27view0

**Invent (where the gap is most obvious):**

A governance model that treats an always-on agent org like a company: capital allocation (budgets), risk controls (permissions, blast-radius limits), escalation, auditability, and kill-switches—implemented as a coherent *operating system* for oversight that is not tied to any single agent vendor. (Pieces exist—Paperclip budgets; Codex gating; Cursor canary; Factory human approvals—but not as a unified “board” product.) citeturn9view2turn19view1turn14view1turn18view2

Population-based optimization over **organizational workflows**, not just prompts: applying QD/PBT ideas to evolve role definitions, tool access policies, and quality-gate structures under real production metrics (merge rate, rollback rate, incidents, cost per shipped feature). The enabling pieces exist in Promptbreeder/MAP-Elites prompt work and in agent optimization platforms, but the “agent company” variant remains open. citeturn3search1turn3search0turn27view0turn4view0

Memory governance: typed, permissioned, decay-aware memory where “write” is a governed act (approve/reject, provenance, sensitivity), rather than passive accumulation. Devin’s “approved/rejected knowledge” hint is rare; codifying it as a general design pattern would be novel. citeturn7view0turn6view3turn6view4

### The most relevant papers/systems to study before building

Darwin Gödel Machine, because it is the closest end-to-end demonstration of *self-modifying coding agents* evolving their own tools and behaviors under benchmark validation, with explicit safety precautions. citeturn23view0

AFLOW (AFlow) and ADAS, because they provide the clearest formalization of workflow search in code space and the algorithmic scaffolding to evolve multi-step agentic systems rather than just prompts. citeturn4view2turn4view3

Codex + Codex app, because they represent the most mature “multi-agent, sandboxed, evidence-producing” production pattern, and explicitly frame the human challenge as directing and supervising multiple long-running agents. citeturn19view0turn19view1turn19view2

Anthropic’s context engineering guidance, because long-horizon coherence and context pollution are the practical ceiling for 24/7 systems, and compaction + structured note-taking + multi-agent decomposition are repeatedly validated in practice. citeturn6view1

Artemis (and related “agent optimization platforms”), because it directly targets the “optimize prompts + tools + parameters jointly” problem with evolutionary operators, which is a close match to continuously optimizing agent configurations inside your governance wrapper. citeturn27view0