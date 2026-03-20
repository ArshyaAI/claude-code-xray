# Governance Wrappers for Self-Improving Agentic Coding Systems (2025–2026 Landscape)

## Framing the frontier you’re wrapping

The “ADAS frontier” can be thought of as a specific pivot in agent research: from *hand-designed scaffolds* (prompt + tool loop + a few heuristics) to *search-designed systems* where (a) the agent/workflow is represented as code, (b) a meta-process proposes changes, and (c) an evaluation function decides what survives. The ADAS formulation makes this explicit via three primitives—**search space**, **search algorithm**, and **evaluation function**—and demonstrates a “Meta Agent Search” pattern where a meta-agent writes new agent code, evaluates it, and adds it to an archive to inform further exploration. citeturn0search0turn0search4turn0search8

In 2025–2026, the research trendline is that *evaluation and infrastructure* are becoming as important as the base model: more papers explicitly treat the “agent” as **(model + scaffold/harness + tools + environment)**, and production systems are converging on **sandboxed, parallel, PR-based** workflows with enforceable quality gates. citeturn11search30turn10search1turn3search5

Your “productized governance wrapper” (Paperclip + gstack + autoresearch) is well-positioned because it targets the hardest unsolved layer: **turning open-ended self-improvement into something operationally safe, auditable, and cost-bounded**—while still benefiting from the fast-moving design-search frontier. Paperclip explicitly frames itself as “company” orchestration with budgets/governance; gstack demonstrates role-separated “skills” that encode quality gates as workflows; and autoresearch popularized an automated experiment loop (propose → run → score → keep/revert) that generalizes beyond ML training. citeturn2search0turn9search21turn8search2turn8search0

## Self-improving agent architectures and how they “evolve” in practice

This section compares the named systems as *evolutionary / search processes*, focusing on **mutation**, **selection**, and **evaluation**. The important pattern across the state-of-the-art is that “mutation” is rarely a literal genetic operator; it’s usually **LLM-authored code edits** applied to either (a) the *solution code* (e.g., algorithm discovery) or (b) the *agent/scaffold code* (e.g., self-improving coding agents). citeturn0search10turn0search11turn1search1

### Comparative mechanics: mutation, selection, evaluation

| System (from your list + closest SOTA adjacencies) | What is being optimized? | Mutation / variation mechanism | Selection rule | Evaluation signal / harness |
|---|---|---|---|---|
| ADAS | Agentic system designs represented in code | Meta-agent writes/modifies agent code; archive of discovered agents informs new proposals | Keep/add designs that score well; archive guides future search (open-ended flavor) | Task performance on benchmark suites (coding, math, science in paper); “evaluate then archive” loop citeturn0search0turn0search28 |
| AFlow | Agentic workflows (graph/code of LLM calls + control flow) | Monte Carlo Tree Search over workflow edits; operator set includes generate/format/review+revise/ensemble/test/programmer/etc. | MCTS tree policy favors promising workflow variants | “Execution feedback” + numeric evaluation functions; reported average gains vs baselines on multiple benchmarks citeturn0search9turn0search1turn0search5 |
| Darwin Gödel Machine | *Its own coding-agent codebase* (self-improvement) | Iterative self-modification: proposes scaffold/tooling/code changes (patch validation, better file viewing/editing, candidate ranking, “history of failures,” etc.) | Empirical improvement on coding benchmarks is required for adoption (no proof obligation) | Automated benchmark evaluation on programming tasks; “self-edit then test” loop citeturn0search10turn0search18turn0search14 |
| AlphaEvolve | Candidate algorithms / code for scientific & algorithmic discovery | Evolutionary loop: LLMs propose code changes; evaluators score; population-like iteration produces improved programs | Score-driven survival of better candidates (evolutionary search) | One or more automated evaluators provide feedback; designed for hard algorithmic/scientific tasks citeturn0search11turn0search7turn0search3 |
| OpenDevin / OpenHands | Agent platform rather than a single optimizer | Variation depends on which agent you plug in; platform supports implementing new agents and coordinating them | Not inherently evolutionary; supports benchmarking + multi-agent coordination | Sandboxed task execution + benchmark integrations; “platform for agents” citeturn7search6turn7search31turn7search1 |
| SWE-agent | Agent-computer interface (ACI) for repo-level task solving | Not evolutionary by default; iterative tool-use loop (edit/view/search/run) is the “inner loop” | Heuristic/agent policy decisions per step | Evaluation in SWE-bench-style harnesses; paper stresses interface design’s impact on performance citeturn7search2turn1search13turn7search11 |
| Agentless | “Agentless” pipeline: localization → repair (+ validation) | Not evolutionary; generates multiple patch candidates in diff format after hierarchical localization | Filter/rerank/select patch candidate | Uses tests and validation filters; emphasizes cost-efficient reliability vs complex agents citeturn7search32turn7search7turn7search0 |
| AutoCodeRover | Program improvement for GitHub issues | Not evolutionary; two-stage loop: repo search/context retrieval → patch generation | Chooses patch via its internal logic; can be run pass@1 style | Unit-test based verification on SWE-bench-lite style tasks; reports resolve rates in repo citeturn1search7turn1search27turn1search3 |
| Live-SWE-agent (adjacent SOTA) | *Agent scaffold during runtime* (“live” self-evolution) | Starts from minimal scaffold and modifies its own scaffold implementation while solving problems | Retains scaffold changes that improve performance as it goes | Reports strong solve rates on SWE-bench Verified and SWE-Bench Pro without test-time scaling citeturn1search1turn1search5 |
| A Self-Improving Coding Agent (adjacent SOTA) | Agent code itself | Agent edits itself using its own tools; iterative self-improvement | Keeps edits that improve benchmark performance | Reports large gains on subsets of SWE-bench Verified and other benchmarks citeturn1search30 |

Two implications matter for your wrapper:

First, “self-improvement” is bifurcating into **(A) improving the *solution* code** (AlphaEvolve) vs **(B) improving the *agent/scaffold*** (ADAS, Darwin Gödel Machine, Live-SWE-agent). A governance wrapper is most defensible for (B), because the blast radius of an improved scaffold is broad (it affects every downstream task) and thus demands stronger safety + audit. citeturn0search18turn0search28turn1search1

Second, all of these approaches are only as good as their evaluation. The SWE-bench family and successors exist because deterministic, test-based evaluation is one of the few scalable “fitness” signals for software agents; but 2025–2026 results also emphasize contamination risk and distribution shift, pushing the community toward fresher, broader, and resource-aware benchmarks. citeturn6search14turn6search3turn11search3turn11search6

## Multi-agent orchestration platforms for coding and “agent factories”

Production systems in 2025–2026 are converging on a fairly consistent orchestration shape: **ticket → plan → implement in a sandbox/branch → run tests → open PR → human or automated review gates → merge**. The differentiators are mainly (1) *how tasks are assigned and decomposed*, (2) *how agents coordinate and share state*, and (3) *what quality gates are enforced by default*. citeturn3search2turn3search0turn10search0turn2search2

### How the named platforms differ

Paperclip positions itself as orchestration for “zero-human companies,” explicitly including org charts, budgets, and governance primitives as first-class UI/logic—not just task routing. That makes it unusually aligned with your “governance wrapper” framing, because it treats cost controls and goal alignment as core, not add-ons. citeturn2search0turn2search14

Factory (factory.ai) emphasizes an “agent-native SDLC,” with “Droids” that can be run from the web/CLI and integrated into workflows like code review and CI pipelines; its public messaging explicitly focuses on embedding code-quality “signals” and customizable review behaviors into the process. The existence of documented testing hooks and “testing automation” patterns suggests Factory is operationalizing quality gates as configurable infrastructure, not just prompting. citeturn2search1turn10search32turn10search18turn10search30

Devin (from entity["company","Cognition","ai company behind devin"]) is marketed as a parallel cloud-agent system that integrates with ticketing systems (Linear/Jira) and produces PRs, with explicit steps for planning and self-testing before handoff. Notably, Devin also highlights “learning” workflow fit and managing “approved vs rejected” knowledge, which is a productized take on controlled memory injection. citeturn3search0turn3search6turn3search12

Cursor’s cloud/background agents and automations emphasize parallelizable cloud sandboxes that can clone repos, work on branches, and hand back results, and (as of early March 2026) add *always-on* agents triggered by schedules or events (Slack/Linear/GitHub/PagerDuty/webhooks). Cursor’s changelog also claims these automations have access to a “memory tool” to learn from past runs, which is directly relevant to “overnight” agents that must avoid repeating failure modes. citeturn10search0turn10search12turn10search16

GitHub Copilot Workspace is positioned as an end-to-end developer environment for brainstorming/planning/building/testing/running, and GitHub’s 2024–2025 announcements describe iterative agent loops (e.g., build-and-repair) and increasingly agentic capabilities (agent mode) integrated into the developer platform. GitHub also publicly reported usage-level metrics for Copilot Workspace (developers using it, PRs merged), which is rare among major vendors and useful as a reality check for adoption. citeturn2search2turn2search3turn2search4

OpenAI’s Codex cloud (“Codex web” and the Codex app) is explicitly a cloud-based software engineering agent that runs each task in its own sandbox, preloaded with your repository, and can run many tasks in parallel. The Codex app is positioned as a “command center” for multi-agent workflows and long-running tasks, and the developer documentation emphasizes configurable cloud environments—i.e., the sandbox itself is part of the orchestration layer. citeturn10search1turn3search5turn3search28turn3search13

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["OpenAI Codex app multi agent dashboard screenshot","Devin AI software engineer interface screenshot","GitHub Copilot Workspace screenshot plan build test","Cursor cloud agents background agents screenshot"],"num_per_query":1}

### Cross-platform comparison: assignment, communication, quality gates

**Task assignment and decomposition.** Ticket-native systems (Devin, Cursor automations, Copilot Workspace) bias toward “issue → plan → implement,” often with pre-integration to Linear/Jira/GitHub events. Codex cloud similarly biases toward discrete tasks that run in separate sandboxes, making parallelization a product primitive. Paperclip differs: it frames assignment as goal-driven delegation inside a “company” hierarchy, which can be advantageous when your wrapper wants to optimize across portfolios (e.g., simultaneously evolving agents, workflows, and governance policies). citeturn3search0turn10search12turn2search2turn10search1turn2search0

**Agent communication.** Most production systems converge on *artifact-mediated communication*: branches, PRs, logs, and test results are the “language” agents use to coordinate with humans and (implicitly) with other agents. Codex highlights isolated sandboxes per task; Cursor cloud agents describe working on separate branches and pushing changes; Devin emphasizes PR handoff flows. This architecture minimizes direct agent-to-agent message passing and instead uses version control + CI as a coordination fabric. citeturn10search1turn10search0turn3search0

**Quality gates.** The dominant quality gate is still **tests** (plus linters/type checkers), because they’re machine-verifiable and can be run cheaply in sandboxes. Codex explicitly mentions running commands like tests/linters in cloud environments; Devin markets “Devin tests changes by itself”; Factory documents testing hooks; and Copilot Workspace describes build-and-repair loops. Cursor’s recent “cloud agents with computer use” update further underscores that vendors see real execution (not just static reasoning) as critical to correctness. citeturn10search1turn3search0turn10search18turn2search3turn10search2

A key governance take-away is that these systems implement *workflow safety* mostly through **sandboxing + PR review**, but they are not designed to safely run *open-ended self-modification* loops (i.e., ADAS/DGM-style evolution of the agent itself). That gap is exactly where a productized governance wrapper can differentiate: enforce multi-objective gates (correctness, security, cost, reproducibility) at the *population/search* layer, not just per-task. citeturn0search10turn0search28turn11search30turn11search6

## Population-based and quality-diversity search over prompts, tools, and workflows

By 2025–2026, there is credible evidence that “agent configuration search” is not hypothetical: multiple papers treat prompts, roles, and even multi-agent topologies as optimization objects, using evolutionary algorithms, staged search, and quality-diversity (QD) optimization. citeturn5search2turn5search33turn5search0

Quality-diversity approaches appear explicitly in work that frames **diverse agent behaviors** as a target. One 2025 paper formulates “QD-LLM” as quality-diversity optimization applied to teams of LLM-powered agents, where the optimization object is a *prompt list* defining the team, and the goal is to generate a set of prompt lists that are both high-performing and behaviorally diverse. citeturn5search0

Evolutionary approaches to multi-agent generation—exemplified by EvoAgent—treat an existing agent framework as an initial “individual” and then apply evolutionary operators (mutation/crossover/selection) to generate multiple agents with diverse settings, reporting improvements across tasks and suggesting a general method for bootstrapping multi-agent ensembles without hand-designing all roles. citeturn5search2turn5search15

Search over **both prompts and topologies** is also being formalized. MASS (Multi-Agent System Search) proposes jointly optimizing prompt blocks and orchestration topology in staged phases (local prompt optimization → topology optimization → global prompt optimization) and reports improvements over alternatives, positioning itself as “search in MAS design space.” citeturn5search33

Two other 2025–2026 threads are especially relevant to your wrapper:

- Population-based training (PBT) is showing up in agent-adjacent contexts as a way to **propagate high-performing “interaction artifacts”** (e.g., in-context example collections) across a population, with selective retention of trajectories based on empirical utility. This is conceptually close to “selective inheritance” for agent memory or skill libraries. citeturn5search9turn5search27  
- “Symbolic learning” / “language gradients” are being proposed as mechanisms to optimize prompts/tools/workflows in a more gradient-descent-like manner (text-based “weights” and “gradients”), pointing to hybrid search regimes: evolutionary outer loops, gradient-like inner loops. citeturn5search11turn5search14

For a governance wrapper, the strategic point is that these methods shift optimization from “prompt tuning” to **systems design tuning**—but they also sharply increase the need for (a) robust evaluation, (b) multi-objective optimization (quality, safety, cost), and (c) auditability of why a configuration was selected. Those are product opportunities, not just research problems. citeturn11search30turn11search6turn6search3

## Memory architectures for long-running agents without context pollution

Long-running agents fail in two canonical ways: they either **forget** critical constraints (statelessness) or they **remember too much** (context pollution, instruction drift, and compounding error). The 2025–2026 literature is increasingly explicit that “memory” must be treated as a write–manage–read loop with policies—not a single vector store. citeturn4search2

Two foundational architectures still anchor modern practice:

MemGPT formalizes a “virtual memory” approach: multiple memory tiers and explicit paging/management so an agent can operate beyond fixed context windows, borrowing ideas from operating systems (hierarchical storage, interrupts). This directly motivates “typed memory” designs where different memory classes have different retention and retrieval policies. citeturn4search0turn4search7

Generative Agents shows an architecture for storing a complete “memory stream” of experiences, synthesizing higher-level reflections over time, and retrieving memories to drive planning—demonstrating that summarization is not just compression; it is *abstraction building* and can change behavior qualitatively. citeturn4search1turn4search4

In 2026, surveys and new architectural proposals attempt to systematize these patterns. A March 2026 survey (“Memory for Autonomous LLM Agents”) proposes a taxonomy and formalizes memory as a write–manage–read loop, spanning temporal scope and representational substrate. citeturn4search2 A January 2026 proposal (“Continuum Memory Architecture”) argues for persistent state that can **accumulate, mutate, disambiguate, and consolidate**—explicitly positioning itself as going beyond standard RAG’s inability to evolve memory over time. citeturn4search17

On the practitioner side, multiple systems are productizing cross-session or run-to-run memory. For example, Cursor’s automation changelog claims access to a “memory tool” so agents can learn from past runs; and open-source projects like SimpleMem explicitly market cross-session memory improvements on long-context benchmarks. citeturn10search16turn4search26

From a governance perspective, the “typed memory” requirement you called out is best reframed as **policy-separated state**:

- **Episodic run logs** (what happened, with artifacts and hashes), retained for audit and regression analysis. citeturn11search30turn10search1  
- **Approved organizational knowledge** (standards, ADRs, security constraints), write-protected or write-gated, akin to Devin’s “approved vs rejected knowledge” framing. citeturn3search0  
- **Learned heuristics / priors** (what tends to work), which should be mutable but require evaluation + rollback mechanisms—mirroring the autoresearch “keep/revert” loop and Darwin Gödel Machine’s empirical validation requirement. citeturn8search2turn0search10  

This “selective inheritance” framing is also consistent with how population-based methods treat artifact propagation: propagate what works, but only after empirical utility is established, and keep lineages so regressions can be traced. citeturn5search9turn5search27

## Overnight autonomous coding and the landscape map for your product

### What “overnight coding” looks like in production now

“Overnight autonomous coding” is essentially **asynchronous, long-horizon, partially supervised software work**: you delegate tasks, agents run in sandboxes over hours, and you review outcomes the next day (often as PRs with logs/tests). In 2025–2026, multiple production systems explicitly support this mode:

Codex cloud is designed to run tasks in isolated cloud sandboxes, with parallel tasks, and is paired with a desktop “Codex app” explicitly aimed at managing multiple agents over long-running tasks. citeturn10search1turn3search28turn3search5

Cursor Automations (March 5, 2026) takes this further by making always-on agents triggered by events or schedules; the platform description explicitly positions it as upgrading the software engineering pipeline with monitoring/review workflows and “factory” metaphors. citeturn10search12turn10search16turn10search8

Devin markets “parallel cloud agents” and a workflow that includes planning and self-testing before PR handoff, which matches the overnight pattern’s needs: autonomy plus artifacts for review. citeturn3search0turn3search6

GitHub Copilot Workspace and GitHub’s later “agent mode” messaging show the same direction: agents integrated into the repo/ticket environment, iterating (build, repair, run commands) and producing mergeable artifacts. GitHub also publicly reported that tens of thousands of developers have used Copilot Workspace and that thousands of PRs have been merged, suggesting real operational usage rather than pure demos. citeturn2search3turn2search2turn2search4

Factory explicitly describes integrating agent workflows into pipelines (e.g., code review in GitHub Actions) and documenting testing automation hooks—again matching overnight operation where you want agents to “fail closed” on quality gates. citeturn10search30turn10search18turn10search32

### What works and what fails in the real world

What works reliably tends to be: (a) tasks with **clear objective tests**, (b) tasks that can be **scoped to a bounded patch surface**, and (c) workflows that routinize “spec → implement → test → PR evidence.” This is why SWE-bench-style evaluation is so dominant, and why production systems converge on PR-based handoffs. citeturn6search14turn10search1turn3search0turn10academia36

What fails, repeatedly, clusters into five buckets:

Environment setup and toolchain brittleness remains a major failure mode. Benchmarks like SetupBench explicitly identify failures such as incomplete tooling installation, hallucinated task constraints, and non-persistent environment modifications that break collaboration. citeturn11search12

Distribution shift is real: when benchmarks expand beyond the small set of popular repos, success rates can drop sharply. SetUpAgent-based benchmark generation work reports significant distributional differences and substantially lower success rates on broader/app-focused datasets compared to SWE-bench. citeturn11search3turn11search7

Benchmark contamination is a live concern and can inflate apparent progress, motivating “fresh task” pipelines like SWE-rebench for decontaminated evaluation and continuously updated tasks. citeturn6search3turn6search6turn6search5

Resource blow-ups (“token snowball,” time/cost) change what is “best” in practice, which is why SWE-Effi-style metrics re-rank systems based on effectiveness under budgets rather than raw solve-rate alone. citeturn11search6turn11search5

Security is now a frontline issue for high-privilege coding agents. A 2025 study of prompt injection against agentic coding editors (including Cursor and Copilot) reports high attack success rates for malicious command execution under certain conditions, highlighting that agents operating on external resources can be hijacked through poisoned context. citeturn10academia37

### Landscape map: where your governance wrapper sits

A useful “map” for this frontier is two-dimensional:

- **Horizontal axis: Self-improvement depth**  
  from “fixed scaffold” → “workflow/config search” → “self-modifying scaffold” → “self-modifying model/training loop”.

- **Vertical axis: Production governance maturity**  
  from “research prototype” → “sandbox + PR” → “cost/security/quality gates as first-class” → “organization-level governance (budgets, roles, audits, policy)”.

Placed on that map:

- Fixed-scaffold baselines (SWE-agent, Agentless, AutoCodeRover) generally sit mid-low on self-improvement depth and mid on governance (they often assume sandbox + tests in the harness, but don’t govern open-ended evolution). citeturn7search2turn7search32turn1search7  
- Workflow/config search systems (ADAS, AFlow, MASS, EvoAgent) increase self-improvement depth but are typically research-oriented and under-specified on production governance. citeturn0search28turn0search9turn5search33turn5search2  
- Self-modifying scaffold systems (Darwin Gödel Machine, Live-SWE-agent, self-improving coding agent) push farthest on self-improvement depth, but the governance story is still mostly “empirical eval + revert,” not enterprise-grade policy control. citeturn0search10turn1search1turn1search30  
- Production orchestrators (Codex cloud/app, Devin, Cursor automations, Copilot Workspace, Factory) are higher on governance maturity (sandbox/branches/PR/CI, integrations), but they generally do not provide *search-over-agent-design* as a product primitive. citeturn3search5turn3search0turn10search16turn2search3turn10search32  

Your system, as described, sits in a distinctive niche: **high governance maturity + high self-improvement depth**, specifically by wrapping ADAS-like self-improvement/search with org-level controls:

- Paperclip provides the “company-level” abstraction (budgets, governance, hierarchical goals). citeturn2search0  
- gstack provides role-separated skill surfaces (plan/review/QA/release), which can be reused directly as “mutation operators” and “quality gate agents” around candidate designs. citeturn9search21  
- autoresearch provides a minimal, legible experiment loop (propose change → run with fixed budget → score → keep/revert), which is the core governance primitive for safe, incremental self-improvement. citeturn8search2turn8search0  

### What you can borrow vs what you likely need to invent

You can borrow the following, largely “off the shelf,” because they already exist in either papers or production products:

You can adopt the *code-represented workflow* paradigm and search patterns directly from ADAS and AFlow (agent/workflow as code; automated proposal; evaluation-driven archiving), using MCTS-like or evolutionary outer loops depending on your constraints. citeturn0search28turn0search9

You can adopt *empirical gating + rollback* from Darwin Gödel Machine and autoresearch as your default safety story: no change is merged into the “genome” unless it improves on a defined evaluation harness under a fixed budget. citeturn0search10turn8search2

You can adopt the production orchestration substrate used by Codex cloud, Cursor cloud agents, Devin, and OpenHands: per-task sandboxes, branch-based work, PR artifacts, and CI integration as the primary communication/coordination medium. citeturn10search1turn10search0turn3search0turn7search1

You can likely reuse memory patterns from MemGPT/CMA-style ideas (tiered memory, consolidation, policies) and align them with product primitives already emerging in automation systems that claim run-to-run memory. citeturn4search0turn4search17turn10search16

You likely need to invent or at least tightly integrate these pieces, because they are not solved end-to-end anywhere:

A **multi-objective “fitness function”** for agent evolution that includes correctness, cost, security, and maintainability—not just solve-rate. SWE-Effi formalizes resource-aware evaluation; prompt-injection work shows security must be tested, not assumed; and distribution-shift studies show you need broad, representative eval suites. A product wrapper can unify these into a single selection policy. citeturn11search6turn10academia37turn11search7turn6search3

A **governance-first memory model** with “typed memory + selective inheritance” where only certain memory types can propagate across generations/runs, and propagation is conditional on empirical utility (PBT-like) plus safety review. Existing papers describe components; few systems productize lineage tracking and rollback for memory itself. citeturn5search9turn4search2turn0search28

A **mutation-operator library** for agent design search that is compatible with production: e.g., gstack-like “roles” for planning/review/QA become operators; plus workflow-topology edits (AFlow/MASS) and tool-config edits (Codex cloud environments). This is the layer that differentiates “random prompt evolution” from “engineering-grade evolution.” citeturn9search21turn0search1turn5search33turn3search13

A **hardening layer against agent-specific security failures**, especially prompt injection via external resources and misuse of high-privilege tools. Research shows this is a practical exploit path; your wrapper can make “security evals” a required gate for any evolved scaffold/tool behavior. citeturn10academia37turn11search30

## The most relevant papers/systems to study before building

ADAS (ICLR 2025) is the clearest articulation of “agent design as a search problem,” and its Meta Agent Search gives you the canonical archive-driven loop (generate → evaluate → archive → iterate) in code space. If you’re building a governance wrapper around ADAS, this is the base layer you’re operationalizing. citeturn0search4turn0search28turn0search8

Darwin Gödel Machine is the best-developed “self-modifying coding agent” blueprint in this period: it operationalizes self-improvement through empirical validation and illustrates the kinds of scaffold/tooling changes that actually move benchmarks (patch validation, candidate ranking, failure-history memory). It is directly relevant to how you might structure safe self-modifying scaffolds inside your wrapper. citeturn0search10turn0search18turn0search14

AFlow is a strong reference for *search over workflows* (not just prompts): it treats workflows as code-connected nodes/edges, uses MCTS, and emphasizes execution feedback and operator sets. This is directly reusable for “workflow genome” search in a governed production setting. citeturn0search9turn0search1turn5search25

MASS and EvoAgent together cover the “optimize prompts + topologies + ensembles” sub-frontier: MASS formalizes staged optimization of prompts and orchestration, while EvoAgent provides an evolutionary method to turn a single agent framework into a diverse multi-agent system. This is directly relevant to population-based search for agent configurations. citeturn5search33turn5search2turn5search15

OpenAI Codex cloud/app is the most explicit example in your list of a production-oriented, multi-agent, sandboxed coding architecture (parallel tasks, isolated environments, PR handoff, configurable environments, and a dedicated multi-agent “command center”). Even if you don’t use it as your engine, it is a key reference for what “production-grade” orchestration UX and infrastructure look like in 2025–2026. citeturn3search2turn3search5turn3search28turn10search25