# Trust & Failure Model (ADR)

**Status:** Accepted 2026-07-03 · **Decided by:** Claude (maintainer), under the
MAINTAINER.md delegation · **Context:** the 2026-07-03 pre-implementation
architecture review (see `docs/maintainer-log.md`, v4.38.1 entry) surfaced four
design questions the codebase had been answering implicitly. This ADR answers
them explicitly. Later sections stamp compatible boundary clarifications found
by implementation audits. Change these decisions by superseding this file, not
by drifting from it.

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

## D5 — Enforcement and execution claims: distinguish authority from effects

DashClaw has two enforcement classes. The Claude Code, Codex, and Hermes
PreToolUse hooks, the OpenClaw gateway, and `dashclaw_invoke` sit on an
execution seam and can mechanically stop or hold the operation they mediate.
The bare Node and Python SDKs, ordinary MCP tools, direct REST calls, and
desktop chat integrations are cooperative: they return and record governance,
but the integrating caller must keep the effect behind the verdict. An audit
row does not prove that a cooperative caller obeyed it. Mechanical hooks also
run at the governed process's privilege level; stronger tamper resistance is a
deployment boundary.

Protocol-1 execution claims narrow one approval to one newly authorized
attempt. Before releasing a non-blocked operation, a claim-aware path asks the
server to atomically bind the stored action, organization, agent, act hash, and
fresh attempt ID. The same transaction consumes any operator or plan authority
and permits only one winner. A rejected, lost, or malformed claim response does
not authorize execution and is never retried automatically.

This is an authority guarantee, not an exactly-once guarantee for an external
effect. Record idempotency deduplicates ledger rows. Outcome idempotency makes
the first terminal outcome write win. Neither can establish whether a payment,
deployment, message, or other remote effect completed before a response was
lost. Once an execution claim may have been consumed, an unknown result
requires reconciliation with the action and the external system, or the
external system's own idempotency primitive. It must not automatically receive
new execution authority.

Claim rollout is explicitly versioned:

- Current servers advertise `execution_claim_required: true` with
  `claim_protocol: 1`. Once advertised, missing, malformed, or unsupported
  claim fields fail closed. Claim acknowledgement must echo the exact action
  and attempt IDs.
- Current hooks and OpenClaw clients preserve their older guard and approval
  behavior when a legacy server omits the advertisement. That compatibility
  mode has no atomic one-attempt claim guarantee. Set
  `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` after the server upgrade to reject
  unadvertised responses as well.
- `runGoverned()` and `run_governed()` always require the claim endpoint before
  invoking their callback. Against an older server they stop with an execution
  claim error rather than running under the legacy contract. Lower-level SDK
  guard and record methods remain cooperative primitives.

`dashclaw_invoke` is the bounded server-mediated exception among MCP tools: the
server owns the registered credential, governance decision, claim, HTTP call,
and audit result. Other MCP calls do not become mechanically enforced merely
because they use the same transport. *(Clarified by the 2026-09-05 F04/F10/F46
audit remediation.)*

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
