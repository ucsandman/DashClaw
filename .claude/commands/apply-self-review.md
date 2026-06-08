---
description: Apply the approved improvements from the latest memory-self-review PROPOSAL. Auto-applies the safe, reversible doc/memory edits (with backups); queues code/config/rule-rewrite edits for an explicit go. Never commits or pushes.
argument-hint: "[safe | all | <item numbers e.g. 1 3 5>]  (default: safe)"
---

You are the **apply stage** of DashClaw's self-improvement loop. The weekly `/memory-self-review` job writes a PROPOSAL; you turn the approved items into real edits — safely. You are the action counterpart to that read-only review: you act, but you keep the human gate exactly where risk lives.

Mode = `$1` (default: `safe`).

## 1. Load the proposal
Read `C:\Projects\DashClaw\docs\superpowers\memory-self-review-PROPOSAL.md`. If it's missing or empty, say so and stop — nothing to apply. If it looks stale, check the tail of `C:\Users\sandm\.claude\jobs\memory-self-review.log` to confirm the latest run.

## 2. Classify every proposal item
- **SAFE (auto-appliable):** additive, reversible, **doc/memory only** — appending a documented gotcha/lesson line to an existing CLAUDE.md section; demoting/trimming/moving a MEMORY.md index entry; fixing a stale pointer or count in a doc/memory file. No code behavior change, no deletion of meaning, nothing touching settings/hooks/CI/git-config/deps/schema/auth/billing.
- **NEEDS-CONFIRM (never apply without an explicit go):** any change to code, `settings*.json`, hooks, CI, `.gitattributes`/git config, dependencies, schema/migrations; deleting or rewriting the *meaning* of an existing rule; anything touching auth/billing; or anything you are unsure about. **When in doubt → NEEDS-CONFIRM.**

Editable targets and their paths:
- Project CLAUDE.md: `C:\Projects\DashClaw\CLAUDE.md`
- Global CLAUDE.md: `C:\Users\sandm\.claude\CLAUDE.md`
- Memory index + files: `C:\Users\sandm\.claude\projects\C--Projects-DashClaw\memory\`

## 3. Apply
- Before editing ANY file, back it up once: `<file>.bak-apply-<YYYYMMDD>` (skip if it already exists today).
- Grep the target section first — never insert a line that's already present (idempotent).
- **`safe` (default):** apply every SAFE item into its named section, matching the proposal's wording. Then LIST the NEEDS-CONFIRM items with their exact proposed edit and STOP — do not apply them.
- **`all`:** apply SAFE items, then for each NEEDS-CONFIRM item restate the exact change and apply it (only when a human is present and signalled `all`).
- **`<item numbers>`:** apply exactly those items regardless of class — the number IS the explicit go.

## 4. Verify (evidence, not assertion)
- After editing MEMORY.md, confirm it is still under the ~24.4KB cap — the truncation fix must not regress.
- Re-read each edited region to confirm the edit landed in the right section.
- If any code/config/`.ts` file was changed (only possible via `all`/numbers) and it's in this repo, run `npm run lint` + `npx vitest run` (+ `npm run build` for `app/**`) and READ the output; do not claim done until they pass.

## 5. Record + archive
- In the proposal, mark each handled item `✅ APPLIED <date>` or `⏭ DEFERRED (needs-confirm)`.
- Move the proposal to `docs\superpowers\applied\memory-self-review-PROPOSAL-<YYYYMMDD>.md` so the next weekly run starts clean.

## 6. Never commit or push
Leave all changes in the working tree — a push is its own turn; the operator reviews the diff and commits via their normal flow. End with: what was applied, what's deferred and why, which files were backed up, and an explicit "nothing was committed or pushed."

If, on re-reading the actual file, a proposed item conflicts with an existing rule or its reasoning is wrong, do NOT apply it — flag it `DISPUTED` with your reasoning. Trust what you read in the real files over the proposal's summary.
