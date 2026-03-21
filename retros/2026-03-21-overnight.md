# Overnight Retro — 2026-03-21

Generated: 2026-03-21
Sprint: factory/mar21 (DeFactory overnight)
Program: defactory.md (10 items)

## Summary

DONE. All 10 program items completed. Core evolution engine architecture
implemented in TypeScript with full type safety under strict compiler settings.
Session-context hook hardened. Model catalog and agent roster codified as config.

## Items Completed

| #   | Item                              | Status                     | Notes                                                                         |
| --- | --------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| 1   | Archive Paperclip experiment data | DONE (pre-existing)        | scripts/archive-paperclip.sh + archive/ already built                         |
| 2   | Fix session-context.sh hook       | DONE                       | Added guards for empty CLAUDE_PROJECT_DIR, missing jq, stderr redirect        |
| 3   | Implement genotype YAML schema    | DONE (pre-existing)        | src/genotype/schema.ts — 425 lines, typed with Immutable<T> brand             |
| 4   | Implement mutation operators      | DONE (pre-existing)        | src/genotype/mutate.ts — 423 lines, 6 weighted operators, seeded RNG          |
| 5   | Implement Layer 1 scoring         | DONE (pre-existing)        | src/evaluator/score.ts — 437 lines, 7-dimension Pareto scoring                |
| 6   | Implement hard gates              | DONE (pre-existing)        | src/evaluator/gates.ts — 291 lines, 5 binary gates                            |
| 7   | Add promotion protocol skeleton   | DONE (pre-existing, fixed) | src/promoter/protocol.ts — 806 lines, 4-stage protocol. Fixed 3 TS2375 errors |
| 8   | Add model catalog as config       | DONE                       | config/models.yaml — 16 models across 3 providers                             |
| 9   | Add agent roster template         | DONE                       | config/roster.yaml — 12 agents + 3 board advisors                             |
| 10  | Write overnight retro             | DONE                       | This file                                                                     |

## Eval Gate Results

- `npx tsc --noEmit`: PASS (after fixing protocol.ts exactOptionalPropertyTypes errors)
- 0 type errors, 0 failures
- 3 TS2375 errors fixed in protocol.ts (rejection_reason optional property assignment)

## Failure Patterns

- **exactOptionalPropertyTypes + ternary undefined**: TypeScript strict mode with
  `exactOptionalPropertyTypes: true` rejects `prop: condition ? value : undefined`
  for optional properties. Must construct object first, then conditionally assign.
  Pattern: `const result: T = { ...base }; if (cond) { result.prop = value; }`

## What Was Already Built (6 of 10 items)

Deep audit revealed 6 of 10 items were already implemented in previous sessions.
This matches the ConnectOS pattern from run16 (6 of 10 pre-done). Factory memory
confirms: always audit actual repo state before implementing.

Pre-existing items: 1 (archive script), 3 (schema), 4 (mutate), 5 (score),
6 (gates), 7 (protocol — needed TS fix).

## Architecture Coverage

After this sprint, the following BIBLE.md layers have TypeScript implementations:

| Layer              | File                     | Lines | Status                                               |
| ------------------ | ------------------------ | ----- | ---------------------------------------------------- |
| Genotype schema    | src/genotype/schema.ts   | 425   | Complete — typed interfaces, seed, validation        |
| Mutation engine    | src/genotype/mutate.ts   | 423   | Complete — 6 operators, weighted selection, bounds   |
| Layer 1 scorer     | src/evaluator/score.ts   | 437   | Complete — 7 Pareto dims, utility, dominance         |
| Hard gates         | src/evaluator/gates.ts   | 291   | Complete — 5 gates, short-circuit, conversion        |
| Promotion protocol | src/promoter/protocol.ts | 815   | Complete — sign test, Welch t-test, canary, rollback |
| Policy contract    | config/policy.yml        | 182   | Complete — frozen, read-only                         |
| Model catalog      | config/models.yaml       | 214   | Complete — 16 models, 3 providers                    |
| Agent roster       | config/roster.yaml       | 197   | Complete — 12 agents, 3 board                        |

## What's NOT Built Yet (M1-M2 gaps)

- No evo.db SQLite integration (schema exists in BIBLE.md, not wired to TS)
- No real shell gate runners (gates.ts accepts pre-computed results)
- No test suite (no \*.test.ts files)
- No Paperclip adapter wiring (agents not spawnable yet)
- No shared task queue implementation
- No merge-first conductor protocol

## Recommendations for Next Sprint

1. **Add unit tests** for schema validation, mutation operators, scoring functions,
   and promotion protocol. Target: 50+ tests covering edge cases.
2. **Wire evo.db** — implement SQLite adapter using better-sqlite3 for genotype
   storage, evaluation records, and promotion history.
3. **Implement shell gate runners** — run-gates.sh that executes npm build/test/lint
   and feeds results into gates.ts.
4. **Add genotype YAML serialization** — parse/emit genotype.yaml files for
   explorer consumption. Currently TypeScript-only with no I/O.
5. **Build the shared task queue** — ~/.factory/queue/ with claim/release protocol
   for multi-agent coordination.

## Files Created/Modified

| Action   | File                                                          |
| -------- | ------------------------------------------------------------- |
| Fixed    | src/promoter/protocol.ts (3 TS errors)                        |
| Fixed    | ~/.claude/hooks/session-context.sh (empty workspace guard)    |
| Created  | config/models.yaml                                            |
| Created  | config/roster.yaml                                            |
| Modified | .gitignore (added evo.db, node_modules, dist, paperclip dirs) |
| Modified | BIBLE.md (detailed model routing table)                       |
| Created  | retros/2026-03-21-overnight.md (this file)                    |

## Commits

1. `fix(promoter): resolve exactOptionalPropertyTypes errors in protocol.ts`
2. `feat(config): add model catalog from vault model-catalog-2026-03`
3. `feat(config): add agent roster template from BIBLE.md`
4. `docs(bible): update agent roster with model IDs, adapters, effort levels`
5. `chore: update gitignore, add retro` (pending)
