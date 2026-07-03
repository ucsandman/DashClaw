# Posture signal integrity (roadmap v3.1) — design

Date: 2026-07-03 · Roadmap: v3.1 (first item of v3, "the instrument tells
the truth") · Spec author: the maintainer, under the 2026-07-03 delegation.

## Problem (measured live, 2026-07-03)

The live instance's posture surface reads **30/100 `at_risk`** and is
mostly noise:

- **164 open findings, 100 of them critical** — and the criticals are
  minted **one finding per guard decision** (`deriveFindings`,
  `app/lib/posture/findings.ts:101-120`): every `allow` at risk ≥50 in
  the 7-day window becomes its own `review_incident` chore. A handful of
  patterns reads as a hundred alarms.
- **74 findings bulk-quieted as `accepted_risk`** — the queue was so
  loud the operator silenced it wholesale. That is the June
  policy-disable pattern (18 days of governance off because of friction)
  repeating one surface up, and the quiet is invisible: nothing renders
  who accepted what, when, or why.
- **`coveredUnits: -22`** — `app/api/posture/route.ts:40` computes
  `unitCount - openFindings`, but findings are not units (incident
  findings aren't coverage gaps, and one unit can't go more-than-covered
  when findings outnumber units). Negative coverage on a public surface
  is the "instrument lies" thesis in one number.
- **No synthetic-traffic filter.** The policy-smoke harness's own
  traffic (`smoke.*` action types, `smoke-*`/`ci-smoke`/test agent
  families) mints units and findings. The calibration miner solved
  exactly this in v2.6 (`isSyntheticEvent`,
  `app/lib/calibration-mining.js:59-67`); posture never adopted it. The
  live queue contains `action_type:smoke.retro.drift.*` findings — the
  verification suite grading the org down for verifying.

## Goals

1. A policy-smoke run against a live instance does not move the posture
   score or mint findings (pinned by smoke).
2. Incident findings collapse to one per pattern with truthful counts.
3. Coverage math cannot go negative and means "units fully covered."
4. Bulk risk-acceptance is a visible, attributed decision on the page.

Non-goals: no new tables, no score-model changes beyond what the filter
itself implies, no change to constitution posture (findings state never
changes the score — that honesty property at `applyFindingStates` stays).

## Design

### 1. Synthetic-traffic exclusion (shared source of truth)

`app/lib/calibration-mining.js` gains one exported constant next to
`SYNTHETIC_AGENT_RE`:

```js
export const SYNTHETIC_AGENT_LIKE_PATTERNS =
  ['smoke-%', 'ci-smoke', 'sdk-live-test-agent%', 'demo-e2e-verifier', 'test', 'test-%'];
export const SYNTHETIC_ACTION_TYPE_LIKE = 'smoke.%';
```

A unit test pins the invariant that the LIKE patterns and
`SYNTHETIC_AGENT_RE` accept/reject the same family examples (drift
between the regex and the SQL patterns fails CI).

`posture.repository.ts` applies the exclusion **in SQL** (both queries
must exclude before their aggregation/LIMIT, or synthetic rows starve
real ones):

- `getObservedActionUnits`: `AND action_type NOT LIKE 'smoke.%' AND
  (agent_id IS NULL OR agent_id NOT LIKE ALL(...patterns))`.
- `getRecentDecisions`: same predicate, plus `agent_id` joins the SELECT
  list (needed for evidence + defense-in-depth). `buildAdjustments`
  re-checks rows with `isSyntheticEvent` (belt and braces; the JS
  predicate stays authoritative).

Rationale for SQL-level: `getRecentDecisions` is `LIMIT 100` — on the
live instance the synthetic rows currently consume the limit, so a
JS-side filter would still return an all-synthetic page.

### 2. Incident pattern collapse

`deriveFindings` groups incidents by `(unitKey, riskLevel)`:

- key: `stableKey(['enforcement', 'incident', unitKey, riskLevel])` —
  content-stable across scans, independent of which action ids populate
  the window.
- `evidence.observedCount` = group size; `evidence.exampleActionIds` =
  up to 5 ids; `fix.actionIds` carries the same examples.
- `scoreDelta`: the incident-cap relief is attributed proportionally to
  group size (`max(1, round(totalRelief * n / totalIncidents))`),
  preserving the sort-above-coverage-gaps property.
- Title becomes count-aware: `Ungoverned high-risk actions reached
  allow` with the count in evidence (title itself stays stable so keys
  and copy don't churn per scan).

Migration note: stored `posture_findings_state` rows keyed by the old
per-action keys become orphans (harmless; never matched again). Pattern
findings surface fresh as `open` — correct, because a pattern is a new
judgment the per-action quiets never made. The 74 `accepted_risk` rows
on the live instance keep their history but stop applying; the collapsed
queue is small enough to re-judge in minutes.

### 3. Coverage math

`computePosturePayload` returns `coveredUnits` computed from the actual
grades: `units where coverageByKey[key] >= 1`. The route uses it;
`unitCount - openFindings` dies. `pointsRecoverable` sums **open**
findings only (an accepted finding's delta is not "recoverable" — it was
declined). Pinned: `coveredUnits >= 0` and `coveredUnits <= totalUnits`
by construction, asserted in unit tests.

### 4. Accepted-risk visibility

- `applyFindingStates` (signals.ts) additionally attaches the stored
  state's metadata to non-open findings: `statusMeta: { actor, note,
  updatedAt }` (data already persisted in `posture_findings_state`;
  today it's dropped on merge).
- `/api/posture` summary gains `acceptedRisk: { count, lastActor,
  lastAt }`.
- `/posture` page renders an **"Accepted risk"** section (collapsed by
  default) listing accepted findings with actor, note, and date — and
  the incident cards show `observedCount` (`×N in 7d`). Quieting stays
  possible; it just stops being invisible. Per `.impeccable.md`: calm
  presentation, tokens only, evidence over decoration.

### 4b. Attribution redaction (added post-security-review, same ship)

The adversarial review graded exposing `statusMeta.actor`/`note` to every
org API key a MEDIUM (within-org need-to-know widening: agent keys could
read which human quieted a risk and their free-text why). Decision:
attribution is for humans reviewing the surface. Both GET routes redact
`actor`/`note` (and `summary.acceptedRisk.lastActor`) unless the caller
is session-authenticated — middleware sets `x-user-id` only on the
session path, so `getUserId(request)` is the discriminator. Timestamps
stay for everyone ("when" is audit-shape; "who/why" is identity).
`redactFindingAttribution` in signals.ts, pinned by route tests.

### 5. Demo parity

If the demo middleware serves `/api/posture` fixtures, the fixture
shape gains the new summary fields so the demo doesn't 500 or render
`undefined`. (Verified during build.)

## Acceptance (maps to roadmap v3.1)

- Unit: collapse (N same-pattern incidents → 1 finding, counts/examples
  right), coverage bounds, regex↔LIKE agreement, statusMeta merge,
  open-only pointsRecoverable.
- Smoke (policy-smoke.mjs): after the harness's own risky-allow traffic
  exists, `GET /api/posture` contains **zero** findings referencing
  `smoke.` action types or synthetic agent families, and
  `summary.coveredUnits >= 0`. This is the "smoke run does not move the
  score" pin in its enforceable form.
- Rendered proof: /posture drives headless — accepted-risk section
  visible with actor/date, incident card shows ×N count.
- Live proof: posture on the live instance re-queried after deploy;
  findings drop from 164 to the pattern-collapsed count; score reflects
  real traffic only. Recorded in the maintainer log.

## Out of scope (recorded)

- Feeding collapsed incident patterns into tightening proposals — that
  is v3.2, which consumes this item's output.
- Posture score model recalibration (weights, caps) beyond what
  excluding synthetic units naturally changes.
- An explicit "re-open" flow for orphaned per-action states.
