# Trust & Failure Model (ADR)

**Status:** Accepted 2026-07-03 · **Decided by:** Claude (maintainer), under the
MAINTAINER.md delegation · **Context:** the 2026-07-03 pre-implementation
architecture review (see `docs/maintainer-log.md`, v4.38.1 entry) surfaced four
design questions the codebase had been answering implicitly. This ADR answers
them explicitly. Change these decisions by superseding this file, not by
drifting from it.

## D1 — Descriptor trust: attestation by default, corroboration where the server knows the fact

Guard inputs (`action_type`, `systems_touched`, `reversible`, `declared_goal`,
`risk_score`, x402 `spend_amount`, `agent_id`) are **attestations** from an
authenticated caller. The threat model is drift, bugs, and prompt-injection in
cooperating agents — not a malicious holder of the org API key, who could
simply act without calling guard at all. The `max(server, client)` blend is a
**server-computed risk floor**, not "server-authoritative" fact-checking; docs
and code comments must not claim more than that.

Two corroborations are mandatory because the server already holds the fact:

1. **x402 spend clamp:** enforced spend = `max(declared spend_amount, resolved
   endpoint default_price)` when the endpoint is known. *(Queued: Phase 2.)*
2. **Verified identity for per-agent rules:** a per-agent DENY / allow-list /
   require_approval rule is enforceable only against a verified identity (JWT
   `sub` or registered signature). For unverified callers the rule fails
   closed (most-restrictive), never falls through to the org default.
   *(Queued: Phase 2.)*

Everything else stays attestation-plus-audit, and any surface that treats
`agent_id` as provenance (reputation, receipts, compliance evidence) must
carry `verification_status` alongside it.

## D2 — Outage contract: one knob, one hard audit gate

`DASHCLAW_GUARD_FALLBACK` governs **all** server-side degradation — the slow
path (evaluation deadline, `_degraded.kind: 'deadline'`) and the fast path
(any evaluation phase throwing before the deadline: policy load, risk read,
DB error — `_degraded.kind: 'error'`). Both paths produce the same
`resolveDegradedAction()` decision (per-policy override →
`DASHCLAW_GUARD_FALLBACK` → `require_approval`), persisted through the same
mandatory audit gate with a structured degradation marker.

The audit gate stays absolute, and is *stronger* than an earlier draft of
this ADR contemplated:

> **An unaudited decision is never returned — allow or otherwise.** When the
> ledger cannot record (persistence itself is down), the server refuses with
> an error (5xx), and the client-side `DASHCLAW_GUARD_UNAVAILABLE_POLICY`
> governs (default: block).

So the full contract is: degraded-but-recordable failures get a governed,
audited decision under one knob; unrecordable failures get an honest error
and the client policy. *(Shipped: v4.42.0. Pinned by
`guard-degradation.test.js` "fast evaluation failure joins the degradation
contract".)*

## D3 — x402: pre-authorization + attestation of record, stated exactly

DashClaw authorizes and records spend *intent*; it does not observe
settlement. Settlement-receipt reconciliation is a possible future capability
requiring its own spec — not an implicit promise. Until then: product copy
says "spend authorization + attestation," never "payment validation"; the D1
price clamp closes under-declaration for known-priced endpoints; and money
columns migrate `REAL` → `numeric` before real payment volume. *(Copy sweep +
migration: Phase 2.)*

## D4 — Emergency halt is a click, and the button is honest

The org kill switch is backed by `/api/halt` (two-step confirm to halt with
optional reason; full-width banner with actor/reason/time and two-step Resume
while halted; hidden for non-admins). **Note (2026-07-10):** the HaltControl
UI that rendered this in the CommandStrip lived on the Mission Control
dashboard, which was retired in the v5.0.0 cull — no current page renders
this control; verify before citing this section as a live human-operable
surface. Because a HALT button that other warm lambdas ignore for 30
seconds would be a lie, the halt read uses a dedicated 3-second cache instead
of the 30-second settings cache: cross-instance propagation is bounded at
~3s, eager invalidation keeps the serving instance at 0s, and the guard hot
path stays at ≤1 halt query per org per 3s per instance. **Invariant: the
halt read is never served from the long settings cache.** *(Shipped:
v4.39.0.)*

## Phase 2 queue (decided 2026-07-03; delivery stamped as it ships)

In order: D1 spend clamp + `REAL`→`numeric` migration + D3 copy sweep
*(shipped v4.40.0)*; D1 verified-identity gate for per-agent rules
*(v4.41.0)*; D2 fast-path fallback coverage *(v4.42.0)*; approval grants
single-use + fingerprint-bound and `rate_limit` counts `guard_decisions`
(not `action_records`) *(both v4.43.0)*; doctor write-path canary
*(v4.44.0 — live writes via the real repository writers under an isolated
canary org; a dead write path is a FAIL on /setup and /doctor)*; cross-org
isolation behavioral test suite *(shipped v4.45.0 —
`scripts/cross-org-smoke.mjs` seeds two run-unique orgs with DB-minted keys
and proves over live HTTP that neither can read, mutate, enumerate, approve,
or consume the other's governance resources across actions, assumptions,
loops, messages, handoffs, agents, guard decisions, policies, and approvals;
runs in CI on every push via the startup-smoke job's fresh Postgres)*.

Phase 2 queue: **complete.**
