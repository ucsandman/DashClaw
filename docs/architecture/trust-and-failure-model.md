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

## D2 — Outage contract: one knob, one refined invariant

`DASHCLAW_GUARD_FALLBACK` governs **all** server-side degradation — the slow
path (evaluation deadline) and the fast path (DB/exception failure). The audit
invariant refines from "never return an unaudited decision" to:

> **An `allow` is never returned unaudited.**

A degraded `require_approval`/`block` on a dead database may be returned
without a ledger row — refusing an action needs no audit guarantee, and it
beats a 5xx. `FALLBACK=allow` therefore applies only where the audit write
still succeeds (the deadline path); a total persistence failure caps the
response at `require_approval` regardless of the knob. The client-side
`DASHCLAW_GUARD_UNAVAILABLE_POLICY` remains the contract for *unreachable*
servers (default: block). *(Fast-path fallback implementation: Phase 2.)*

## D3 — x402: pre-authorization + attestation of record, stated exactly

DashClaw authorizes and records spend *intent*; it does not observe
settlement. Settlement-receipt reconciliation is a possible future capability
requiring its own spec — not an implicit promise. Until then: product copy
says "spend authorization + attestation," never "payment validation"; the D1
price clamp closes under-declaration for known-priced endpoints; and money
columns migrate `REAL` → `numeric` before real payment volume. *(Copy sweep +
migration: Phase 2.)*

## D4 — Emergency halt is a click, and the button is honest

The org kill switch renders in Mission Control (HaltControl in the
CommandStrip: two-step confirm to halt with optional reason; full-width banner
with actor/reason/time and two-step Resume while halted; hidden for
non-admins). Because a HALT button that other warm lambdas ignore for 30
seconds would be a lie, the halt read uses a dedicated 3-second cache instead
of the 30-second settings cache: cross-instance propagation is bounded at
~3s, eager invalidation keeps the serving instance at 0s, and the guard hot
path stays at ≤1 halt query per org per 3s per instance. **Invariant: the
halt read is never served from the long settings cache.** *(Shipped:
v4.39.0.)*

## Phase 2 queue (decided, not yet implemented)

In order: D1 spend clamp + `REAL`→`numeric` migration + D3 copy sweep; D1
verified-identity gate for per-agent rules; D2 fast-path fallback coverage;
approval grants single-use + fingerprint-bound; `rate_limit` counts
`guard_decisions` (not `action_records`); doctor write-path canary; cross-org
isolation behavioral test suite.
