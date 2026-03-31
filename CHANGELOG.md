# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0.0] - 2026-03-27

### Added

- Multi-agent crew pipeline: builder→reviewer→QA per task (per design doc)
- Model routing: genotype.model_routing applied via `--model` flag per role
- Tool policy enforcement: genotype.tool_policy applied via `--allowedTools`
- Role-specific system prompts from genotype.prompt_policy
- Auto-bootstrap: evo.db initialized automatically on first run
- SKILL.md frontmatter with gstack v0.12 conventions (preamble-tier, prefix)
- Complexity analysis, diff-hunk coverage, convention violations, doc coverage collectors
- Review score parsing from SCORE: N in agent/reviewer output

### Fixed

- G_review gate blocked all scoring when reviewScore undefined (Phase 1 default pass)
- Architecture gap: agents now run with genotype config instead of bare claude -p
- "Stick to the plan" rule added to CLAUDE.md and project memory

## [0.2.0.0] - 2026-03-27

### Added

- Auto-detection of repo archetype from package.json, Cargo.toml, go.mod, pyproject.toml
- Zero-config experience: `factory run` works with just a PROGRAM.md, no factory.yaml needed
- Lineage visualization: `factory lineage` shows mutation history as colored ASCII tree
- Factory history: `factory history` with run table, sparkline trends, promotion rate
- Mutation narratives: plain English descriptions of what changed and why it scored differently
- `factory adopt --from file.json` for importing community crew configs
- Per-dimension Pareto dominance test for N >= 20 tasks (Phase 2 statistical upgrade)
- Mutation testing score collection via stryker (replaces hardcoded 0.5 default)
- `--parallel` flag for concurrent crew dispatch using spawn + Promise
- `--full-pareto` flag to force per-dimension testing
- GitHub Actions CI workflow (typecheck + unit tests)
- README with quick start, CLI reference, and architecture diagram

### Fixed

- `--prompt-file` doesn't exist in Claude CLI, replaced with `cat | claude -p` stdin pipe
- Worktree gate checks failed due to missing `@types/node`, now in devDependencies
- Variance check generated mutants instead of champion replicas

### Changed

- CLAUDE.md updated with Shadow League reference and testing docs
- Design doc corrected: stdin pipe replaces --prompt-file throughout

## [0.1.0.0] - 2026-03-27

### Added

- Shadow League runner: champion vs mutant evolution experiments on real tasks
- Worktree-isolated crew dispatch with stdin pipe (safe from shell injection)
- Task parser: extracts checkbox items from PROGRAM.md with SHA-256 dedup
- Config loader: validates `factory.yaml` with 6 supported archetypes
- DB migration: `shadow_runs` and `shadow_attempts` tables extending frozen schema
- Demotion logic: 3-consecutive-loss regression detection with parent/frontier fallback
- CLI entry point: `factory run`, `factory variance-check`, `--dry-run` mode
- gstack-compatible `/factory` skill with SKILL.md preamble
- Colored terminal leaderboard with per-dimension Pareto scores (C/R/H/Q/T/K/S)
- Cost parsing from Claude Code JSON output with regex and duration fallbacks
- SIGTERM/SIGINT handler for graceful shutdown with worktree cleanup
- evo.db integration: load/save champion, record evaluations and shadow attempts
- 30 tests (22 unit + 8 integration) covering parser, config, demotion, full pipeline

### Fixed

- Shell injection vulnerability in task injection (replaced `$(cat)` with stdin pipe)
- `init-evo-db.sh`: added error handling, integrity checks, pure sqlite3 seed insertion

### Changed

- Model catalog and agent roster configs added from BIBLE.md
- Design doc updated with statistical validity constraints, variance experiment, test plan
