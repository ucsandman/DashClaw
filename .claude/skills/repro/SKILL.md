---
name: repro
description: >-
  Turn a bug symptom into a structured, reproducible bug report — summary,
  environment, exact repro steps, actual vs expected, and evidence (logs, error
  text, failing route/test) — and then optionally scaffold a failing regression
  test that pins it. Use this the moment a bug, defect, crash, 500, wrong
  count, broken page, or "this used to work" is reported and you're about to
  start fixing it, even if the user just pastes an error or says "X is broken".
  A structured report makes a far better fix prompt than a raw symptom and
  becomes the regression test that stops the bug coming back. Trigger on: repro,
  reproduce, bug report, file a bug, "X is broken", "getting a 500", "why is
  this failing", regression test for a bug, write up this bug.
---

# repro — symptom in, structured bug report out

A raw symptom ("the decisions page is blank") is a weak fix prompt: it forces
whoever fixes it to re-derive the environment, the steps, and the expected
behavior from scratch, and it leaves nothing behind to prove the bug stays
fixed. A **structured bug report** front-loads that work once, turns into a
sharp fix prompt, and — its highest-value output — becomes a **failing
regression test** that pins the defect forever.

This skill produces that report, then offers to scaffold the test. It does **not
fix the bug** — capturing it cleanly is the whole job; hand the report to the
fix (or to `/systematic-debugging`) afterward.

## The report format — use this exact structure

Emit the report as one **contiguous, pasteable block** (no leading `>` quote
markers, no mid-sentence line breaks — Wes pastes these into prompts and
issues):

```
## BUG: <one-line summary — the observable failure, not the guessed cause>

**Severity:** <blocker | major | minor — blocker = data loss/security/prod down>
**Surface:** <page + click path, or route, or CLI command, or SDK method>

**Environment**
- Commit: <short sha> (<branch>)
- Node: <version>  ·  Platform: <os>
- Package/SDK version: <if relevant>
- Browser: <only if a UI bug>

**Steps to reproduce**
1. <exact, replayable step — real values, not "do the thing">
2. ...
3. ...

**Actual**
<what happens — verbatim error, status code, stack line, screenshot ref>

**Expected**
<what should happen, and why you believe that — cite the spec/route/test>

**Evidence**
- <log snippet, failing assertion, network response, file:line>

**First suspicion (optional)**
<one sentence — a lead, explicitly marked as unverified so it doesn't anchor>
```

Two rules that keep the report honest:

- **Summary = the symptom, never the guessed cause.** "Decisions page renders
  blank" is reproducible and verifiable; "DecisionsLedgerInner crashes on null
  agent" is a theory that may be wrong and will mislead the fixer. Keep the
  theory in *First suspicion*, clearly fenced off.
- **Steps must be replayable by someone with none of your context.** If a step
  reads "with the right filter set," it's not a step — name the filter and the
  value.

## Fill the fields cheaply — don't interrogate the user

Auto-populate the boring fields before asking the user anything. From
`C:\Projects\DashClaw`:

- **Commit + branch:** `git rev-parse --short HEAD` and `git branch --show-current`
- **Node + platform:** `node -v`; platform is win32 (this repo's dev box)
- **Version:** read `package.json` `version` when the bug touches the platform
  or an SDK surface
- **Evidence for API bugs:** reproduce the call and capture the real response —
  `curl`/the SDK against the local dev server (`npm run dev`, port 3000) beats
  quoting from memory
- **Evidence for UI bugs:** the `frontend-verify` skill already captures console
  errors + failed requests to disk — pull the failing route's entry rather than
  clicking by hand

Only ask the user for what you genuinely can't observe: the intended behavior
when it isn't written down anywhere, or repro steps for a flow you can't reach.
State your assumptions and proceed rather than stalling on a round-trip.

## Then offer the regression test

After the report, offer: **"Want me to scaffold a failing regression test that
reproduces this?"** A bug without a test is a bug that comes back. If yes,
follow DashClaw's vitest conventions (they're non-obvious — see the notes
below), write the test so it **fails on today's code for the bug's reason**, and
say so explicitly. A regression test that passes before the fix is proving
nothing.

Name it after the defect, not the function:
`__tests__/unit/<area>-<symptom>.regression.test.js`.

DashClaw vitest conventions that will trip you up if you skip them:

- Tests live in `__tests__/` (unit/integration/smoke). Run the **full** suite
  with `npx vitest run` — targeted runs miss cross-file regressions.
- **No jest-dom.** Use vitest's own matchers + `@testing-library` queries.
- `@/` resolves to `app/`. Mock `next/navigation` for anything that reads route
  params. A `.jsx` import can resolve to a `.tsx` file.
- Postgres numerics come back as **strings** from the Neon driver — assert on the
  coerced value, not the raw.
- For guard/policy behavior, prefer adding a vector to the risk-calibration
  golden suite over a bespoke test — that's where scoring regressions are pinned.

If the test can't be written cheaply (needs live external state, a real browser
flow, a paid provider call), say so plainly and describe the manual repro
instead of forcing a brittle test — a flaky test is worse than an honest note.

## What this skill does not do

- It does not fix the bug. Report, optionally pin with a test, then hand off.
- It does not open a tracker or PR (this repo commits to main; the report is the
  artifact — paste it into the fix prompt, the maintainer log, or CHANGELOG).
- It does not guess the root cause with confidence. Leads go in *First
  suspicion*, fenced and unverified.
