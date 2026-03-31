# Claude Code X-Ray

**See inside your Claude Code. Fix what's broken. Share what works.**

![X-Ray: 83](https://img.shields.io/badge/xray-83%2F100-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-blue) ![License: MIT](https://img.shields.io/badge/license-MIT-green)

```bash
npx claude-code-xray
```

Claude Code has 70+ settings, 25 hook events, a 4-level instruction hierarchy, and a full permission system. Most setups use less than 5% of this surface.

Real consequences of bad setups:

- [Claude Code deleted a user's entire Mac home directory](https://gigazine.net/gsc_news/en/20251216-claude-code-cli-mac-deleted/) (Dec 2025)
- [`terraform destroy` wiped a production database](https://medium.com/@glasier067/claude-code-accidentally-deleted-a-production-database-heres-what-really-happened-9135b4bb2318) (Mar 2026)
- [CVE-2025-59536](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/): RCE via malicious hooks in untrusted repos
- Claude co-authored commits leak secrets at 3.2% rate (2.4x human baseline)

X-Ray scans your setup, shows what's dangerous, and fixes it in one command.

## What You See

```
Claude Code X-Ray ──────────────────────────────────────────

  YOUR SCORE: 49/100  (4/4 dimensions scored)

  Safety & Security    █████░░░░░   50/100  [!]
  Capability           ███░░░░░░░   25/100
  Automation           ████████░░   75/100
  Efficiency           ████████░░   79/100

┌─ WHAT YOU HAVE ────────────────────────────────────────────
│  ✓ Permission mode: default
│  ✓ PreToolUse safety hook: yes
│  ✓ MCP server trust: per-server
│  ✓ Cache hit ratio: 99%
│
├─ WHAT YOU'RE MISSING ──────────────────────────────────────
│  [!] No deny rules for .env, secrets, credentials
│  [!] sandbox.enabled is false (Bash bypasses deny rules)
│  [ ] Coordinator Mode available but not configured
│  [ ] 6 hook events uncovered
│
├─ WHAT TO DO NEXT ──────────────────────────────────────────
│  +15-36 pts  Fix safety gaps       xray fix
│  +12-32 pts  Fix remaining gaps    xray fix
│
│  Fix all: npx claude-code-xray fix
└────────────────────────────────────────────────────────────
```

## Fix

```bash
npx claude-code-xray fix           # dry-run: show what would change
npx claude-code-xray fix --apply   # apply fixes with backup + rollback
```

Fixes are conservative: dry-run by default, each change shown as a diff with a "why this is safe" explanation, automatic backup before applying, rollback on failure.

```
49 → 83 in 4 minutes
```

## 4 Dimensions

Every check is grounded in Claude Code's actual implementation (from the [March 2026 source analysis](https://venturebeat.com/technology/claude-codes-source-code-appears-to-have-leaked-heres-what-we-know)). Each check is labeled `[VERIFIED]` (official schema/docs) or `[INFERRED]` (source analysis).

| Dimension      | Weight | What It Checks                                                                             |
| -------------- | ------ | ------------------------------------------------------------------------------------------ |
| **Safety**     | 0.30   | Permission mode, deny rules, sandbox, MCP trust, PreToolUse hooks, Bash deny gap           |
| **Capability** | 0.25   | Feature inventory (44 internal capabilities), settings schema validation, archetype skills |
| **Automation** | 0.25   | Hook coverage (25 events), dead script detection, CLAUDE.md hierarchy, memory health       |
| **Efficiency** | 0.20   | Session cache hit ratio, activity level, cost trend                                        |

Skipped dimensions (no data) are excluded from the score. Weights renormalize automatically.

## Badge

```bash
npx claude-code-xray badge         # markdown for README
npx claude-code-xray badge --svg   # standalone SVG
```

Add to your README: ![X-Ray: 83](https://img.shields.io/badge/xray-83%2F100-brightgreen)

## History

```bash
npx claude-code-xray history       # score over time
```

## Why This Matters Now

Claude Code's source revealed autonomous background agents, multi-agent orchestration, and cloud compute are coming. When these ship, your setup needs to be safe. A background agent with `bypassPermissions` can modify any file at 3am.

X-Ray checks your readiness today. Fixes the gaps. Tracks your progress.

## How It Works

X-Ray reads your Claude Code configuration files:

- `~/.claude/settings.json` (user settings)
- `.claude/settings.json` (project settings)
- `.claude/settings.local.json` (local overrides)
- `~/.claude.json` (MCP servers, global config)
- `~/.claude/projects/*/` (session transcripts, usage only, never content)
- `CLAUDE.md` files (all 4 hierarchy levels)
- `~/.claude/skills/` (installed skills)

**Privacy:** Session transcript analysis ONLY reads `message.usage` fields (token counts). Message content is never read, stored, or transmitted. X-Ray runs entirely locally. No data leaves your machine.

## Requirements

- Node.js 18+
- Claude Code CLI installed
- Optional: `gh` CLI (for some capability checks)

## Commands

| Command                            | What It Does                   |
| ---------------------------------- | ------------------------------ |
| `npx claude-code-xray`             | Scan your setup                |
| `npx claude-code-xray fix`         | Show available fixes (dry-run) |
| `npx claude-code-xray fix --apply` | Apply fixes with backup        |
| `npx claude-code-xray badge`       | Generate README badge          |
| `npx claude-code-xray badge --svg` | Generate standalone SVG badge  |
| `npx claude-code-xray history`     | Show score history             |
| `npx claude-code-xray --json`      | Output raw JSON                |
| `npx claude-code-xray help`        | Show help                      |

## License

MIT
