---
name: factory
preamble-tier: 3
version: 0.2.0
description: |
  Shadow League evolution runner. Spawns parallel crews (champion + mutant),
  scores through hard gates + Pareto evaluation, promotes winners. Evolves
  which model/prompt/tool configuration works best for your repo.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /factory — Shadow League Evolution Runner

Run autonomous evolution experiments on your codebase. Spawns parallel crews
(champion + mutant configurations), scores them through hard gates and Pareto
evaluation, and promotes winners.

## Usage

- `/factory run` — Run a Shadow League experiment
- `/factory run --dry-run` — Estimate cost without executing
- `/factory variance-check` — Pre-flight: measure LLM non-determinism noise
- `/factory lineage` — Show mutation history as ASCII tree
- `/factory history` — Show run history with sparkline trends
- `/factory adopt --from file.json` — Import a community crew config

## Preamble

```bash
FACTORY_ROOT=$(git rev-parse --show-toplevel)
FACTORY_DB="$FACTORY_ROOT/evo/evo.db"
export FACTORY_ROOT FACTORY_DB

# Respect gstack skill prefix convention
_SKILL_PREFIX=$(~/.claude/skills/gstack/bin/gstack-config get skill_prefix 2>/dev/null || echo "false")
_PROACTIVE=$(~/.claude/skills/gstack/bin/gstack-config get proactive 2>/dev/null || echo "true")
echo "SKILL_PREFIX: $_SKILL_PREFIX"
echo "PROACTIVE: $_PROACTIVE"

bash "$FACTORY_ROOT/skills/factory/factory.sh" "$@"
```
