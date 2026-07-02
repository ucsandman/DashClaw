# Effective-risk escalation observability (owner roadmap item 5)

**Date:** 2026-07-02 · **Status:** APPROVED (maintainer, per MAINTAINER.md mandate)
**Feeds:** roadmap items 1 (policy tuning evidence) and 3 (calibration corpus).

## Problem

The persisted risk score composes four layers — server heuristic, org
risk-templates, client-reported score, predictive adjustment — and the
`guard_decisions.context._risk_breakdown` ledger (supergoal P4) decomposes
them. Item 3's forensics on the June "risk 100" incident proved the ledger
works but exposed four residual gaps, two observability and two calibration:

1. **FK-path lift bug (observability).** `listGuardDecisions` lifts
   `context->'_risk_breakdown'` to a top-level `risk_breakdown` column, but
   `getGuardDecisionById` (the modern, exact FK path used by
   `getActionWithRelations`) does not. `RiskBreakdownPanel` guards on the
   top-level field, so on the preferred path it silently renders nothing —
   the breakdown exists in the blob and never reaches the human.
2. **LLM term is not decomposed (observability).** `_risk_breakdown.predictive`
   records only the *summed* adjustment plus statistical fields. Item 3 had to
   infer "+5 velocity + 15 LLM" by subtraction. The LLM's own adjustment,
   model, and reasoning are computed (`LlmRiskAssessment`) and then dropped.
3. **Velocity flat tax (calibration).** `computeStatisticalAdjustment` adds +5
   whenever `recent_count > 5` (last hour), independent of `failure_rate` —
   a permanent tax on exactly the healthiest, most active agents
   (`failure_rate: 0` over thousands of actions in the June specimens).
4. **Client score recruits the LLM amplifier (calibration).**
   `getPredictiveRisk` consults the LLM when `effective + statistical ≥
   threshold`, and `effective` is `max(server, template, client)`. A
   false-high client score (the blunt 70 fallback) therefore drags in an
   amplifier that can add up to +20 — June specimens: client 70 + velocity 5
   + LLM 15 ⇒ 90–100 on read-only commands.

## Decisions

### (a) Velocity is an amplifier of demonstrated failure, never a standalone signal

`+5` applies only when `recent_count > 5` **and** `failure_rate > 0.25` —
i.e. only when a failure-rate prior already fired. Semantics: "failing, and
failing fast." Rationale:

- MAINTAINER.md's core metric is precision of interruption; a flat tax on
  clean high-velocity agents is the exact anti-pattern (it helped produce the
  false "risk 100" blocks that got all org policies disabled in June).
- Raw-velocity / runaway protection is already owned by the `rate_limit`
  policy, which counts ALL actions regardless of risk. The predictive layer
  duplicating that as an unlabeled score tax adds no protection, only noise.
- The cold-start `+5` (`basis: 'no_history'`) is untouched — unknown
  territory remains a legitimate prior.

### (b) The LLM amplifier is triggered by server-side evidence only

The consult condition becomes `serverEvidence + statistical ≥ threshold`
where `serverEvidence = max(server_total, template.score)` — the
client-reported term is excluded from the *trigger* (it still max-folds into
the effective/final score exactly as before). Rationale:

- The client score is self-reported and fallback-prone; it may raise the
  final score (that asymmetry is by design — an agent declaring danger is
  believed) but must not recruit an escalation amplifier.
- The LLM sees only (agent, action_type) history — never the command — so it
  cannot *correct* a false-high client score with new information; empirically
  it amplified (+15 on the June specimens). ±20 of noise conditioned on a
  false positive is strictly harmful.
- Server terms and templates are org-controlled evidence; crossing the
  threshold on those legitimately warrants the expensive layer.

### Observability closures

- `getGuardDecisionById` selects `context->'_risk_breakdown' AS
  risk_breakdown`, matching `listGuardDecisions`, so `getActionWithRelations`
  exposes it and the panel renders on the FK path.
- `RiskBreakdown.predictive` gains additive keys: `velocity`,
  `statistical_adjustment`, and `llm: { adjustment, model, reasoning } | null`.
  Existing keys keep their meaning (`adjustment` stays the total). Additive
  jsonb only — no migration, old rows render as before.
- `RiskBreakdownPanel` renders the history prior and the LLM assessment as
  separate rows (LLM row shows the signed adjustment, model, and reasoning).
- `/replay/[actionId]` (public story card) gets a compact one-line
  composition strip under the risk chip: `server N · template N · agent N ·
  history ±N · LLM ±N → final N`, rendered only when a breakdown exists.

## Acceptance

- **Unit (pins the calibration decisions):** `predictive-risk` tests —
  clean-history high velocity ⇒ statistical adjustment 0; failing + fast ⇒
  15/10 + 5 stacked; LLM **not** consulted when server evidence is below
  threshold even with client-inflated effective (June-specimen shape,
  provider mocked, asserts zero calls); LLM consulted when server evidence
  crosses threshold; breakdown carries the llm decomposition.
- **Smoke (proves the claim live):** new I-block — `POST /api/guard?record=true`
  then `GET /api/actions/:id` returns `guard_decision.risk_breakdown` with the
  composition keys (base/server_total/effective/final). This is the
  "explainable in one glance" claim pinned end-to-end.
- **Rendered proof (UI-discoverability gate):** frontend-verify confirms the
  panel renders on `/decisions/[actionId]` (FK path) and the composition strip
  renders on `/replay/[actionId]`. Click path: /decisions ledger → "View full
  decision record" → panel; replay links from the decision detail.
- Gates: lint, typecheck, FULL vitest, next build, contract checks.

## Non-goals

- No change to policy evaluation, decision vocabulary, or the max-fold of the
  client score into effective/final (constitution-adjacent semantics stay).
- No golden-vector schema change: the fixture pins the two base scorers; the
  predictive layer is pinned by its unit suite (stated decision).
- No /explain rework (static illustrative simulator stays as labeled).
