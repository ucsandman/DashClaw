# Guard-deadline noise: instrument, diagnose, fix (roadmap v2.1)

Status: DRAFT → ratified by ship. Owner roadmap: `docs/plans/owner-roadmap.md` §v2.1.

## Problem

The guard evaluation self-bounds at `DEFAULT_GUARD_DEADLINE_MS` (3500ms,
`app/lib/guard.ts`) inside the hook's 5s HTTP budget. When the deadline
fires, the decision degrades to `require_approval` (fail-closed default).
Every degraded `require_approval` is a false interruption: the item-2 live
audit counted at least 2 of ~10 real interruptions that day as
deadline-degradations on mundane file edits.

Measured baseline (Neon instance, 30 days to 2026-07-02):

- 142 degraded decisions out of 82,369 (0.17% overall — but 9.4% on
  2026-06-30, a low-traffic day: 8 of 85, the cold-start signature; and 26
  on 2026-07-02 during active bursts).
- Every sampled degraded row: `decision=require_approval`,
  `matched_policies=[]` — an interruption with **zero policy
  justification**, hitting the real `codex` agent.
- Degradation is only detectable via `reason ILIKE '%exceeded deadline%'`.
  A fail-open degradation (`DASHCLAW_GUARD_FALLBACK=allow`) leaves **no
  persisted trace at all** (warning only, and `warnings` is not a column).
- No per-phase timing exists anywhere: we cannot say which sub-evaluation
  (policy load, risk templates, predictive, rate-limit counts, pgvector,
  LLM semantic check, webhooks, grants) eats the budget.
- Item-1 proposal evidence (`getDecisionMixByPolicy`,
  `getApprovalOutcomesByPolicy` in
  `app/lib/repositories/policy-tuning.repository.ts`) does not filter
  degraded rows; a degraded `require_approval` pollutes fired counts and
  override rates exactly like a real interruption.

## Design decisions

### D1 — first-class degradation marker (column, not string matching)

`guard_decisions.context` is a TEXT column; JSON-path predicates in the
aggregation queries would cast every row. Degradation is a first-class
governance concept, so it gets a real column:

- `guard_decisions.degraded` boolean NOT NULL DEFAULT false
  (drizzle/0037). True for any decision finalized off a degradation path
  (the global deadline race today; the shape leaves room for the
  per-policy degradation call sites — webhook timeout, semantic fallback,
  x402 sum failure — to opt in later if we ever need them aggregated).
- Detail goes in `context._degraded` (sibling of `_risk_breakdown` /
  `_shields`, same established pattern; `act_hash` is client-supplied so
  context siblings never touch the hashed vector):
  `{ kind: 'deadline', deadline_ms, action, phase_in_flight }`.
- The fail-open path (`allow`) sets the column and the sibling too —
  closing today's zero-trace hole.
- Historical rows predate the column; any query that must include them
  uses `(gd.degraded OR gd.reason ILIKE '%exceeded deadline%')`.

### D2 — per-phase timings on every decision

`runEvaluation()` runs its phases sequentially; each phase gets a
monotonic timer accumulated into the evaluation accumulator and persisted
as `context._timings` (ms, integers):
`{ policies, risk, predictive, local_policies, webhooks, grants, signals,
total }` (the prompt-injection scan is synchronous and in-process — not
timed) — ~100 bytes/row, persisted on **every**
decision so steady-state baselines exist, not just failures. On a
deadline, the phase still in flight is recorded in
`_degraded.phase_in_flight` (the timer snapshot tells us how far it got).

### D3 — proposal evidence excludes degraded rows

`getDecisionMixByPolicy` and `getApprovalOutcomesByPolicy` add
`AND NOT gd.degraded AND (gd.reason IS NULL OR gd.reason NOT ILIKE
'%exceeded deadline%')`. A degraded require_approval is latency's fault,
not the policy's — proposals must not learn from it. The proposals GET
also returns a `degradation` summary (D4) so the exclusion is labeled,
not silent.

### D4 — surface where policy owners already look

`GET /api/policies/proposals` gains a `degradation` block from a new
repository fn (`getDegradationStats`): `{ window_days, degraded, total,
rate, last_degraded_at, by_day: [{day, degraded, total}] }` — same `?days`
window as the evidence queries, so the rate shown describes exactly the
rows the proposals excluded. The /policies cockpit
renders it as a compact stat strip next to TuningProposals: rate, count,
last occurrence, and the "degraded decisions are excluded from proposal
evidence" label. Quiet when zero.

### D5 — diagnosis is a script over live data, not memory

`scripts/diagnose-guard-deadline.mjs` (mirrors
`diagnose-cost-attribution.mjs`): per-day degradation rates, per-phase
timing percentiles (p50/p95/max) from `_timings`, degraded-row phase
attribution, and a cold-start heuristic (minutes since the org's previous
decision). Runs against whatever `DATABASE_URL` resolves (hosted or
local).

### D6 — fix ranked by evidence, applied in this ship where proven

Candidates, in order of expected value; the timing data decides:

1. **Parallelize independent read phases.** Policy load, risk-template
   assessment, and predictive risk are independent reads executed
   sequentially today; `Promise.all` them. Zero behavior change, pure
   latency cut.
2. **Bound the unboundable.** `runWebhookPolicies` HTTP calls honor their
   own per-call timeout but the phase has no cap relative to the
   remaining deadline budget; give late phases a "remaining budget" guard
   so a slow early phase doesn't guarantee a degraded decision.
3. Cache widening / deadline tuning — only if 1–2 prove insufficient.

## Diagnosis results (2026-07-02, live data + instrumented runs)

- Degradations began exactly 2026-06-12 — the day the deadline itself
  shipped (organ-3 phase 1). Not a regression: slow evaluations predate it
  and previously bricked hooks invisibly; the deadline made them visible.
- Cold start refuted: median gap since the org's previous decision for
  degraded rows is 0.3 minutes; only 2% follow a ≥10-minute quiet gap.
- Instrumented runs (local server, same Neon DB): the `predictive` phase
  was 1.3–3.0s of every evaluation — ~90% of total; every other phase runs
  in ≤120ms (the 30s hot-path caches work).
- Root cause: the server heuristic scores `action_type: 'apply'` at base
  60 — exactly the default predictive LLM threshold. With
  `PREDICTIVE_RISK_ENABLED` on, **every mundane file edit recruited a
  1.2–3s LLM call** inside the 3500ms deadline. For a no-history agent the
  model provably returns adjustment 0 ("cannot assess") — pure latency and
  provider spend. (The historical-stats SQL itself executes in 21ms.)

**Fix applied (D6 candidates re-ranked by this evidence):**

1. Skip the LLM when the (agent, action_type) history is empty
   (`llm_skipped: 'no_history'`) — measured effect: predictive 1.3–3s →
   ~50ms, total ~150–320ms.
2. Bound the LLM by the remaining deadline budget minus a 600ms safety
   margin; skip when under `MIN_LLM_BUDGET_MS` (1200ms), race otherwise —
   a slow provider now yields `llm_skipped: 'timeout'` (statistical-only
   adjustment) instead of a degraded decision. Measured on the previously-
   degrading codex/apply path: totals 2.2–3.1s, zero degradations; fast
   LLM responses still land their adjustment.
3. Parallelizing the read phases (original candidate 1) was NOT needed —
   the caches already hold them at ~0ms; not applied.

Score semantics unchanged: no threshold, base-score, or adjustment change.
`llm_skipped` is persisted in `_risk_breakdown.predictive` so forensics
can distinguish "didn't trigger" from "triggered but skipped/bounded".

## Acceptance (from the roadmap)

- Degradation rate visible on a live surface (/policies cockpit).
- A previously-degrading path proven within budget live (post-deploy
  check via the diagnose script + a timed guard call).
- Policy smoke extended (degradation visibility claim).
- Proposal evidence excludes degraded decisions and says so.

## Out of scope

- Per-policy degradation aggregation for the webhook/semantic/x402
  degradation call sites (column shape supports it; nothing consumes it
  yet).
- Deadline auto-tuning; changing the 3500ms default without evidence.
