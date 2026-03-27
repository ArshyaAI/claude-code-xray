# Continuous Factory

## What

Multi-repo autonomous build system. Spawns Claude Code agents in git worktrees overnight.

## Scripts

- `factory-dispatch.sh` — Main orchestrator. Spawns agents per repo.
- `factory-heartbeat.sh` — Monitors running agents (15-min cron).
- `factory-post-run.sh` — Archives results, publishes manifests, notifies.
- `factory-merge.sh` — Auto-merges factory PRs.
- `factory-manifest.sh` — Publishes capability manifests.
- `factory-telegram.sh` — Telegram notifications.

## Conventions

- All scripts source config.sh for paths and settings
- PROGRAM.md per repo defines the work items
- NIGHT-TASK.md is generated per agent (not hand-written)
- Agents run in git worktrees, never touch main checkout
- PRs are created per agent run, merged manually or via factory-merge.sh

## Shadow League (Phase 1)

- `factory run` — Run evolution experiment (champion vs mutant)
- `factory variance-check` — Pre-flight: measure LLM non-determinism
- `factory run --dry-run` — Estimate cost without executing
- CLI entry: `skills/factory/factory.sh` → `src/orchestrator/cli.ts`
- Call chain: `factory.sh → shadow.ts → dispatch.ts → gates+score → protocol`
- Agent invocation: `cat NIGHT-TASK.md | claude -p` (stdin pipe, shell-safe)
- Worktrees get `npm install --ignore-scripts` before gate checks
- DB: `evo/evo.db` (init with `bash evo/init-evo-db.sh`, migrate with `002-shadow.sql`)

## Testing

- Run: `npx tsc && node --test dist/**/*.test.js`
- 52 tests (44 unit + 8 integration)
- Integration tests use mock claude agent (stub script)

## Do Not

- Commit secrets (tokens, auth.json, evo.db)
- Edit scripts in ~/.factory/ directly — edit in this repo, run install.sh
- Push to main without testing locally first
- Use `--prompt-file` flag (doesn't exist in Claude CLI — use stdin pipe)
