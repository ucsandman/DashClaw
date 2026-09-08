# Calibration controller: the miss-review channel

**Date:** 2026-09-08
**Trigger:** Adherence probe — a synthetic "drop the production database
cluster" action scored 95, was allowed (no policy matched), and the
controller could not learn from it.
**Code:** `app/lib/guard/calibration.ts`, `app/lib/guard/calibration-feedback.ts`,
`app/api/calibration/misses/route.ts`
**Related:** `docs/superpowers/specs/2026-08-17-calibration-demote-arm.md`,
`2026-08-11-approval-calibration-decision.md` (§8 invariant 8)

## The defect

The controller learned only from interruptions:

- a benign approval at/above θ pushed θ **up** (+γ·(1−α));
- a denial pushed θ **down** (−γ·α);
- an action the guard **allowed** produced no adjudication at all.

Allowed false negatives were invisible. With alert fatigue switching broad
policies off, the only labels arriving were benign approvals, and θ
ratcheted to its ceiling: on 2026-09-08 the live instance sat at θ 101.8
with scores capped at 100 — the calibrated raise arm could never fire.
`warn_review` (spec §8 invariant 8) deliberately cannot fix this: a verdict
rendered at leisure on a batch of past warns may only loosen, never tighten.

## The change

A new adjudication source, `miss_review`: a verdict on a **specific** action
the guard let through (decision `allow`/`warn`) that should have been held,
filed via `POST /api/calibration/misses` (admin only).

| | `warn_review` | `miss_review` |
|---|---|---|
| Subject | warn group | one action |
| Weight | 0.5 | 1 |
| Dangerous verdict | loosens ceiling only, θ never tightens | **tightens θ** (−γ·α·w) |
| Benign verdict | may loosen θ | θ unmoved (no miss occurred) |
| Agent e-process | untouched | the acting agent's `denied` increments |
| Live-label floor | not counted | not counted |

Invariant 8 is not violated — it is complemented. Its reasoning ("a verdict
rendered at leisure on a batch of past warns is not evidence the operator
wants MORE interruptions") does not cover a miss: an operator pointing at a
specific allowed act and saying "this should have been held" **is** evidence
they want more interruption for that class. The benign-miss clamp is the
guardrail the other way: a "never mind, it was fine" verdict must not move θ
at all, since below θ a benign label would otherwise tighten via the −γ·α term.

The ledger column is plain text, so no migration was needed. Filing is
best-effort by the feedback module's contract: a controller failure returns
503 and never affects the action itself.

## Verification

- `calibration-feedback.test.js` gains two miss cases: dangerous tightens /
  owns agent / off live counter / event recorded with `source: 'miss_review'`;
  benign leaves θ exactly unchanged while still recording the label.
- Existing `warn_review` and live suites are untouched and keep their
  directionality pins.
- Live check after deploy: file the 2026-09-08 probe miss
  (`act_a4933f53-623c-4b52-a855-74e4c81b0ad5`, risk 95, allow) and confirm θ
  drops from 101.8 toward 100, restoring the raise arm's reach.

## Charter note

MAINTAINER.md §3 forbids auto-applied *policy* changes. This is not one: no
policy row is written, and the effect is recomputed per evaluation from
state the operator's own verdicts produced — the same carve-out the demote
arm took, for the complementary direction.
