# Act-content grant binding — the approval covers the act, not the sentence

Date: 2026-07-05. The remaining follow-up from the 2026-07-05 governance
security review (SECURITY.md carried it as a recorded limitation since
v4.62.0). Ships as its own release, per the review's disposition.

## The hole

The guard's operator-approval grant (drizzle/0045) binds a retry to
`agent_id` + exact `declared_goal` + `action_type` in a 15-minute
single-use window. None of those are the action's *parameters*: an agent
whose `deploy staging` was approved could retry with the same three
strings wrapped around a completely different command, and the grant would
cover it. Approve X, do Y.

## The fix, and why it moved server-side

The review sketched "both SDKs stamp `act_hash` on the pending record AND
the retry." Build-time recon found something better: since evidence-first
guard (v4.63.0), **both SDKs already send the same scrubbed `act` payload
on the guard call and on the pending-record create** (`runGoverned` /
`run_governed`). So the server computes the digest itself on both sides:

- **Stamp**: `createActionRecord` computes
  `act_content_hash = digestJson(data.act)` for every row created with an
  act (`app/lib/act-content-hash.ts`, reusing the one canonical-JSON
  digest path in `app/lib/integrity/canonicalize.ts`). A client-supplied
  hash is never trusted — a forged `act_content_hash` field in the body is
  ignored (pinned by test).
- **Match**: `applyOperatorApprovalGrant` recomputes the hash from the
  retry's own act and adds
  `AND (act_content_hash IS NULL OR act_content_hash = <retry hash>)` to
  the single-use consume. An act-stamped approval can only be consumed by
  a same-act retry; a NULL retry hash (no act) can never consume a stamped
  grant.

A server-computed digest beats an SDK stamp: an SDK-stamped hash is just
another client-declared field (stamp the hash of the act you'll claim,
run something else), while the server digest is bound to the exact act
object the operator's approval row was created from. The residual honesty
boundary is unchanged from evidence-first: the act itself is
client-reported; a lying *process* is only stopped by capability-registry
credential custody.

### Backward compatibility (binding tightens, never loosens)

Rows created without an act — legacy SDKs, the non-act creators
(capability invoke/test, work orders, x402) — carry a NULL stamp and keep
the v4.62.0 tuple match unchanged. `require_approval` stays fail-closed on
any lookup error, including a pre-0056 schema missing the column.

### Naming: `act_content_hash`, not `act_hash`

`act_hash` is already load-bearing on `guard_decisions`: it is the
issuer-minted JWT action-binding claim hash over the
`(action_type, target, declared_goal)` tuple (`app/lib/act-binding.ts`).
This feature digests the raw act payload and lives on `action_records`.
Distinct concept, distinct name; SECURITY.md's forward reference to
"`act_hash`" resolves to this column.

## The consistency bug found and fixed on the way

Since v4.63.0, the evidence fold may swap the evaluation onto the
evidence-derived `action_type` (declared/derived mismatch with higher
evidence risk). The guard `?record=true` path passes its context by
reference, so its pending rows persisted the **swapped** type — but
`POST /api/actions` evaluated on a shallow copy and persisted the
**declared** type. A retry re-runs the same fold and looks up the swapped
type, so SDK-created pending rows could never match the grant whenever the
swap fired. Fixed: `/api/actions` now persists the type the evaluation
actually ran under, consistent with `guard_decisions` and the guard-path
rows.

## Surfaces

- `drizzle/0056_act_content_grant_binding.sql` + the four schema mirrors
  (schema.js, action-records-runtime-schema.mjs, runtime-migration.json
  contract, setup/migrate DDL) — the DDL-drift gate pins them together.
- `app/lib/act-content-hash.ts` (new, shared by repository + guard evaluate
  without an import cycle).
- `app/lib/repositories/actions.repository.ts` — stamp + list projection.
  Insert position: directly BEFORE `created_by`, so every existing
  position-pinned test (`.at(-5)`…`.at(-1)`) is unchanged; the stamp is
  `.at(-6)`.
- `app/lib/guard/evaluate.ts` — grant predicate + `act-bound` marker in the
  decision warning.
- `app/api/actions/route.ts` — evaluated-type persistence (the consistency
  fix).
- MCP server 2.2.0: `dashclaw_record` gains an `act` input and forwards it
  (the MCP surface previously had NO path to carry the act into the pending
  row — `dashclaw_guard` took an act, `dashclaw_record` didn't).
- SDKs: **no source change** — both already send the scrubbed act on both
  calls, so binding is automatic for `runGoverned`/`run_governed` users.

## Human experience (the four questions)

1. **Where does a human SEE it?** `/approvals` — an act-stamped pending
   card shows an "Act-bound" badge next to "Awaiting Approval", with a
   plain-language tooltip: the approval covers exactly the recorded act; a
   different act re-queues. The consumed grant is also visible in the
   decision ledger: the guard decision's warning reads "Covered by
   operator approval act_… (approved by …, act-bound)".
2. **Is it discoverable?** The badge appears in the queue operators
   already work; no new page, no deep URL.
3. **Is every human step a CLICK?** The approver's role is unchanged —
   the same Allow/Deny buttons; the binding is automatic. Zero terminal
   steps.
4. **Was it verified rendered?** Yes — see verification below (rendered
   proof of the badge on a live pending row).

## Verification

- Unit: `__tests__/unit/act-content-grant-binding.test.js` (digest
  behavior, stamp, forged-hash rejection, position pins),
  `guard-operator-approval.test.ts` act-binding family (predicate, NULL
  semantics, act-bound warning), MCP `tools-guard.test.ts` record-act
  forwarding, DDL-drift gate.
- Live (policy-smoke AE): pending row stamps the hash → operator approves
  → retry with a DIFFERENT act (same tuple) stays `require_approval` and
  does not consume the grant → retry with the SAME act is allowed via
  `builtin:operator_approval`, marked act-bound.
- Gates: lint, full vitest, `next build`, typecheck.
