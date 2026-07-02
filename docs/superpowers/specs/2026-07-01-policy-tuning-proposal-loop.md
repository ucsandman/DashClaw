# Policy-tuning proposal loop — spec (owner roadmap item 1)

Status: APPROVED (maintainer, per MAINTAINER.md delegation) · 2026-07-01
Plan: built directly from this spec; protocol = spec → build → gates → live proof → main.

## Goal

Close the loop from guard outcomes back to policy configuration — with a human
ratifying every change (constitution §3). The system aggregates per-policy
interruption stats over a rolling window, derives rule-based proposals (no
LLM) that carry their evidence, and surfaces them in the /policies cockpit.
Accept = one click that PATCHes the policy through the existing route.
Dismiss = recorded with a reason. **Nothing auto-applies, ever.**

The product metric this serves: precision of interruption. A policy that
interrupts 40 times and gets approved 39 times is teaching humans to disable
governance; the loop makes that visible and makes the fix one ratified click.

## Constitution constraints (restated as requirements)

- §1/§2: proposals never touch `block` decisions retroactively and the engine
  never writes policies. The only write paths are the existing admin-gated
  `PATCH /api/policies` (accept) and a dismissal record (dismiss).
- §3: the engine PROPOSES; a human admin applies. No auto-apply code path
  exists — the proposals endpoint is read-only computation plus a
  dismissal-recording POST.

## Data model

### New join key: `action_records.guard_decision_id`

There is no link today between a guard decision and the approval that
resolved it (`guard_decisions.id` is `act_gd_*`; `action_records.action_id`
is minted separately; no FK — see posture.repository.ts:189-191). Which
policy required an approval lives only in `guard_decisions.matched_policies`.

- Migration: `ALTER TABLE action_records ADD COLUMN guard_decision_id text;`
  plus index `idx_action_records_org_guard_decision (org_id, guard_decision_id)
  WHERE guard_decision_id IS NOT NULL`. Schema.js updated in the same commit.
- Stamp site: `recordRunningAction` (app/api/guard/route.ts) — the one place
  both ids coexist. Every `?record=true` companion record gets the decision id.
- `POST /api/actions` additionally accepts an optional `guard_decision_id`
  string so SDK flows that record separately can supply it. Hardened per the
  2026-07-01 security review: the value must match the exact server format
  (`act_gd_` + 16 hex) AND resolve to a same-org `guard_decisions` row, else
  400 — tuning evidence can never point at foreign or nonexistent decisions.
  Optional, additive, no SDK changes required in v1.
- Evidence accrues going forward from ship. No backfill, no heuristic
  time-window correlation — a governance product does not guess its evidence.

### Approval outcome derivation (no new status values)

From `action_records` rows with `guard_decision_id IS NOT NULL`:

- **approved** — `approved_by IS NOT NULL` (set only by admin approval routes,
  only on ALLOW).
- **denied** — the deny marker written by `recordApproval`
  (status `failed` + HITL deny marker; exact predicate pinned in-build against
  actions.repository.ts and covered by a unit test).
- **pending** — `status = 'pending_approval'`. Reported but excluded from the
  override-rate denominator. (There is no expired/timed-out transition today;
  the stats surface must not invent one.)

**Override rate** (v1 definition): `approved / (approved + denied)` per
policy, over require_approval interruptions with resolved outcomes.

## Rolling window (settles handoff Q1a)

- Default **30 days**, configurable per request via `?days=` (integer,
  clamped 7–90), matching the `getDecisionCountsByPolicy(days=30)` convention.
- **Evidence window per policy = `max(now − days, policy.updated_at)`.**
  Config changes reset the evidence: after an accepted PATCH the old
  interruptions describe a policy that no longer exists, so they are excluded.
  This also prevents ratchet churn (accept 70→80 must not immediately
  re-propose 80→90 from stale rows).

## Stats + proposals endpoint

`GET /api/policies/proposals?days=30` (admin not required for GET; org-scoped
like the summary route) returns:

```json
{
  "window_days": 30,
  "policies": [
    {
      "policy_id": "gp_…", "name": "…", "policy_type": "risk_threshold",
      "active": true, "updated_at": "…",
      "window_started_at": "…",            // after updated_at clipping
      "fired": { "warn": 3, "require_approval": 40, "block": 2, "total": 45 },
      "approvals": { "approved": 39, "denied": 1, "pending": 0 },
      "override_rate": 0.975,
      "last_fired_at": "…"
    }
  ],
  "proposals": [ … ],
  "dismissed_count": 2
}
```

Proposal shape:

```json
{
  "id": "ptp_<sha256-16 of policy_id|rule|params>",   // stable fingerprint
  "rule": "raise_risk_threshold",
  "policy_id": "gp_…", "policy_name": "…", "policy_type": "risk_threshold",
  "severity": "actionable" | "informational",
  "title": "Raise risk threshold 70 → 80",
  "summary": "Interrupted 40× in 30 days; 39 approved, 1 denied (97.5% overridden).",
  "evidence": {
    "window_days": 30, "window_started_at": "…",
    "fired": { … }, "approvals": { … }, "override_rate": 0.975,
    "approved_risk_scores": { "min": 62, "p50": 71, "max": 79 }
  },
  "patch": { "rules": { "threshold": 80, "action": "require_approval" } }
}
```

`patch` is present only on actionable proposals and is the exact body the UI
sends to the existing `PATCH /api/policies` (merged over current rules —
untouched rule keys are preserved). Informational proposals have no patch.

Repository: new `app/lib/repositories/policy-tuning.repository.ts`
(mirrors policy-review.repository.ts) — two queries:

1. `getDecisionMixByPolicy(sql, orgId, days)` — unnest
   `matched_policies::jsonb` grouped by policy_id × decision (the
   getDecisionCountsByPolicy pattern, one extra GROUP BY column), windowed
   with `created_at::timestamptz > NOW() - make_interval(days => $n)`.
2. `getApprovalOutcomesByPolicy(sql, orgId, days)` — join `action_records`
   (guard_decision_id NOT NULL, windowed) to `guard_decisions`, unnest
   matched_policies, group by policy × outcome; also aggregate approved
   rows' `guard_decisions.risk_score` (min / percentile_cont(0.5) / max).

Per-policy `updated_at` clipping is applied in SQL (join guard_policies,
`created_at::timestamptz > GREATEST(window_start, updated_at)`).
Engine: `app/lib/policy-tuning/engine.ts` — **pure function**
`deriveProposals(policyStats, options) → Proposal[]`, table-driven rules,
fully unit-testable with no DB.

## Proposal rules (v1)

Thresholds live as exported constants in the engine (overridable via bounded
query params `?min_fired=`, `?min_resolved=` — clamped 1–100 — so the smoke
harness can exercise the loop with small seeded volumes; defaults hold in
production use).

| Rule | Applies to | Condition (within evidence window) | Output |
|---|---|---|---|
| `raise_risk_threshold` | `risk_threshold` policies with `rules.action = 'require_approval'` | fired ≥ 10 (min_fired), resolved ≥ 5 (min_resolved), override_rate ≥ 0.9 | actionable; `patch.rules.threshold = min(current + 10, 95)`; evidence includes approved risk-score min/p50/max |
| `keep_policy` | any policy type | fired ≥ 10, resolved ≥ 5, denial rate ≥ 0.8 | informational — "evidence it works"; no patch |
| `dead_policy` | any active policy | created > 60 days ago AND fired 0 times in the past 60 days (fixed 60d, not the request window) | informational — "never fired; still needed?"; no patch |

Explicit non-rules (v1): no tightening proposals (the ReviewFeed "Tighten"
verdict already covers that direction from warn evidence); no rate_limit
raising (insufficient outcome evidence semantics — revisit with data); no
proposals against `block`-action policies (blocks produce no approval
evidence by design — constitution §1).

## Dismissals (settles handoff Q1b)

Recorded in an org setting `policy_tuning_dismissed` (JSON object keyed by
proposal fingerprint), the exact pattern of `policy_review_dismissed` and
`APPROVAL_FLOOD_STATE_KEY` — no migration:

```json
{ "ptp_…": { "reason": "seasonal traffic, leave it", "by": "user_…", "at": "ISO" } }
```

- `POST /api/policies/proposals` — admin-only, body
  `{ "action": "dismiss", "proposal_id": "ptp_…", "reason": "…" }`
  (reason required, ≤500 chars). Also `{ "action": "undismiss", … }` for undo.
- Dismissed fingerprints are filtered out of the GET (still counted in
  `dismissed_count`). The fingerprint hashes the patch params, so if the
  evidence later implies a *different* proposal (e.g. 70→90), it resurfaces.
- Blob pruned on write: newest 200 entries, then by serialized size (≤9000
  chars) so the write never trips upsertSetting's 10k value cap.
- Accepts need no separate ledger: the PATCH itself is the record
  (POLICY_UPDATED event + `logActivity` audit line + `updated_at` reset,
  which retires the proposal's evidence window). Add `logActivity` to the
  dismiss POST for the audit trail.

## UI — /policies cockpit

New section component `app/policies/components/TuningProposals.tsx`,
rendered inside `PolicyCockpit` as a sibling of `ReviewFeed` (below it —
review answers "what interrupted you"; tuning answers "what should change").
Follows `.impeccable.md`: evidence over decoration, calm under pressure,
brand orange as signal only, tokens only (no hex), WCAG 2.1 AA.

- Card per proposal: title, plain-English evidence sentence, evidence
  detail line (counts + risk-score spread), then actions.
- **Accept** (actionable only): confirm-before-consequential-action exactly
  like ReviewFeed's Tighten (first click arms, second click fires) → sends
  `PATCH /api/policies` with `{ id, rules: merge(current, patch.rules) }` →
  optimistic removal + inline "applied" strip. Inline per-row error text on
  failure (`text-status-error`, role="alert") — no global toasts.
- **Dismiss**: expands a one-line reason input; POST dismiss; optimistic
  removal.
- Empty state: one calm line ("No tuning proposals — policies match how
  you're actually approving."). Zero proposals must look like health, not
  absence. Section hidden entirely when the org has no active policies.
- Loading skeleton + fails-loud error state matching cockpit conventions.
- Client lib: `app/policies/lib/proposalsClient.ts` (fetch + verdict post),
  mirroring modesClient/contractClient.

## Acceptance (live proof + tests)

Policy smoke harness (`scripts/policy-smoke.mjs`) — new claim block `T1`,
same isolation discipline (run-unique agent, agent-scoped policy, cleanup):

1. Create `risk_threshold` policy (threshold 60, action require_approval),
   agent-scoped.
2. Drive 3 guard calls `?record=true` with risk 75 → 3 pending approvals;
   approve each via `POST /api/approvals/[actionId]`.
3. `GET /api/policies/proposals?days=30&min_fired=3&min_resolved=3` →
   assert the per-policy stats row shows `require_approval: 3, approved: 3`
   and a `raise_risk_threshold` proposal with `patch.rules.threshold = 70`.
4. Assert nothing auto-applied: re-fetch the policy; rules unchanged.
5. Dismiss with a reason → GET no longer returns the proposal;
   `dismissed_count` incremented.
6. Accept path: PATCH the policy with the proposal's patch → re-fetch
   proposals → proposal gone (updated_at clipped the evidence window).
7. Cleanup deletes the policy (existing harness pattern).

Unit tests (vitest, `__tests__/unit/`):
- `policy-tuning-engine.test.ts` — pure-engine table: each rule fires/holds
  at boundary volumes and rates; fingerprint stability; patch merge
  preserves untouched rule keys; threshold cap at 95.
- `policy-tuning-repository.test.ts` — SQL windowing + unnest shape
  (createSqlMock conventions; count only real round-trips).
- `policies-proposals.route.test.ts` — GET shape, days/min clamping,
  admin gate on POST, dismiss/undismiss round-trip, reason required.
- Approval-outcome predicate test pinning the deny marker.

Gates: lint, FULL vitest, `next build` (app/** changed), typecheck (new .ts),
contract checks, doc-count sweep (`scripts/check-doc-counts.mjs --strict` —
route count grows by one), `npm run db:migrate` locally after the migration
lands (per project gotcha).

## Out of scope (v1)

- Tightening proposals from warn/deny evidence (ReviewFeed owns tightening).
- work_orders approval evidence (better-linked via `approval_action_id`, but
  a separate flow — fold in when the loop proves out).
- rate_limit raise proposals; x402 budget interactions (roadmap item 2).
- Backfill/heuristic correlation of pre-ship decisions to approvals.
- LLM anything.
