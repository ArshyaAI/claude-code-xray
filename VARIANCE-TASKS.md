# Variance Check Tasks

# Simple, achievable tasks for measuring LLM non-determinism

- [ ] Add JSDoc comment to the parseTasks function in src/orchestrator/tasks.ts
  - Document the parameters, return type, and behavior
  - Include @example usage
- [ ] Add JSDoc comment to the loadConfig function in src/orchestrator/config.ts
  - Document the parameters, return type, and fallback behavior
- [ ] Add JSDoc comment to the evaluate function in src/evaluator/score.ts
  - Document the scoring pipeline steps
- [ ] Add JSDoc comment to the mutate function in src/genotype/mutate.ts
  - Document the mutation process and options
- [ ] Add JSDoc comment to the runSignTest function in src/promoter/protocol.ts
  - Document the statistical test and threshold
- [ ] Add JSDoc comment to the checkDemotion function in src/promoter/protocol.ts
  - Document the demotion logic and fallback chain
- [ ] Add JSDoc comment to the createWorktree function in src/orchestrator/dispatch.ts
  - Document the worktree lifecycle
- [ ] Add JSDoc comment to the describeMutation function in src/orchestrator/narrative.ts
  - Document the narrative generation for each operator type
- [ ] Add JSDoc comment to the runAllGates function in src/evaluator/gates.ts
  - Document the gate evaluation order and short-circuit behavior
- [ ] Add JSDoc comment to the computeUtility function in src/evaluator/score.ts
  - Document the weighted sum formula and dimension weights
- [ ] Add JSDoc comment to the buildCrewConfigs function in src/orchestrator/shadow.ts
  - Document how mutants are generated from the champion
- [ ] Add JSDoc comment to the collectCiResults function in src/orchestrator/dispatch.ts
  - Document which CI checks are performed and fallback behavior
- [ ] Add JSDoc comment to the runCrewPipeline function in src/orchestrator/crew-pipeline.ts
  - Document the builder-reviewer-QA pipeline stages
- [ ] Add JSDoc comment to the detectArchetype function in src/orchestrator/detect-archetype.ts
  - Document the detection priority order and fallback
- [ ] Add JSDoc comment to the showHistory function in src/orchestrator/history.ts
  - Document the sparkline rendering and data sources
- [ ] Add JSDoc comment to the printLineage function in src/orchestrator/lineage.ts
  - Document the tree traversal and ANSI color scheme
