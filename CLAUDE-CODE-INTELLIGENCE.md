# Claude Code Source Intelligence — Factory Product Input

Generated: 2026-03-31
Source: ArshyaAI/claude-code fork, instructkr/claw-code, mintlify docs

## Settings Schema

**Official JSON Schema**: `https://json.schemastore.org/claude-code-settings.json`

**Settings file locations** (precedence: Managed > CLI > Local > Project > User):

- User: `~/.claude/settings.json`
- Project (shared): `.claude/settings.json`
- Project (local): `.claude/settings.local.json`
- Managed (macOS): `/Library/Application Support/ClaudeCode/managed-settings.json`
- Managed (Linux): `/etc/claude-code/managed-settings.json`

### All Known Settings Keys

| Key                              | Type     | Factory Audit Relevance          |
| -------------------------------- | -------- | -------------------------------- |
| `permissions`                    | object   | CRITICAL — allow/ask/deny rules  |
| `hooks`                          | object   | CRITICAL — hook event map        |
| `env`                            | object   | Medium — injected env vars       |
| `model`                          | string   | Medium — default model selection |
| `effortLevel`                    | string   | Medium — low/medium/high         |
| `autoMemoryEnabled`              | boolean  | High — memory system             |
| `cleanupPeriodDays`              | number   | Medium — session retention       |
| `disableAllHooks`                | boolean  | CRITICAL — hooks kill switch     |
| `defaultShell`                   | string   | Low                              |
| `apiKeyHelper`                   | string   | High — API key management        |
| `respectGitignore`               | boolean  | Medium                           |
| `outputStyle`                    | string   | Low                              |
| `autoMode`                       | object   | High — autonomous mode config    |
| `disableBypassPermissionsMode`   | string   | High — security                  |
| `enableAllProjectMcpServers`     | boolean  | CRITICAL — MCP trust             |
| `sandbox.enabled`                | boolean  | CRITICAL — OS-level sandboxing   |
| `sandbox.filesystem.allowWrite`  | string[] | High                             |
| `sandbox.filesystem.denyWrite`   | string[] | High                             |
| `sandbox.network.allowedDomains` | string[] | High                             |
| `claudeMdExcludes`               | string[] | Medium                           |
| `worktree.symlinkDirectories`    | string[] | Low                              |
| `attribution`                    | object   | Low — commit attribution         |

## CLAUDE.md Loading — Full Hierarchy

Load order (most general → most specific, later = higher precedence):

1. **Managed policy**: `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS)
2. **User** (all projects): `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md`
3. **Project** (in repo): `./CLAUDE.md` or `./.claude/CLAUDE.md` + ancestor walk
4. **Rules directory**: `.claude/rules/*.md` — supports YAML frontmatter `paths:` for path-scoped loading

**Import syntax**: `@path/to/file` — expanded at launch, max 5 hops deep.
**Token budget**: No hard limit on CLAUDE.md. Auto memory (MEMORY.md): first 200 lines or 25KB.
**Key behavior**: Injected as user message after system prompt, NOT part of system prompt.
**Exclusions**: `claudeMdExcludes` setting accepts glob patterns.

## Hook System — 25 Events

`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `PostToolUseFailure`, `Notification`, `SubagentStart`, `SubagentStop`,
`TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`,
`InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`,
`WorktreeRemove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`

**4 handler types**: `command` (shell), `http` (POST), `prompt` (LLM), `agent` (subagent)

**Config format**:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/script.sh",
            "timeout": 30,
            "async": false
          }
        ]
      }
    ]
  }
}
```

**Exit codes**: 0 = success (parse JSON stdout), 2 = block action, other = non-blocking error.

**JSON output fields**: `continue`, `stopReason`, `suppressOutput`, `systemMessage`,
`decision` (block|allow|deny), `reason`, `hookSpecificOutput`.

## Permission System

**Rule evaluation**: deny → ask → allow. First match wins.

**Syntax**: `Tool` or `Tool(specifier)`:

- `Bash(npm run *)` — wildcard
- `Read(./.env)` — gitignore pattern
- `Edit(/src/**/*.ts)` — recursive glob
- `WebFetch(domain:example.com)`
- `mcp__servername__toolname`

**Permission modes**: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`

**Important**: Read/Edit deny rules apply to Claude's tools only, NOT Bash subprocesses.
For OS-level enforcement, enable `sandbox.enabled`.

## Session/Cost Tracking

**Transcript storage**:

- Per-project: `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`
- Sessions: `~/.claude/sessions/ses_<id>.jsonl`
- History: `~/.claude/history.jsonl`

**Token usage** (in assistant message entries, `message.usage`):

```json
{
  "input_tokens": 3,
  "cache_creation_input_tokens": 9877,
  "cache_read_input_tokens": 13566,
  "output_tokens": 32,
  "service_tier": "standard"
}
```

**Per-project cost summary** in `~/.claude.json`:
`lastCost`, `lastAPIDuration`, `lastTotalInputTokens`, `lastTotalOutputTokens`,
`lastTotalCacheCreationInputTokens`, `lastTotalCacheReadInputTokens`,
`lastTotalWebSearchRequests`, `lastModelUsage`, `lastSessionMetrics`.

**Retention**: controlled by `cleanupPeriodDays` (default 30).

## MCP Server Configuration

**Storage locations**:

- User: `~/.claude.json` → `mcpServers` key
- Project: `.mcp.json` at project root → `mcpServers` key
- Managed: `/etc/claude-code/managed-mcp.json`

**Config format**:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "/path/to/binary",
      "args": ["--flag"],
      "env": { "KEY": "value" }
    }
  }
}
```

**Trust**: Project .mcp.json servers require user approval per-server
(or `enableAllProjectMcpServers: true`).

**Tool permission syntax**: `mcp__servername` (all tools), `mcp__servername__toolname` (specific).

## Factory Validation Targets

1. **Settings validation**: Use official JSON schema. Check for misplaced keys between `~/.claude.json` and `settings.json`.
2. **Hook audit**: Parse hooks from all scopes. Check exit codes, timeouts, dead script paths.
3. **CLAUDE.md audit**: Walk tree, count lines, check for conflicts, verify @import paths.
4. **Permission hygiene**: Flag bypassPermissions default, missing .env denies, broad Bash allows.
5. **Transcript parsing**: Sum token usage across sessions. Cache reads are nearly free.
6. **MCP validation**: Cross-check configs against running processes, validate command paths.
7. **Sandbox audit**: Check if sandbox is enabled, evaluate filesystem/network rules.
