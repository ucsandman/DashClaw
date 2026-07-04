# Findings become proposals — the tightening direction (roadmap v3.2)

Date: 2026-07-03 · Status: DESIGN RATIFIED (shaping delegated by Wes 2026-07-03,
"this is your project — own it") · Roadmap: docs/plans/owner-roadmap.md v3.2

## Problem

The tuning-proposal engine (v1 item 1) only proposes *loosening* — its spec
explicitly deferred the tightening direction
(`app/lib/policy-tuning/engine.ts:251-257`: "no tightening (the review feed
owns that direction)"). Meanwhile posture's critical findings ("Ungoverned
high-risk action reached allow", pattern-collapsed in v3.1) are exactly
tightening evidence — rendered today as `review_incident` chores whose
`deepLink: '/decisions'` isn't even wired in the UI. The operator sees the
leak but the product never offers the one-click policy that would plug it.

## Design

### Evidence source (reuses v3.1 verbatim)

The same ungoverned-allow query posture uses
(`posture.repository.ts getRecentDecisions`): `guard_decisions` where
`decision='allow' AND risk_score>=50` in a trailing window, synthetic traffic
excluded via the shared calibration-mining predicates, grouped by
`(action_type, riskLevel bucket)` — the identical grouping that mints one
`review_incident` finding per pattern. `riskLevel` uses `bucketRiskScore`
(high = 50–74, critical = ≥75).

### Engine — pure, rule-based, no LLM

`app/lib/posture/tightening.ts` exports:

- `tighteningProposalId(actionType, riskLevel)` →
  `tp_<sha256("govern_ungoverned_allow\n<actionType>\n<riskLevel>") first 16 hex>`.
  Content-stable across windows (the cv_ pattern), independent of which
  decision ids populate the window.
- `deriveTighteningProposals(rows, activePolicies, opts)` → one rule:

  **`govern_ungoverned_allow`** — an (action_type × riskLevel) group with
  `observedCount >= minObserved` (default 3) proposes a policy governing the
  action type, **unless the pattern is already governed**: an active
  `require_approval` / `block_action_type` / `warn_action_type` policy whose
  `rules.action_types` contains the action type suppresses the proposal
  (this is also what retires a proposal after its own ratify — the loop
  closes through the policy, not through bookkeeping).

Proposal shape:

```ts
{
  id: 'tp_<16hex>',
  rule: 'govern_ungoverned_allow',
  action_type, risk_level,                  // the pattern
  finding_key: '<8hex>',                    // v3.1 stableKey — the posture finding this mirrors
  title: 'Govern "<action_type>" (<risk_level>-risk allows)',
  summary: '<N> ungoverned <risk_level>-risk "<action_type>" actions reached allow in <days> days',
  evidence: { window_days, observed_count, risk_min, risk_max,
              example_decision_ids: [...≤5] },   // guard_decisions ids (act_gd_*)
  patch: { name: '[Tightened] <action_type>',
           policy_type: 'require_approval',
           rules: { action_types: [action_type], _tightened: true } },
}
```

The patch shape is the **existing review-verdict "Tighten" shape**
(`app/api/policies/review/verdict/route.ts:112-123`) — already validated by
`validatePolicy`, already enforced by the guard, already understood by the
/policies list. `require_approval` (not `block`) because the evidence says
"this happened repeatedly and nobody was asked", not "this must never happen"
— the human can harden the created policy afterward.

### Persistence — the cv_ pattern, not the settings blob

`drizzle/0042_tightening_proposal_decisions.sql`: mirror of 0040 —
`(org_id, proposal_id)` unique, `decision` in {ratified, dismissed},
`snapshot jsonb`, `reason`, `decided_by`, `decided_at timestamptz`, plus
`policy_id` (set when ratify created the policy) and `finding_key` /
`action_type` / `risk_level` for cross-referencing. No forge step exists in
this family — ratify closes its own loop — so no `forged_at` equivalent.

### Route — `app/api/policies/tightening/route.ts`

- **GET** (org-scoped, any role): compute on read. Params: `?days` (1–90,
  default 7 — posture's incident window), and smoke-harness-only overrides
  `?min_observed=` and `?include_synthetic=1` (the tuning route's
  `?min_fired=` precedent; affects only this response, never posture).
  Response: `{ window_days, min_observed, synthetic_included,
  inputs: { decisions }, proposals: [...with status + decision], counts }`
  (as built: the synthetic exclusion happens in SQL before the LIMIT — the
  v3.1 lesson — so an excluded-count is not cheaply available and a
  `synthetic_included` flag is reported instead). Dismissed/ratified
  status joins from the decisions table by content-stable id; dismissed
  proposals stop re-proposing while the id is stable.
- **POST** (admin-only, snapshot validated by shape — the calibration
  precedent):
  - `ratify`: create the policy server-side via `insertPolicy`
    (active, org-wide), `invalidateGuardPolicyCache` + `publishOrgEvent`,
    record the decision with `policy_id`, and set the mirrored posture
    finding state to `resolved` (actor = ratifier, note names the policy).
    Atomic in effect: if the policy insert fails (409 on name conflict),
    no decision is recorded. Constitution §3 intact — the policy exists
    only because a human clicked Ratify; nothing auto-applies.
  - `dismiss`: reason required (≤500 chars, redacted via `redactAny`);
    records the judgment; the posture finding stays open (declining the
    proposed policy does not quiet the leak).
  - `undo`: deletes the judgment row only. A policy created by a prior
    ratify **stays** (it is a first-class policy now, managed at
    /policies); the response and UI say so truthfully.
  - Audit log: `tightening_proposal.{ratified|dismissed|undone}`,
    resourceType `tightening_proposal`.

Server-side ratify (vs tuning's client-fired PATCH) is a deliberate
deviation, chosen to avoid the partial state where the policy exists but the
judgment was never recorded (or vice versa).

### Cross-references (roadmap: "reference each other instead of duplicating")

- `review_incident` findings gain `fix.proposalId` (computed with the shared
  `tighteningProposalId` helper) and their fix keeps `deepLink: '/decisions'`
  for the evidence trail.
- /posture's ResolvePanel for `review_incident` findings renders a
  "Review tightening proposal →" link to `/policies#tightening` (fixing the
  dead-deepLink gap for this finding class).
- The proposal card links its example decisions to `/decisions` and shows
  the mirrored finding relationship; ratify resolves the finding.

### Human surface (HUMAN-EXPERIENCE.md)

1. **Where seen**: /policies — a "Tightening proposals" section between
   Tuning proposals and Calibration proposals in `PolicyCockpit`, anchor
   `#tightening`.
2. **Discoverable**: from /posture (every `review_incident` finding links
   here) and from the /policies page operators already review.
3. **Every human step a click**: Ratify… / Confirm — create policy;
   Dismiss… with reason; Undo. Zero terminal, zero GitHub.
4. **Verified rendered**: headless-browser proof of the section and the
   /posture link before ship.

### Demo mode

No demo handler (the calibration-proposals precedent — none of the
/policies proposal sections are demo-intercepted); the component degrades to
its error/empty state.

## Acceptance (from the roadmap, mechanized)

- Seeded ungoverned pattern produces the expected proposal in
  `scripts/policy-smoke.mjs` (new S block): S1 pattern mines with
  `?include_synthetic=1`; S2 the default GET never contains the synthetic
  pattern (v3.1's bar holds); S3 ratify → policy exists AND the same guard
  call now returns `require_approval` (round-trip proven live); S4 undo +
  cleanup. The seed picks a client risk score in [50, 74] strictly below any
  active org-wide `risk_threshold` policy's threshold so the seeded calls
  genuinely reach `allow`; if the org gates below 50 the block records a
  truthful skip.
- Unit: engine (grouping, min_observed, governed-suppression, stable ids,
  patch passes `validatePolicy`), repository CRUD, route contract,
  component, `findings.ts` proposalId pin.
- Rendered proof on /policies and /posture; full gates
  (lint / vitest / build / typecheck / db:migrate).

## Explicit non-goals

- No auto-apply of any policy (constitution §3).
- No LLM in the engine.
- No agent-scoped proposals in v1 of this rule (org-wide patterns only; the
  evidence groups by action_type, not agent — an agent-scoped variant can
  ride a later calibration of this rule).
- No resurrection-from-snapshot of aged-out proposals (calibration needs it
  because a human ratify leaves maintainer debt; here ratify closes the loop
  in the same request).
