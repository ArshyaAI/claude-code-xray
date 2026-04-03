# Show HN: Claude Code X-Ray -- scan your AI agent config for security gaps

Claude Code has 70+ settings, 25 hook events, a 4-level instruction hierarchy, and a full permission system. Most setups use less than 5% of this surface area. Some of those defaults are actively dangerous.

Real incidents:

- Dec 2025: Claude Code deleted a user's entire Mac home directory
- Mar 2026: `terraform destroy` wiped a production database during a refactoring session
- CVE-2025-59536: RCE via malicious hooks when cloning untrusted repos
- Co-authored commits leak secrets at 3.2% rate (2.4x human baseline)

I built X-Ray to scan your setup and surface what's broken. It reads your settings files, permission rules, hook configs, CLAUDE.md hierarchy, MCP server trust, and session transcripts (token counts only -- never message content). It scores you across 4 dimensions: Safety (0.30 weight), Capability (0.25), Automation (0.25), and Efficiency (0.20).

The scoring is grounded in Claude Code's actual implementation. Every check maps to a real behavior, labeled either `[VERIFIED]` (from official schema/docs) or `[INFERRED]` (from source analysis).

Ran it on my own setup. Score: 68. No deny rules for project-level secrets, Coordinator Mode not configured, 6 hook events uncovered. Ran `xray fix --apply`, safety went to 100. The terminal output is animated -- spinners while scanning, progress bars filling up per dimension, score counting up. The fix flow shows each change being applied with a checkmark, then the score transitions from old to new.

Fixes are conservative: dry-run by default, each change shown as a diff with a "why this is safe" explanation, automatic backup before applying, rollback on failure.

```
npx claude-code-xray
```

That's it. Node 18+, runs entirely locally, no data leaves your machine.

It also has CI integration: `xray ci --min-score 70` exits non-zero if your setup regresses (useful as a pre-commit hook or GitHub Action). `xray diff` compares your current scan against the last one and shows which checks flipped. And `xray experiment` runs controlled before/after tests on individual fixes to prove they actually help.

Why now: Anthropic is building autonomous background agents (Coordinator Mode), cloud compute, and multi-agent orchestration. When a background agent can modify files at 3am with `bypassPermissions`, your config needs to be solid.

Other tools in this space (/refine, cclint) focus on general setup quality. X-Ray leads with safety -- the dimension weighted highest -- and auto-fixes with rollback. The README has a comparison table.

Repo: https://github.com/ArshyaAI/claude-code-xray

MIT licensed. TypeScript. 336 tests. Zero runtime dependencies.

Happy to answer questions about the internals, the scoring methodology, or the source analysis findings.
