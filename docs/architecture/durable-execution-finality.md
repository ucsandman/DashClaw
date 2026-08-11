# Durable Execution Finality

**Status:** Draft spec — Phase 1 ready to implement
**Author:** Wes Sander
**Date:** 2026-05-13
**Issue:** [#105](https://github.com/ucsandman/DashClaw/issues/105)

## Problem

`action_records` answers *"what was approved"* — but not *"did it actually complete."* Once a decision is approved and an action begins, three downstream failure modes look identical from DashClaw's perspective:

- Action **completed** successfully (agent should not retry)
- Action **partially** completed (operator or agent must clean up)
- Confirmation was **lost** mid-flight (terminal state unknown)

Without terminal outcome tracking, agent retry logic can re-trigger already-executed actions. The gap is real and DashClaw-shaped: it sits at the boundary of governance, not orchestration.

## Goals

- Every approved action has exactly one terminal outcome, set by the agent or by a system sweep
- Retry-safe semantics: agents can query outcome before retrying any approved action
- DashClaw-native: implemented as primitives inside `action_records`, no new tables, no new services
- Backward compatible: actions without outcome reporting default to `pending` and age into `lost_confirmation` after a timeout

## Non-Goals

These were considered and explicitly rejected. They belong in adjacent projects, not DashClaw.

- **On-chain trail anchors (Base / Arbitrum / any L1 or L2).** DashClaw's audit integrity cannot depend on external chain availability, gas economics, RPC liveness, or chain-specific tooling. The "no crypto/web3" anti-reference in `.impeccable.md` is load-bearing.
- **Inter-project canonical key derivation specs.** Coordinating an `action_ref` derivation across DashClaw, SafeAgent, Mycelium Trails, or any other system would couple our schema evolution to external release cycles. Outcome tracking stays a self-contained DashClaw primitive.
- **External signing infrastructure for outcome receipts.** This overlaps with [#79](https://github.com/ucsandman/DashClaw/issues/79) Phase 2 JWKS verification, which is a separate concern. Outcome receipts here are trust-on-assertion within the existing API-key boundary — the same trust model as decision attribution today.
- **Distributed consensus across multi-instance DashClaw deployments.** Outcomes are per-instance. Federation, if it ever happens, is a different problem.

## Design

### State machine

Five terminal states on `action_records.outcome_status`:

| State | Meaning | Set by |
|---|---|---|
| `pending` | Approved, no outcome reported yet | Default on creation |
| `completed` | Finished successfully | Agent via `POST /api/actions/:id/outcome` |
| `partial` | Started, did not finish (downstream call mid-flight, file half-written, etc.) | Agent or operator |
| `failed` | Attempted but errored | Agent |
| `lost_confirmation` | Timeout exceeded, agent never reported | System sweep |

Transitions are **one-shot and immutable**:

```
pending ─→ completed
        ─→ partial
        ─→ failed
        ─→ lost_confirmation  (only by system sweep)
```

Once non-pending, the outcome is fixed. This is the audit-trail integrity property — outcomes are not editable retroactively. If a partial action later cleans up successfully, that's a *new* action record linked via `parent_action_id`, not an edit to the original outcome.

### Schema

Extend `action_records` directly. Avoids joins on the hot read path.

```sql
ALTER TABLE action_records
  ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome_status IN ('pending', 'completed', 'partial', 'failed', 'lost_confirmation')),
  ADD COLUMN outcome_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN outcome_summary TEXT,
  ADD COLUMN outcome_error TEXT,
  ADD COLUMN outcome_progress JSONB,
  ADD COLUMN idempotency_key TEXT;

CREATE INDEX action_records_pending_outcome_idx
  ON action_records (created_at)
  WHERE outcome_status = 'pending';

CREATE UNIQUE INDEX action_records_idempotency_idx
  ON action_records (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

The partial index on `pending` rows keeps the sweep cheap regardless of total volume. The conditional unique index lets `idempotency_key` be optional without forcing every row to carry one.

### API surface

**`POST /api/actions/:id/outcome`** — agent reports terminal state

Request body:
```json
{
  "status": "completed",
  "summary": "Deployed dashclaw 2.13.4 to production",
  "error_message": null,
  "progress": null
}
```

Validation rules:
- Action must exist and belong to the requesting org
- Current `outcome_status` MUST be `pending` (one-shot enforcement)
- `status` MUST be one of `completed`, `partial`, `failed` (clients cannot set `lost_confirmation`)
- `error_message` REQUIRED when `status=failed`
- `progress` REQUIRED when `status=partial`, must be valid JSON
- API key MUST have write scope

Response codes:
- `200` — outcome recorded
- `409` — outcome already terminal (`{"error": "outcome already set", "current_status": "completed"}`)
- `404` — action not found in this org
- `400` — invalid status or missing required fields

**`GET /api/actions/:id/outcome`** — query current state

Response:
```json
{
  "action_id": "act_7f3a2b",
  "status": "completed",
  "outcome_at": "2026-05-13T00:15:32Z",
  "summary": "Deployed dashclaw 2.13.4 to production",
  "error_message": null,
  "progress": null,
  "elapsed_ms": 4823
}
```

`elapsed_ms` is `outcome_at - created_at`, or `now - created_at` when still pending.

### Cron sweep

A new endpoint `/api/cron/outcome-sweep` is swept every 15 minutes by the GitHub Actions workflow `.github/workflows/outcome-sweep.yml` (cron `*/15 * * * *`), which hits the endpoint with `Authorization: Bearer $CRON_SECRET`. GitHub Actions — not Vercel cron — is the scheduler, because the project targets the Vercel Hobby (free) tier, which does not run scheduled functions; `vercel.json` therefore has no `crons` key. Operators on Vercel Pro could instead add a `crons` entry to `vercel.json`, and free-tier instances can also trigger the sweep manually from the admin UI. The per-row gate enforces idempotency, so cadence affects only how quickly `lost_confirmation` surfaces for stale rows, never correctness.

```sql
UPDATE action_records
SET outcome_status = 'lost_confirmation',
    outcome_at = NOW(),
    outcome_summary = 'No outcome reported within timeout window'
WHERE outcome_status = 'pending'
  AND created_at < NOW() - make_interval(mins => $1)
  AND (status IS NULL OR status NOT IN ('completed', 'failed', 'cancelled', 'blocked'))
RETURNING id, org_id;
```

The legacy-status guard on the last `WHERE` line matters. Existing integrations (the OpenClaw plugin's `after_tool_call`, the Claude Code `dashclaw_posttool.py` hook, every SDK consumer using `claw.updateOutcome(...)`) terminate actions by setting the lifecycle `status` column directly. They predate the durable-finality surface, so they leave `outcome_status='pending'` even when the action genuinely completed. Without the guard, every such action would re-sweep as `lost_confirmation` 15 minutes later, generating misleading signals and badges. The guard treats a terminal `status` as proof that the outcome was implicitly confirmed via the legacy path. Genuinely orphan actions (status `null`, `running`, `pending`, or `pending_approval`) still sweep as intended.

### Implicit outcome on legacy PATCH

`updateActionOutcome` (the repository function backing `PATCH /api/actions/:id`) also implicitly sets `outcome_status` when the caller transitions `status` to a terminal value AND `outcome_status` is still `pending`:

| Legacy `status` transition | Implicit `outcome_status` |
|---|---|
| `running` → `completed` | `completed` |
| `running` → `failed` | `failed` |
| `running` → `cancelled` | `failed` |
| `running` → `blocked` | `failed` |

The one-shot rule still applies: `outcome_status='pending'` gates the implicit set, so a successful `reportActionOutcome` call always wins over a later PATCH. Together with the sweep guard, this means legacy integrations get first-class durable-finality semantics for free — their PATCH terminations populate `outcome_status` automatically, the sweep skips them anyway, and an upstream retry-safe agent calling `getActionOutcome` sees the correct terminal state without code changes on the integration's side.

`cancelled` and `blocked` map to `failed` because both represent "the action did not successfully complete" from a retry-safety perspective. An agent re-trying after one of these states needs the same answer it would get for `failed`: yes, safe to retry; no, do not assume the underlying side effect happened.

### Implicit lifecycle close on outcome report

The mirror of the rule above, and for a long time the missing half of it. `setActionOutcome` (backing `POST /api/actions/:id/outcome`) also closes the lifecycle `status` column and stamps `timestamp_end`, so an agent that reports through the durable-finality surface does not leave a row claiming it is still running:

| Reported `outcome_status` | Implicit lifecycle `status` |
|---|---|
| `completed` | `completed` |
| `partial` | `failed` |
| `failed` | `failed` |
| `lost_confirmation` | `unknown` |

`partial` maps to `failed` for the same "did not successfully complete" reason `cancelled` and `blocked` map to a `failed` outcome in the table above; the nuance stays visible because the outcome badge still reads *Partial*.

Only a still-open lifecycle (`running`, `pending`, or NULL) is flipped — an already-terminal `status` wins, and `pending_approval` is left to the approvals expiry sweep. `timestamp_end` is set with `COALESCE`, so a caller-supplied end time is never overwritten.

Without this, a row that reported a terminal outcome was **permanently** inconsistent: the Decision Replay page rendered `RUNNING` beside a green *Completed* badge, the action counted as in-flight in the operations stats, and neither sweep UPDATE could heal it because both gate on `outcome_status` still being `pending` (primary) or `lost_confirmation` (backfill). The sweep's backfill now covers every terminal `outcome_status`, so pre-existing stuck rows reconcile on the next sweep — cron, or the lazy trigger on the actions list.

For each newly-marked row, the sweep emits a `signal.detected` realtime event of type `lost_confirmation`. Operators see it surface in `/mission-control` and `/operations` immediately, and webhook subscribers receive a payload.

Default timeout: **15 minutes** post-creation. Per-org override via the `DASHCLAW_OUTCOME_TIMEOUT_MINUTES` key in `settings` (allow-listed in `app/lib/repositories/settings.repository.js`). The cron clamps the resolved value to `[1, 1440]` minutes.

### Retry semantics

Canonical agent retry flow:

```python
outcome = dashclaw.actions.get_outcome(action_id)

match outcome.status:
    case "pending":            return WAIT          # still in flight
    case "completed":          return SKIP          # already executed, no-op
    case "failed":             return RETRY         # safe to retry
    case "lost_confirmation":  return RETRY         # safe to retry; presume not executed
    case "partial":            return CLEANUP_THEN_RETRY  # agent-specific recovery
```

`lost_confirmation` and `failed` are operationally equivalent for retry purposes: both mean "did not complete." They differ only in attribution (`failed` was reported by the agent, `lost_confirmation` was inferred by the system).

### Idempotency keys (paired primitive)

A common error mode adjacent to outcome tracking: the same logical action gets created twice when the first call's response is lost in transit. Idempotency keys solve this:

```
POST /api/actions
Body: { idempotency_key: "sha256(agent_id + action_type + scope + request_id)", ... }
```

If a row with the same `(org_id, idempotency_key)` already exists, the response returns that existing row instead of creating a duplicate. This makes the create-then-execute flow safe to retry the *create* phase even if outcome tracking isn't in use yet.

Agents derive keys from their own request context — DashClaw doesn't prescribe a format. Suggested pattern: hash whatever uniquely identifies the *intent* (not the timestamp). Reusing a key for a logically distinct action is the agent's bug, not DashClaw's.

### SDK surface

Node:
```js
await client.actions.reportOutcome(actionId, {
  status: 'completed',
  summary: 'Deployed v2.13.4'
});

const outcome = await client.actions.getOutcome(actionId);
```

Python (snake_case per `MEMORY.md`):
```python
client.actions.report_outcome(
  action_id,
  status='completed',
  summary='Deployed v2.13.4'
)

outcome = client.actions.get_outcome(action_id)
```

Convenience wrappers for the common cases (both SDKs):
```js
await client.actions.reportSuccess(actionId, summary);
await client.actions.reportFailure(actionId, errorMessage);
await client.actions.reportPartial(actionId, progressState);
```

## Implementation Plan

Five PRs, sequenced so each lands independently shippable.

### Phase 1: Schema + core API
- `drizzle/` migration: `ALTER TABLE action_records` per Schema section
- `app/lib/repositories/action.repository.js`: `getOutcome(actionId, orgId)`, `setOutcome(actionId, orgId, payload)` with one-shot enforcement
- `app/api/actions/[actionId]/outcome/route.js`: POST + GET handlers
- Unit tests covering: happy path, 409 on double-terminate, 404 cross-org, missing fields, invalid transitions
- Update `docs/api-inventory.md` and `docs/openapi/critical-stable.openapi.json`
- Update `app/docs/page.js` and `sdk/README.md` per the SDK Documentation Checklist

### Phase 2: Cron sweep + signal
- `app/api/cron/outcome-sweep/route.js`
- Vercel cron registration in `vercel.json`
- Emit `signal.detected` with `type: "lost_confirmation"` for each newly-marked row
- New webhook event type `lost_confirmation` (parallel to existing `cost_exceeded`, `stale_action`, etc.)
- Settings key: `outcome_timeout_minutes` (default 15)

### Phase 3: Node SDK
- `sdk/actions.js`: `reportOutcome`, `getOutcome`, three convenience wrappers
- `sdk/README.md` updates
- `docs/sdk-parity.md` method count bump
- Tests: integration against a local DashClaw instance

### Phase 4: Python SDK
- `sdk-python/dashclaw/actions.py`: same surface with snake_case
- `sdk-python/README.md` updates
- `docs/sdk-parity.md` parity matrix update
- Tests: integration via `pytest`

### Phase 5: Dashboard surfaces
- `/actions` page: filter by `outcome_status`, badge per row
- Action detail page: terminal state badge (success for completed, warning for partial, error for failed, neutral for lost_confirmation, pulsing for pending)
- `/operations/feed`: surface `lost_confirmation` signals in the live feed
- `/mission-control`: outcome counts in the instrument rail

### Phase 6 (optional): Idempotency keys
- Standalone PR — can ship independently of Phases 1-5
- Migration adds the conditional unique index from the Schema section
- `POST /api/actions` accepts and persists `idempotency_key`; returns existing row on duplicate within configurable window (default 24hr)
- SDK helper `actions.deriveIdempotencyKey({ agent_id, action_type, scope, request_id })` returning a SHA-256 hex digest

## Failure Modes & Mitigations

| Failure | Behavior | Mitigation |
|---|---|---|
| Agent crashes before reporting outcome | Action stays `pending` → swept to `lost_confirmation` after timeout | Sweep + dashboard signal surface it |
| DashClaw unreachable when agent tries to report | Agent SDK retries with exponential backoff; respects existing `DASHCLAW_GUARD_UNAVAILABLE_POLICY` if configured | Idempotent endpoint, safe to retry indefinitely |
| Two agents try to claim same action's outcome | Second POST returns 409 with current state | One-shot enforcement at the repository layer, not just the route |
| Sweep runs too aggressively, marks in-flight actions as lost | Per-org configurable timeout; default 15min is generous for typical agent actions | Operator can raise `outcome_timeout_minutes` per-org |
| Network partition during outcome report | Agent SDK retries with idempotency key on the create + same payload on the outcome | Same payload → same DB result, no duplication |
| Action legitimately runs longer than timeout | Agent posts `partial` with current progress to signal liveness; per-action override at creation (`outcome_timeout_override_minutes`) | Two-level escape hatch |

## Open Questions

1. **Should `partial` permit eventual transition to `completed`?**
   Current spec: no. Outcomes are immutable; the completion of a previously-partial action is a *new* action record linked via `parent_action_id`. Alternative: allow `partial → completed` transition for two-phase commit patterns. **Lean: keep immutable** unless a real two-phase use case emerges in the wild. The new-record approach preserves a cleaner audit trail.

2. **Default outcome timeout: 15min, 30min, 1hr?**
   Most agent actions complete in seconds. 15 min default gives generous slack for slow downstream calls. Self-host operators override per-org. **Lean: 15min default.**

3. **Sweep frequency: daily, hourly, or every 5 min?**
   Shipped: **daily** on Vercel Hobby (no Pro upcharge for higher cadence). Operators on Pro can flip `vercel.json` to `0 * * * *` for hourly. External operators (GitHub Actions, system cron) can hit the endpoint at any cadence with `Authorization: Bearer $CRON_SECRET`. The default 15-minute timeout still controls how *fresh* a row must be to remain pending — the sweep cadence only controls how long after that timeout the dashboard surfaces `lost_confirmation`.

4. **Should `lost_confirmation` trigger a webhook delivery by default?**
   Yes — it's an operational signal exactly analogous to `stale_action` (which exists today). Subscribers can opt out via `events: [...]` filtering. **Lean: yes, ship in Phase 2.**

5. **Long-running actions that legitimately exceed timeout** — should we ship per-action timeout overrides in Phase 1 or defer?
   **Lean: defer.** Phase 1 ships the primitive with org-level config; per-action override lands in a follow-up only if real demand emerges. Agents that run >15min are unusual and the workaround (post `partial` to reset) covers most cases.

## References

- [#105 — Durable execution finality](https://github.com/ucsandman/DashClaw/issues/105) — original gap surfacing this work
- [#79 — Agent identity layer](https://github.com/ucsandman/DashClaw/issues/79) — adjacent attribution concern, separate primitive, no dependency
- `app/lib/repositories/action.repository.js` — existing repository pattern to extend
- `app/lib/realtime.js` — signal emission pattern for the sweep
- `PROJECT_DETAILS.md` — system map; this work touches Core Runtime, not Extensions
- `.impeccable.md` — design context, especially the four anti-references

## Why this matters

The whole pitch of DashClaw is that agents can be governed because their decisions are interceptable, attributable, and auditable. Without terminal outcome tracking, "auditable" has a hole: the audit trail shows what was *approved* but not what *happened*. This spec closes that hole using primitives that already feel like the rest of DashClaw — same table, same auth model, same realtime signal layer, same SDK shape, zero new infrastructure.
