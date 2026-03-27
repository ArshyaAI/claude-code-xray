# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0.0] - 2026-03-27

### Added

- Shadow League runner: champion vs mutant evolution experiments on real tasks
- Worktree-isolated crew dispatch with `--prompt-file` (safe from shell injection)
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

- Shell injection vulnerability in task injection (replaced `$(cat)` with `--prompt-file`)
- `init-evo-db.sh`: added error handling, integrity checks, pure sqlite3 seed insertion

### Changed

- Model catalog and agent roster configs added from BIBLE.md
- Design doc updated with statistical validity constraints, variance experiment, test plan
