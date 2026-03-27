# Continuous Factory

## What

Self-improving orchestration layer for gstack. Evolves agent configurations through
Shadow League experiments (champion vs mutant crews on real tasks).

## Rules

- **Stick to the plan.** The design doc is the source of truth. Every implementation
  decision must trace back to the approved plan. If deviating, flag it first.
- Architecture decisions require explicit approval before changes.

## Shadow League

- `factory run` — Run evolution experiment (champion vs mutant)
- `factory variance-check` — Pre-flight: measure LLM non-determinism
- `factory run --dry-run` — Estimate cost without executing
- `factory lineage` — Show mutation history as ASCII tree
- `factory history` — Show run history with sparkline trends
- `factory adopt --from file.json` — Import community crew config
- CLI entry: `skills/factory/factory.sh` → `src/orchestrator/cli.ts`
- Call chain: `factory.sh → shadow.ts → crew-pipeline.ts → dispatch.ts → gates+score → protocol`

## Multi-Agent Crew Pipeline

Each task runs a 3-step pipeline per crew (from design doc active_roles):

1. **Builder** — implements the task (model from genotype.model_routing.builder)
2. **Reviewer** — reviews builder's output, produces SCORE: N (model from genotype.model_routing.reviewer)
3. **QA** — runs tests to verify (model from genotype.model_routing.qa)

Each role uses:

- `--model` flag from genotype model_routing
- `--allowedTools` from genotype tool_policy
- Role-specific system prompt from genotype prompt_policy

## Agent Invocation

- `cat NIGHT-TASK.md | claude -p --dangerously-skip-permissions --model {model} --allowedTools {tools}`
- Stdin pipe is shell-safe (no metacharacter injection)
- `--prompt-file` does NOT exist in Claude CLI — never use it
- Worktrees get `npm install --ignore-scripts` before gate checks
- DB auto-bootstraps on first run (init-evo-db.sh + 002-shadow.sql)

## Testing

- Run: `npx tsc && node --test dist/**/*.test.js`
- 83+ tests (unit + integration)
- Integration tests use mock claude agent (stub script)

## Scripts (Legacy)

- `factory-dispatch.sh` — Production orchestrator (coexists with Shadow League)
- `factory-heartbeat.sh` — Monitors running agents (15-min cron)
- `factory-post-run.sh` — Archives results, publishes manifests
- `factory-merge.sh` — Auto-merges factory PRs

## gstack Integration

- Skill: `skills/factory/SKILL.md` (preamble-tier: 3, gstack v0.12 conventions)
- Respects SKILL_PREFIX and PROACTIVE user preferences
- Uses file-based handoff (not stdout) for multi-agent state
- If calling Codex, prepend filesystem boundary instruction

## Do Not

- Commit secrets (tokens, auth.json, evo.db)
- Edit scripts in ~/.factory/ directly — edit in this repo, run install.sh
- Push to main without testing locally first
- Use `--prompt-file` flag (doesn't exist in Claude CLI)
- Ship to gstack directory without Arshya's explicit review and approval
- Deviate from the design doc without flagging it first
