# RFC: External Policy Verdict Input at the Guard Seam

- **Status:** PROPOSED, demand-gated (design only — build starts when a concrete first integrator commits to wiring a real provider against a real agent workload)
- **Date:** 2026-08-13
- **Origin:** [issue #219](https://github.com/ucsandman/DashClaw/issues/219) (Kevin Knapp) — accepted design shape, scoped down
- **Why an RFC and not a spec:** it freezes a wire contract other vendors would build against. Contracts that outside parties depend on get decided in the open before code exists.

---

## 1. Summary

An org can configure one optional **external decision provider**. During the
guard's Decide step, DashClaw calls it with the evaluated act, receives a
verdict, and joins that verdict with the local guard result using a
**monotonic, stricter-wins join**. The external authority can tighten the
effective decision. It can never loosen it, and the local guard can never
loosen the external authority's `deny`.

DashClaw stays what it is: intercept, decide, approve, prove. It does not
become a policy decision point for anyone else, and it does not grow a second
policy language. It becomes usable as the **enforcement and approval endpoint**
for engines that are good at deciding and have no interception, approval UX,
or execution-witness posture of their own.

---

## 2. The join

Verdict lattice, already ordered this way everywhere in the guard:

```text
allow < warn < require_approval < block
```

Provider verdicts map:

```text
allow    -> allow
warn     -> warn
escalate -> require_approval
deny     -> block
```

Effective decision = the **stricter** of (local, mapped-external). Examples:

```text
local block            + external allow    -> block
local allow            + external deny     -> block
local allow            + external escalate -> require_approval
local require_approval + external allow    -> require_approval
```

This is not a new idea in the codebase, it is the native idiom promoted to a
contract. Precedents in `app/lib/guard/evaluate.ts`: a block reason always
outranks a policy outcome; an operator "no" outranks everything; risk composes
as `max(server, client)`. The join adds one more input to a lattice that
already only moves in the strict direction.

**Hard invariants:**

- **E1 — Monotonicity.** Neither authority's `allow` may downgrade the other's
  stricter verdict. No configuration can disable this.
- **E2 — External `deny` is absolute for the evaluated act.** No local grant,
  approval, or calibration state overrides it.
- **E3 — Identity binding.** The provider's verdict carries an
  `input_identity` hash of the evaluated act. A verdict whose identity does
  not match the act being decided is discarded and recorded as a posture
  failure, so an approval can never drift onto a different act.

---

## 3. Wire contract (v1)

Request: the same act shape the guard already evaluates (action_type, act,
declared_goal, agent identity, org id), plus a request id. Response:

```json
{
  "decision": "allow | warn | escalate | deny",
  "reason": "stable_reason_code",
  "policy_source": "configured-provider-id",
  "policy_version": "opaque-version",
  "input_identity": "sha256:...",
  "evidence": {}
}
```

Deliberately excluded from v1: policy-target transformation, provider-supplied
risk scores, provider-supplied grants, batching, streaming. A verdict and its
provenance, nothing else.

---

## 4. Failure posture

The provider call runs inside the guard hot path, so it follows the pattern
the budgeted LLM call already set (`llmBudgetMs` with a safety margin in
`evaluate.ts`): hard timeout, bounded budget, never able to hang a decision.

Unavailability (timeout, non-2xx, malformed response, identity mismatch) takes
an **explicit configured posture** per org:

- `fail_closed` — treat as `require_approval` (default)
- `fail_open` — proceed local-only

Either way the outcome is recorded as what it is. An unavailable provider
never masquerades as successful external governance: the decision evidence and
the UI both say `external_unavailable`, not `allow`.

The provider URL is fetched through `app/lib/url-safety.js` like every other
configured outbound host.

---

## 5. Evidence and provenance

A `_external_verdict` sibling key in `guard_decisions.breakdown`, following
`_calibration` / `_plan_grant` / `_timings`: provider id, policy_version, raw
and mapped verdict, reason code, input_identity, latency, posture. Sibling,
never inside the hashed score vector — same rule score provenance already
follows.

Existing execution-witness and liveness semantics are untouched: they continue
to prove whether the *joined* decision was actually enforced, which is the
whole point of being someone's enforcement endpoint.

---

## 6. Human surface

Per `HUMAN-EXPERIENCE.md`, this ships with its surfaces or not at all:

- **Configuration** is a form in the policy workbench (`/policies`): provider
  URL, auth, timeout, unavailability posture, enable toggle. No env-var-only
  configuration.
- **Posture visibility:** decision detail and `/approvals` rows show which
  regime produced the verdict — `local-only`, `external+local`, or
  `external unavailable` — not just the final answer. An operator approving a
  `require_approval` that came from an external `escalate` sees that is why
  they were asked.

## 7. Surface budget cost

Zero new API routes (config rides the existing org-settings path), zero new
SDK methods, zero new MCP tools, zero new policy types (this is org
configuration, not a policy row). New table or settings columns for provider
config: tables are not a budgeted surface. The budget gate stays untouched,
which is part of why the small version is acceptable at all.

---

## 8. The demand gate

This RFC is accepted design, not scheduled work. Building an interoperability
seam with no confirmed counterpart is the exact speculative-surface pattern
the anti-regrowth brake exists to stop. The build starts when one named
external engine (ACS-shaped or otherwise) and one real agent workload commit
to wiring up against this contract. Issue #219 is where that hand gets raised.

## 9. Non-goals

Inherited from the issue and kept: no Microsoft AGT dependency, no ACS
implementation, no new DashClaw policy language, no enterprise RBAC expansion,
no universal policy-decision-point ambitions, no weakening of the `block`
invariant, no claiming an external verdict is enforcement before DashClaw
enforces it at a mechanical seam.

Additionally out of scope for v1:

- **The precedent/context provider** from the issue's follow-up comment
  ("why was a materially similar action approved before"). It is a context
  input rather than a verdict, it overlaps the calibration controller, and it
  raises its own provenance problems (automatic allows must never become
  approval history that justifies further loosening). Worth its own RFC if
  the verdict seam proves out. Its safety invariant is adopted here for the
  record: **prior approval is evidence, not standing authority.**
- Multiple simultaneous providers. One per org until someone real needs two.
