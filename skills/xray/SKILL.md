---
name: xray
description: |
  Scan your Claude Code setup, show what's dangerous, fix it.
  Run /xray to scan, /xray fix to apply fixes, /xray ci for CI gates.
---

## /xray

Run `npx claude-code-xray` in the current directory and display results.

Available commands:

- `/xray` — scan and show score
- `/xray fix` — show and apply fixes
- `/xray ci --min-score 70` — CI gate
- `/xray diff` — compare against last scan
- `/xray experiment` — prove fixes work
- `/xray export` — share your config
- `/xray adopt <file>` — import a shared config
