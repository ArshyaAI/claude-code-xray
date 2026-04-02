# Claude Code X-Ray

[![npm version](https://img.shields.io/npm/v/claude-code-xray)](https://www.npmjs.com/package/claude-code-xray) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![CI](https://github.com/ArshyaAI/claude-code-xray/actions/workflows/ci.yml/badge.svg)](https://github.com/ArshyaAI/claude-code-xray/actions)

**See inside your Claude Code. Fix what's broken. Share what works.**

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

## Quick Start

```bash
# 1. Scan — see your score and what's wrong
npx claude-code-xray

# 2. Fix — apply safe, conservative fixes with backup + rollback
npx claude-code-xray fix --apply

# 3. Badge — show your score in your README
npx claude-code-xray badge
```

That's it. Three commands. No config, no signup, no data leaves your machine.

## Before & After

```
BEFORE                              AFTER (4 minutes later)

YOUR SCORE: 49/100                  YOUR SCORE: 73/100

Safety & Security  50/100 [!]       Safety & Security  100/100
Capability         25/100           Capability          50/100
Automation         75/100           Automation          75/100
Efficiency         79/100           Efficiency          79/100
```

The `fix` command adds deny rules for secrets, enables sandbox isolation, installs a PreToolUse safety hook, and patches the Bash deny gap. Dry-run by default. Every change shown as a diff with a "why this is safe" explanation.

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
├─ WHAT TO DO NEXT (ranked by impact) ──────────────────────
│  +15-36 pts  Fix critical safety gaps    xray fix
│  +12-32 pts  Fix remaining gaps          xray fix
│
│  Fix all: npx claude-code-xray fix
└────────────────────────────────────────────────────────────
```

## How It's Different

X-Ray is not a linter. It doesn't check your code style or flag unused imports. It checks your **Claude Code harness** — the configuration that controls what an AI agent can do on your machine.

|                    | X-Ray                                                                                                                                                          | Linters / Security scanners          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **What it reads**  | `settings.json`, hooks, CLAUDE.md, session transcripts                                                                                                         | Source code, dependencies            |
| **What it checks** | Agent permissions, safety gates, capability surface                                                                                                            | Code quality, known CVEs in packages |
| **Grounding**      | Claude Code's actual implementation ([source analysis](https://venturebeat.com/technology/claude-codes-source-code-appears-to-have-leaked-heres-what-we-know)) | Language specs, advisory databases   |
| **Catches**        | `bypassPermissions` + no sandbox = agent can `rm -rf /`                                                                                                        | npm audit findings                   |
| **Fixes**          | Adds deny rules, enables sandbox, installs safety hooks                                                                                                        | Updates package versions             |

Every check is labeled `[VERIFIED]` (from official schema/docs) or `[INFERRED]` (from source analysis), so you know the confidence level.

## 4 Dimensions

| Dimension      | Weight | What It Checks                                                                             |
| -------------- | ------ | ------------------------------------------------------------------------------------------ |
| **Safety**     | 0.30   | Permission mode, deny rules, sandbox, MCP trust, PreToolUse hooks, Bash deny gap           |
| **Capability** | 0.25   | Feature inventory (44 internal capabilities), settings schema validation, archetype skills |
| **Automation** | 0.25   | Hook coverage (25 events), dead script detection, CLAUDE.md hierarchy, memory health       |
| **Efficiency** | 0.20   | Session cache hit ratio, activity level, cost trend                                        |

Skipped dimensions (no data) are excluded from the score. Weights renormalize automatically.

<details>
<summary><strong>All 17 checks</strong></summary>

### Safety & Security (weight: 0.30)

| #   | Check                          | What it detects                                                                  | Confidence   |
| --- | ------------------------------ | -------------------------------------------------------------------------------- | ------------ |
| 1   | Permission mode                | `bypassPermissions` lets agents run any command without approval                 | `[VERIFIED]` |
| 2   | Deny rules for sensitive files | Missing deny rules for `.env`, `secrets`, `credentials`, `.pem`, `id_rsa`        | `[VERIFIED]` |
| 3   | Sandbox enabled                | No OS-level filesystem/network isolation — Bash subprocesses bypass deny rules   | `[VERIFIED]` |
| 4   | MCP server trust model         | `enableAllProjectMcpServers` auto-trusts every MCP server in every cloned repo   | `[VERIFIED]` |
| 5   | PreToolUse safety hook         | No safety gate on tool execution — destructive commands run without intervention | `[VERIFIED]` |
| 6   | Bash subprocess deny gap       | Deny rules exist but sandbox is off — `cat .env` still works from Bash           | `[INFERRED]` |

### Capability (weight: 0.25)

| #   | Check                 | What it detects                                                                 | Confidence   |
| --- | --------------------- | ------------------------------------------------------------------------------- | ------------ |
| 7   | Active features       | None of the 44 activatable features have their env var set                      | `[VERIFIED]` |
| 8   | Schema validity       | Unknown top-level keys in settings.json (typos, stale config)                   | `[INFERRED]` |
| 9   | Archetype skills      | Missing recommended skills for your project type (Next.js, React, TS lib, etc.) | `[INFERRED]` |
| 10  | Coordinator available | `CLAUDE_CODE_COORDINATOR_MODE` not set — multi-agent orchestration unavailable  | `[VERIFIED]` |

### Automation & Workflow (weight: 0.25)

| #   | Check               | What it detects                                                     | Confidence   |
| --- | ------------------- | ------------------------------------------------------------------- | ------------ |
| 11  | Hook coverage       | Fewer than 5 of 10 key hook events have handlers                    | `[VERIFIED]` |
| 12  | Dead hook scripts   | Hook commands point to scripts that don't exist on disk             | `[VERIFIED]` |
| 13  | CLAUDE.md hierarchy | Missing instruction files at user or project level                  | `[VERIFIED]` |
| 14  | Memory health       | No MEMORY.md, oversized memory (>200 lines), or autoMemory disabled | `[VERIFIED]` |

### Efficiency (weight: 0.20)

| #   | Check            | What it detects                                                        | Confidence   |
| --- | ---------------- | ---------------------------------------------------------------------- | ------------ |
| 15  | Cache hit ratio  | Prompt cache hit rate below 60% — tokens billed at full price          | `[VERIFIED]` |
| 16  | Session activity | Fewer than 3 sessions — not enough data for reliable analysis          | `[VERIFIED]` |
| 17  | Cost trend       | Total token usage across input, output, cache creation, and cache read | `[INFERRED]` |

</details>

## Fix

```bash
npx claude-code-xray fix           # dry-run: show what would change
npx claude-code-xray fix --apply   # apply fixes with backup + rollback
```

Fixes are conservative: dry-run by default, each change shown as a diff with a "why this is safe" explanation, automatic backup before applying, rollback on failure.

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

## Contributing

Issues and PRs welcome. If you find a check that gives bad advice or a score that feels wrong, open an issue — X-Ray improves by community signal.

## License

MIT
