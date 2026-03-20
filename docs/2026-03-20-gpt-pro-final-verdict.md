---
title: GPT Pro Extended — Final Verdict on DeFactory
date: 2026-03-20
model: GPT-5.4 Extended Pro
status: ACTIONABLE — 72-hour plan
---

# Verdict
"You have a real evaluator thesis, a premature org chart, and not enough external truth."

# The 72-Hour CTO Plan

## Hours 0-8: FREEZE
- Turn auto-upgrade OFF (pin model versions, skill versions, eval code)
- Collapse to 5-role runtime: router, builder, reviewer, evaluator, promoter
- Air-gap promotion layer (no holdout details in shared memory)
- Fix sign-test thresholds (7/8 = p=0.03516, NOT < 0.035)
- Stop describing 8/12 protocol until task inventory exists

## Hours 8-24: REAL TASKS
- Pull 20-30 real tasks from ONE narrow NIKIN backlog category
- Split: search set / validation set / sealed holdout / future reserve
- Instrument truth capture: time to PR, human touch, review iterations,
  rollback, post-merge incidents, customer defects, human rescue

## Hours 24-48: BLINDED SHADOW
- Run 10 real tasks comparing champion vs static baseline
- Blind the adjudication
- Convert NIKIN to REAL PAID PILOT (invoice, scope, success metric)

## Hours 48-72: MARKET
- Write one boring one-pager (problem, for whom, how fast, ROI, accountability)
- Define kill criteria
- Hard rule: no new agents, no new theory, no new research unless
  it improves truth capture or paid proof

# Key Findings
1. Sign-test thresholds slightly wrong (7/8 = 0.03516, not < 0.035)
2. Protocol is low-power (~6% chance genuinely better candidate clears both stages)
3. Auto-upgrade = non-stationarity poison for experiments
4. 6 benchmarks + 3 holdouts < required 8 + 12
5. Gaming attack: minimal-diff silent-degradation (tiny patches that look clean but degrade semantics)
6. Blind spot: "accumulating persuasive experiment history while optimizing on a moving target"
