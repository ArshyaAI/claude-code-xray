# continuous-factory

Self-improving AI agent orchestrator. Evolves crew configurations through Shadow League experiments.

## Quick Start

```bash
git clone https://github.com/ArshyaAI/continuous-factory.git && cd continuous-factory
npm install && npm run build
node dist/orchestrator/cli.js run --dry-run --repo .
```

The dry run estimates cost without executing. When you're ready:

```bash
node dist/orchestrator/cli.js run --repo /path/to/your/repo
```

## What It Does

Shadow League spawns a **champion** crew (your current best config) and a **mutant** crew (one parameter changed) on the same tasks from your `PROGRAM.md`. Both crews run in isolated git worktrees against your real codebase.

Each task result passes through **5 hard gates** — build, test, lint, cross-model review, SAST — then scores on **7 Pareto dimensions**:

| Dim   | Measures                                                          |
| ----- | ----------------------------------------------------------------- |
| **C** | Code quality (lint errors, complexity, doc coverage)              |
| **R** | Test reliability (coverage delta, mutation score, hidden holdout) |
| **H** | Human approval (Bayesian posterior)                               |
| **Q** | Convention adherence (violations / KLOC)                          |
| **T** | Throughput (items / hour)                                         |
| **K** | Cost efficiency (cost vs budget)                                  |
| **S** | Safety (guardrail pass/fail)                                      |

If the mutant wins a one-sided sign test (p < 0.05, non-inferior on all 7 dims), it becomes the new champion. Your factory gets measurably better over time.

## Prerequisites

- **Node.js 22+**
- **Git** with worktree support
- **Claude Code CLI** (agents run via Claude Code)

## Configuration

Create `factory.yaml` in your repo root:

```yaml
# Required: declares your repo type for archetype-specific scoring
archetype: ts-lib # nextjs-app | ts-lib | react-app | rust-cli | go-service | python-app

# Optional (defaults shown)
max_crews: 5 # max parallel crews per run
default_budget_usd: 50 # cost cap per run in USD
task_source: PROGRAM.md # file containing checkbox task items
active_roles: # which agent roles to activate
  - builder
  - reviewer
  - qa
```

Tasks are read from `PROGRAM.md` as checkbox items:

```markdown
- [ ] Add retry logic to the API client
- [ ] Fix race condition in queue processor
- [x] Already done — skipped automatically
```

## CLI Reference

### `factory run`

Run a Shadow League evolution experiment.

```
node dist/orchestrator/cli.js run [options]

Options:
  --repo PATH          Repository root (default: git root)
  --tasks N            Tasks per crew, minimum 8 (default: 8)
  --crews N            Number of crews (default: 2)
  --budget N           Budget cap in USD (default: from factory.yaml)
  --parallel           Run crews concurrently
  --dry-run            Estimate cost without executing
  --keep-worktrees     Don't clean up worktrees after run
  --seed N             RNG seed for reproducible mutations
```

### `factory variance-check`

Pre-flight noise measurement. Runs the champion twice on identical tasks and reports the coefficient of variation.

```
node dist/orchestrator/cli.js variance-check [--repo PATH] [--tasks N]

Result:
  PASS    CV < 0.10   Signal exceeds noise. Proceed.
  CAUTION CV < 0.25   Increase to 16+ tasks per run.
  FAIL    CV >= 0.25  Investigate temperature, prompt variance, or use 30+ tasks.
```

Run this before your first real evolution to validate experiment design.

## How It Works

```
PROGRAM.md              factory.yaml             evo.db
    │                       │                      │
    ▼                       ▼                      ▼
Parse tasks ──────► Load config ──────► Load champion genotype
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              Champion crew        Mutant crew
                              (current best)    (one param changed)
                                    │                   │
                                    ▼                   ▼
                              ┌──────────┐       ┌──────────┐
                              │ Per task: │       │ Per task: │
                              │ worktree  │       │ worktree  │
                              │ → agent   │       │ → agent   │
                              │ → 5 gates │       │ → 5 gates │
                              │ → 7-dim   │       │ → 7-dim   │
                              │   score   │       │   score   │
                              └─────┬─────┘       └─────┬─────┘
                                    │                   │
                                    ▼                   ▼
                              Aggregate utility   Aggregate utility
                                    │                   │
                                    └─────────┬─────────┘
                                              ▼
                                    Sign test (p < 0.05)
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                                  PASS               FAIL
                              Mutant promoted     Champion retained
                              to champion          (try again)
```

**Mutation operators** (one per generation): swap model (25%), tweak cadence (20%), swap prompt (20%), adjust threshold (15%), toggle policy (10%), adjust budget (10%).

**Promotion protocol** has 4 stages: frontier admission (sign test) → champion challenge on holdout tasks (Welch's t-test) → live shadow on production tasks → canary at 10% traffic. Each stage raises the evidence bar.

## Architecture

```
src/
├── orchestrator/     Shadow League runner, CLI, config, task parsing, dispatch
├── evaluator/        7-dimension Pareto scoring, 5 hard gates
├── genotype/         Schema, 6 mutation operators
└── promoter/         4-stage promotion protocol, sign test, Welch's t-test
```

Supporting files:

```
config/
├── policy.yml        Governance constants (frozen, board-approved)
├── models.yaml       Model routing and capability matrix
└── roster.yaml       Agent role definitions
evo/                  Evolution database (SQLite), schema, migrations
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## License

Private.
