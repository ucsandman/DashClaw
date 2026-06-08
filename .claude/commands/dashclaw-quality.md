---
description: Recurring find-and-fix quality pass over the whole DashClaw app — browser smoke (frontend-verify) + code gates → triage → parallel worktree fixes → verify → ship. The goal prompt that drives the dashclaw-find-and-fix workflow.
argument-hint: "[optional: focus area, token target like +500k, or 'no-ship']"
---

# Goal: make the DashClaw site actually work, without me clicking through it

You are running a **recurring find-and-fix quality loop** on this repo. The goal is a clean app:
every page renders, every code gate is green, and the fixes are in the working tree ready to ship.
Drive it to that state autonomously — do not hand me a checklist of things for me to do.

This command explicitly authorizes you to call the **Workflow** tool (the
`dashclaw-find-and-fix` script in `.claude/workflows/`). That is the engine; you are the driver.

## Stop condition

Loop until the workflow reports `stillBroken: []` **and** a full gate run is green, OR until
two consecutive rounds land nothing new (then stop and report what's stuck — do not spin).
Hard cap: **3 rounds**. If `$ARGUMENTS` names a focus area, scope triage/fixes to it. To go
deeper, include a token target like `+500k` in your message — the workflow's fan-out (finder
count and number of issues fixed) auto-scales to the turn's `budget.total`; it's read from the
harness, not passed as an arg.

## Each round

1. **Boot the browser layer (this session owns the dev server).**
   Check `http://localhost:3000`. If it isn't up, start `npm run dev` in the background and wait
   until it answers. The dev server must be started *here*, not inside the workflow — background
   processes started by a sub-agent don't reliably survive.
   - If a stale `.next/dev` cache makes every route 500 while `npm run build` passes, clear it and
     restart dev before trusting the smoke results.

2. **Browser smoke with `frontend-verify`.** Invoke the `frontend-verify` skill across the routes
   (it's the token-cheap verifier — reads console errors + failed network requests first, writes
   full page state to disk; this is *not* the Chrome DevTools MCP, which stays banned). Collect its
   findings as a list of `{source:"browser", severity, summary, location, evidence}`.

3. **Run the workflow.** Call `Workflow` with `name: "dashclaw-find-and-fix"` and
   `args: { baseUrl: "http://localhost:3000", browserFindings: [...the list from step 2...] }`.
   It will: discover routes → HTTP-smoke + run lint/vitest/build/contract gates in parallel →
   triage everything (your browser findings included) into atomic issues → fix the top ones in
   **isolated worktrees in parallel** → integrate the green diffs sequentially onto the working tree.

4. **Trust nothing — re-read the real diffs.** When the workflow says something is fixed, open the
   landed changes and READ them, and re-run the relevant check yourself. Confident-wrong "it's
   fixed" is the #1 failure mode here. A fix that landed but doesn't actually intercept the symptom
   counts as still-broken.

5. **Decide: loop or stop.** If `stillBroken` is non-empty and this round made progress, loop. If
   the *same* issue survives two rounds, change the hypothesis (use the `systematic-debugging`
   skill) instead of re-poking the same spot — list 2–3 candidate root causes, run the cheapest
   discriminating test, then fix.

## When clean — verify, then ship

6. **Full gate (its own step, read the output):** `npm run lint`, then `npx vitest run` (the
   **full** suite — targeted runs miss regressions), then `npm run build` (webpack). If any fix
   touched `schema/` or `drizzle/`, run `npm run db:migrate` first.

7. **Ship** unless `$ARGUMENTS` contains `no-ship`: hand off to the **`/dashclaw-ship`** skill —
   it lands on main (you don't do PRs), bumps the unified platform+SDK version, and re-syncs every
   doc/count/date to match the live code. Don't reinvent the release steps; that skill owns them.

## Guardrails (carry into every fix)

- **Surgical only.** Every changed line traces to a finding. Don't "improve" adjacent code.
- **Governance boundary.** Don't extend `app/api/_archive/**` or add agent-platform features.
- **No direct SQL in routes** — go through `app/lib/repositories/*.repository.js`.
- **Never hardcode** a version number (injected via `next.config.js`) or a hex color (use the
  tokens in `app/globals.css`).
- **Token/cache discipline** (this is the repo where context burns hardest): the heavy fan-out
  lives in the workflow's sub-agents, whose context is discarded. Keep *this* driver session lean —
  read the workflow's structured report and the landed diffs, not whole files or raw gate logs.

## Report at the end

One compact summary: routes checked, issues found, what **landed** (with one line each), what was
**deferred** and why, what's **still broken** after the cap, and whether you shipped or stopped at
`no-ship`. No wall of logs.
