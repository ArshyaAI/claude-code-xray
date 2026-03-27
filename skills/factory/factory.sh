#!/usr/bin/env bash
# factory — Shadow League CLI entry point
#
# Usage:
#   factory run [--repo PATH] [--tasks N] [--crews N] [--budget N] [--parallel] [--dry-run] [--keep-worktrees] [--seed N]
#   factory variance-check [--repo PATH] [--tasks N]
#
# Environment:
#   FACTORY_ROOT  — repo root (default: git rev-parse --show-toplevel)
#   FACTORY_DB    — evo.db path (default: $FACTORY_ROOT/evo/evo.db)

set -euo pipefail

FACTORY_ROOT="${FACTORY_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
FACTORY_DB="${FACTORY_DB:-$FACTORY_ROOT/evo/evo.db}"
export FACTORY_ROOT FACTORY_DB

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  run)
    if [ ! -f "$FACTORY_ROOT/factory.yaml" ]; then
      echo "No factory.yaml found — using auto-detected defaults." >&2
    fi
    node "$FACTORY_ROOT/dist/orchestrator/cli.js" run "$@"
    ;;
  variance-check)
    if [ ! -f "$FACTORY_ROOT/factory.yaml" ]; then
      echo "No factory.yaml found — using auto-detected defaults." >&2
    fi
    node "$FACTORY_ROOT/dist/orchestrator/cli.js" variance-check "$@"
    ;;
  help|--help|-h)
    echo "factory — Shadow League Evolution Runner"
    echo ""
    echo "Commands:"
    echo "  run              Run a Shadow League experiment (champion vs mutant)"
    echo "  variance-check   Pre-flight check: measure intra-genotype variance"
    echo ""
    echo "Run options:"
    echo "  --repo PATH      Repository root (default: current git root)"
    echo "  --tasks N        Number of tasks per crew (default: 8, min: 8)"
    echo "  --crews N        Number of crews (default: 2)"
    echo "  --budget N       Budget cap in USD (default: from factory.yaml)"
    echo "  --parallel       Run crews in parallel (default: sequential)"
    echo "  --dry-run        Estimate cost without executing"
    echo "  --keep-worktrees Keep worktrees after completion"
    echo "  --seed N         RNG seed for reproducible mutations"
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    echo "Run 'factory help' for usage." >&2
    exit 1
    ;;
esac
