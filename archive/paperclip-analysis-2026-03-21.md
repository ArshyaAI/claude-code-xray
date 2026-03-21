# Paperclip Experiment Archive

Generated: 2026-03-20T23:34:57Z

This document summarizes the Paperclip v1/v2 experiment configurations that
preceded the BIBLE.md architecture. These configs are archived here as
historical reference — they are NOT the canonical DeFactory architecture.

## Summary Table

| Version | Agents | Adapter Types | Notes |
| ------- | ------ | ------------- | ----- |
| defactory-v1 | 12 | "claude_local","codex_local" | company=DeFactory |
| defactory-v2 | 5 | "claude_local","codex_local" | company=DeFactory-v2 |

## Per-Version Detail

### defactory-v1

**Company config:**
```
---
kind: "company"
name: "DeFactory"
description: null
brandColor: null
requireBoardApprovalForNewAgents: true
---


- reviewer - Reviewer
- explorer-2 - Explorer-2
- qa - QA
- evaluator - Evaluator
- explorer-1 - Explorer-1
- archive - Archive
- analyst - Analyst
- critic - Critic
- strategist - Strategist
- frame-auditor - Frame Auditor
- ceo - CEO
```

**Agents:**

- **analyst**: model=gpt-5.3-codex, adapter=codex_local, role=cfo
- **archive**: model=claude-sonnet-4-6, adapter=claude_local, role=devops
- **builder-1**: model=claude-sonnet-4-6, adapter=claude_local, role=engineer
- **ceo**: model=claude-opus-4-6, adapter=claude_local, role=ceo
- **critic**: model=gpt-5.3-codex, adapter=codex_local, role=general
- **evaluator**: model=claude-sonnet-4-6, adapter=claude_local, role=researcher
- **explorer-1**: model=claude-sonnet-4-6, adapter=claude_local, role=researcher
- **explorer-2**: model=gpt-5.3-codex, adapter=codex_local, role=researcher
- **frame-auditor**: model=claude-opus-4-6, adapter=claude_local, role=researcher
- **qa**: model=claude-sonnet-4-6, adapter=claude_local, role=qa
- **reviewer**: model=gpt-5.3-codex, adapter=codex_local, role=qa
- **strategist**: model=claude-opus-4-6, adapter=claude_local, role=cto

### defactory-v2

**Company config:**
```
---
kind: "company"
name: "DeFactory-v2"
description: null
brandColor: null
requireBoardApprovalForNewAgents: false
---


- reviewer - Reviewer
- builder-1 - Builder-1
- qa - QA
- evaluator - Evaluator
- ceo - CEO
```

**Agents:**

- **builder-1**: model=claude-sonnet-4-6, adapter=claude_local, role=engineer
- **ceo**: model=claude-sonnet-4-6, adapter=claude_local, role=ceo
- **evaluator**: model=claude-sonnet-4-6, adapter=claude_local, role=researcher
- **qa**: model=claude-sonnet-4-6, adapter=claude_local, role=qa
- **reviewer**: model=gpt-5.3-codex, adapter=codex_local, role=qa


## Findings vs BIBLE.md

1. **Explorer-2 was claude_local in v1** — BIBLE.md requires codex_local (gpt-5.4-mini) for cross-model diversity. This was corrected in BIBLE.md.
2. **No board advisor agents in v1/v2** — BIBLE.md adds B1 Analyst (gpt-5.4), B2 Critic (gpt-5.3-codex), B3 Strategist (claude-opus-4-6).
3. **Frame Auditor renamed to Objective Auditor** — clearer scope, same function.
4. **Archive agent in v1** — absorbed into Research Scientist role in BIBLE.md.
5. **v2 identical structure to v1** — no meaningful experiment data in export; both are pre-BIBLE snapshots.

## What Was Preserved

- genotype gen-0000 (seed config) in evo.db
- policy.yml with sha256 seal
- evo/schema.sql (frozen)
- evo/evaluator/* and evo/mutation/mutate.js

## Status

Paperclip v1/v2 configs are archived. Active work proceeds via BIBLE.md architecture.
These exports are read-only historical reference.
