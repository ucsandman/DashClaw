---
description: Post-commit verification wave — dispatch gate-runner, drift-auditor, and
  security-reviewer in parallel over the pending changes, report only failures.
argument-hint: "[optional: scope note passed to all three agents]"
---

Dispatch these three subagents IN ONE MESSAGE so they run concurrently. Each agent
definition carries its own `model:`; do not override it.

1. `dashclaw-gate-runner` — "Run the DashClaw verification gates (lint, full vitest,
   build, and the contract checks if routes/SDK/schema changed) and report only
   failures plus a pass/fail verdict. $ARGUMENTS"
2. `dashclaw-drift-auditor` — "Audit the drift-prone counts and the unified version
   against live truth. Scope of change: the pending changes on the current branch
   (use git diff/status to find them). $ARGUMENTS"
3. `dashclaw-security-reviewer` — "Security-review the pending changes on the current
   branch (use git diff/status to find them). Focus on the DashClaw auth / API-key /
   x402 / webhook / repository-SQL / secrets surface. $ARGUMENTS"

When all three return, produce ONE combined verdict:

- **PASS** only if all three passed. Otherwise **FAIL**.
- List every failure with `file:line` and which agent found it.
- Do not summarize passing output; do not paste logs.
- If any agent errored or failed to authenticate rather than completing, say so
  loudly and count the wave as FAIL — a skipped review is not a passed review.
