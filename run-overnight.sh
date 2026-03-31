#!/usr/bin/env bash
# run-overnight.sh — Run multiple Shadow League evolution rounds overnight
# Each round: champion vs new mutant. Winners get promoted. Losers go to cemetery.
set -euo pipefail

FACTORY_ROOT="$(cd "$(dirname "$0")" && pwd)"
export FACTORY_DB="$FACTORY_ROOT/evo/evo.db"
ROUNDS="${1:-5}"
LOG="$FACTORY_ROOT/overnight-$(date +%Y%m%d-%H%M%S).log"

echo "=== OVERNIGHT EVOLUTION ===" | tee "$LOG"
echo "Rounds: $ROUNDS" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "Log: $LOG" | tee -a "$LOG"
echo "" | tee -a "$LOG"

for i in $(seq 1 "$ROUNDS"); do
  echo "--- Round $i/$ROUNDS ($(date)) ---" | tee -a "$LOG"
  
  # Each round uses a different seed for reproducibility
  node "$FACTORY_ROOT/dist/orchestrator/cli.js" run \
    --repo "$FACTORY_ROOT" \
    --tasks 8 \
    --task-source VARIANCE-TASKS.md \
    --seed "$((42 + i))" \
    2>&1 | tee -a "$LOG"
  
  echo "" | tee -a "$LOG"
  echo "Round $i complete. Running lineage..." | tee -a "$LOG"
  node "$FACTORY_ROOT/dist/orchestrator/cli.js" lineage 2>&1 | tee -a "$LOG"
  echo "" | tee -a "$LOG"
done

echo "=== OVERNIGHT COMPLETE ===" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"
echo "Total rounds: $ROUNDS" | tee -a "$LOG"

# Show final history
node "$FACTORY_ROOT/dist/orchestrator/cli.js" history 2>&1 | tee -a "$LOG"
