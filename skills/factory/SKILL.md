# /factory — Shadow League Evolution Runner

Run autonomous evolution experiments on your codebase. Spawns parallel crews
(champion + mutant configurations), scores them through hard gates and Pareto
evaluation, and promotes winners.

## Usage

- `/factory run` — Run a Shadow League experiment
- `/factory run --dry-run` — Estimate cost without executing
- `/factory variance-check` — Pre-flight: measure LLM non-determinism noise

## Preamble

```bash
FACTORY_ROOT=$(git rev-parse --show-toplevel)
FACTORY_DB="$FACTORY_ROOT/evo/evo.db"
export FACTORY_ROOT FACTORY_DB
bash "$FACTORY_ROOT/skills/factory/factory.sh" "$@"
```
