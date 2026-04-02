# Claude Code X-Ray — Simulated User Testing Results

Date: 2026-04-02
Version: 0.1.2
Personas: 7 | Average Score: 5.4/10

## Scores

| Persona        | Score | Would Star? | Key Quote                                                                   |
| -------------- | ----- | ----------- | --------------------------------------------------------------------------- |
| Beginner       | 5/10  | Maybe       | "Fix crashes on empty repos — that's a ship blocker"                        |
| Power User     | 3/10  | No          | "Scored my well-configured setup 68 due to misreading config architecture"  |
| Security Dev   | 6/10  | No          | "Useful first-pass linter, not a security tool"                             |
| HN Skeptic     | 5/10  | Skip        | "fixes_available has blank diff/target/why_safe — live deception"           |
| Burned Dev     | 6/10  | Yes         | "Would have prevented my specific incident, not the category"               |
| Vibe Coder     | 6/10  | No          | "Gap between 'here's your score' and 'why your 3am session could go wrong'" |
| OSS Maintainer | 7/10  | Yes         | "Strong v0.1, right problems to fix are clear"                              |

## Launch Blockers (fix before posting anywhere)

1. **fix --apply crashes without .claude/ dir** — ENOENT on mkdirp. Beginner's first experience is a stack trace.
2. **JSON fixes_available blank fields** — diff:"", target_file:"", why_safe:"" in scan output. Fix engine exists but isn't wired to scan path.
3. **Global config not merged** — Scores only read project-level settings. Power users who configure ~/.claude/settings.json globally get penalized. Hooks, deny rules, sandbox all missed.
4. **Failing unit tests** — Scoring math changed (bug fixes) but test expectations not updated. 4 failures.

## High Priority (first week)

5. "44 features" overstates — only 4 activatable via env var. Reframe in README.
6. No "why should I care" per finding — beginners don't understand the impact.
7. --ci exit code flag — teams need `exit 1` on security alerts for CI gating.
8. No score benchmarks — "is 49 bad?" Users have no reference point.
9. Hook regex gaps — relative paths (`rm -rf src/`) bypass the PreToolUse check.

## Universally Praised

- Bash-bypasses-deny-rules insight (EVERY persona noticed, most surprising finding)
- Fix dry-run default + backup + rollback (high trust signal)
- Clean terminal output format (3-panel layout)
- Badge/score concept (shareable)
- Safety dimension checks are real (not theater)
- Session cache hit ratio (novel, genuinely useful)
- PostToolUse audit trail fix (burned dev: "directly addresses my trauma")

## What Each Persona Wants

- **Beginner:** "Tell me WHY each finding matters. What bad thing happens?"
- **Power User:** "Read my global ~/.claude/settings.json, not just project"
- **Security Dev:** "Audit hook CONTENT, not just existence. SARIF output."
- **HN Skeptic:** "Wire fix engine to JSON. Fix the 4 failing tests. Be honest about '44 features.'"
- **Burned Dev:** "Show what's STILL dangerous after fixes. --explain flag."
- **Vibe Coder:** "Scare me with stories, not jargon. Narrative framing."
- **OSS Maintainer:** ".xray.json team policy file. --ci flag. Fix diffs in JSON."

## Recommended Fix Priority for /autoplan

Phase A (launch blockers, ~2 hours CC):

1. mkdirp .claude/ before fix writes
2. Wire fix generators to scan JSON output
3. Merge global + project config in all scanners
4. Fix failing unit tests

Phase B (quality, ~2 hours CC): 5. Add "why it matters" detail to each check 6. --ci exit code flag 7. Score benchmarks in output ("49 = needs work, 70+ = solid") 8. Reframe "44 features" honestly in README

Phase C (depth, ~3 hours CC): 9. Hook content audit (not just existence) 10. .xray.json team policy file 11. Relative path coverage in hook regex 12. SARIF output for CI integration
