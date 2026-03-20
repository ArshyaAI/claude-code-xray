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

## Do Not

- Commit secrets (tokens, auth.json)
- Edit scripts in ~/.factory/ directly — edit in this repo, run install.sh
- Push to main without testing locally first
