# Assumption-Invalidation Notifications (Advocate v2a) — Design

**Date:** 2026-07-02
**Roadmap:** owner-roadmap v2.4 (spec-first)
**Status:** Ratified — invalidators, transport, and mid-task semantics chosen by Wes 2026-07-02.

## Problem

The assumption ledger is the agent's alibi, but today it is write-only during a
task. When an operator marks an assumption false mid-task, the agent that
recorded it never hears about it and may keep acting on a premise a human has
already rejected. The advocate story ("what protected this agent, what it
declared, what it assumed") needs the return channel: the agent should hear
about an invalidation *before it acts again*, not discover it in a retro.

## Ratified decisions

1. **Who can invalidate:** operator only. The trigger is the existing
   `PATCH /api/assumptions/[assumptionId]` with `validated: false` +
   `invalidated_reason` (context menu on `/assumptions`, or direct API call).
   Automated contradiction detection and peer-agent invalidation are out of
   scope for v2a.
2. **Transport:** inbox message + guard-response advisory. The inbox message is
   the durable record; the guard `POST` response carries an `assumption_alerts`
   sibling field (parallel to `secret_scan`) that the pretool hook prints on
   the agent's next governed action.
3. **"Mid-task" for non-resident agents:** until acknowledged. The advisory
   rides every guard call until the alert's inbox message is marked read.
   There is no wall-clock, session-status, or presence gating — a non-resident
   agent hears it on its very next governed action, whenever that is.

## Architecture

No new tables. The `agent_messages` row IS the notification record and its
read state IS the acknowledgment.

```
operator PATCH validated:false
        │
        ▼
assumptions route ──▶ agent_messages insert (message_type: assumption_invalidated,
        │             to_agent_id = parent action's agent_id, JSON directive body)
        │             + MESSAGE_CREATED org event
        ▼
guard POST (agent or family) ──▶ unread assumption_invalidated messages?
        │                              │ yes (rare)
        ▼                              ▼
   normal decision          + assumption_alerts: [...] sibling field
                                       │
                                       ▼
                       pretool hook prints advisory, PATCHes mark-read (ack)
```

### 1. Notify on invalidate

`app/api/assumptions/[assumptionId]/route.ts`, the `validated: false` branch
only, after the invalidation write succeeds:

- Resolve the owning agent: assumption → `action_id` → `action_records.agent_id`.
  If the parent action has no `agent_id`, skip notification (nothing to notify).
- Insert one `agent_messages` row via the messages repository (not raw SQL):
  - `to_agent_id`: the owning agent (direct message, not broadcast).
  - `from_agent_id`: the operator/system sender identity used by existing
    system-originated messages (follow the pairing-request precedent).
  - `message_type`: `assumption_invalidated` (new type value).
  - `subject`: `Assumption invalidated: <first ~80 chars>`.
  - `body`: JSON directive
    `{ assumption_id, assumption, invalidated_reason, action_id, invalidated_at }`
    (all already DLP-redacted upstream by the PATCH route).
- Publish the existing `MESSAGE_CREATED` org event.
- Idempotency is free: the PATCH route 409s on double-invalidation (existing
  `gateInvalidated` compare-and-set), so at most one message per assumption.
- Notification failure must not fail the invalidation: the PATCH result is the
  source of truth; message-insert errors are logged and surfaced as a
  `notification_error` field on the PATCH response, never a 5xx.

### 2. Guard advisory

`app/api/guard/route.ts` POST, after the decision is computed:

- Look up unread `assumption_invalidated` messages addressed to the calling
  `agent_id`, including the identity-family base fallback (same matching
  semantics targeted policies use, so a parent hears about a subagent-family
  assumption and vice versa per the v2.2 identity model).
- Attach `assumption_alerts` (newest 3, bounded) as a sibling field:

```json
"assumption_alerts": [
  {
    "message_id": "msg_…",
    "assumption_id": "asm_…",
    "assumption": "…",
    "invalidated_reason": "…",
    "action_id": "act_…",
    "invalidated_at": "…"
  }
]
```

- **Hot-path discipline (v2.1 lesson):** advisory-only — it can never change
  the decision, add latency-visible work, or recruit an LLM. The lookup is one
  bounded indexed query; a 30s per-instance negative cache ("agent X has no
  alerts") keeps the common path free. Cache is invalidated locally on
  invalidation writes; cross-instance staleness of ≤30s is acceptable for an
  advisory. Field is attached on all guard POSTs with an identified agent,
  `record=true` or not.

### 3. Hook surfacing + acknowledgment

`hooks/dashclaw_pretool.py`:

- New `_warn_assumption_alerts(guard_resp)` mirroring `_warn_secret_scan`:
  prints even on `allow`, never blocks, e.g.
  `⚠ Operator invalidated an assumption you recorded: "<text>" — reason: <reason>. Re-verify before relying on it.`
  One line per alert (max 3).
- After printing, the hook acknowledges: one `PATCH /api/messages`
  `{ message_ids, action: 'read', agent_id }` call. This extra HTTP call is
  **conditional on alerts being present** (rare), so the pretool
  single-HTTP-call rule holds on the common path. Ack failure is fail-silent
  (the alert simply rides again next call — the semantics degrade to nagging,
  never to loss).
- Non-hook consumers: SDK `guard()` and MCP `dashclaw_guard` return the raw
  response, so `assumption_alerts` flows through with zero SDK changes; those
  agents ack via the existing `dashclaw_messages_mark_read` / SDK mark-read.
  The MCP guard tool's text rendering should include the alerts when present.

### 4. Human-visible surface

- `/assumptions`: invalidated rows get a delivery chip — **"agent notified —
  unread"** / **"acknowledged"** — derived server-side by joining the
  notification message's read state onto the existing drift-list query. Click
  path exists today: sidebar → Assumptions → invalidated card.
- `/messages`: the new `assumption_invalidated` type renders under the
  existing server-param chip model (add the chip; chips map to SERVER params).
- No new pages.

## Out of scope (explicit)

- Automated contradiction detection (system-initiated invalidation) — needs
  its own engine and false-positive budget; candidate for a later item.
- Peer-agent invalidation.
- Re-opening / un-invalidating an assumption (no such verb exists today).
- Push transports (webhooks, SSE-to-agent); polling + guard-ride only.
- New SDK methods — the guard response field and existing inbox/mark-read
  surface cover both SDKs as-is.

## Error handling

- Message insert failure on invalidate: log + `notification_error` on the
  PATCH response; invalidation itself still succeeds.
- Guard alert lookup failure: swallow to the advisory's absence (guard
  decision must never fail because an advisory query broke); increment nothing
  on the hot path, log server-side.
- Hook ack failure: fail-silent; alert re-rides.

## Verification

- **Unit:** assumptions PATCH route (message created exactly once, correct
  directive body, no message on validate:true, `notification_error` path);
  guard route (alerts attached for exact + family match, bounded at 3, absent
  when none/unread none, decision unchanged); messages repository addition.
- **Policy smoke (live):** seeded scenario — record action + assumption →
  operator PATCH invalidate → assert inbox message exists → guard POST returns
  `assumption_alerts` → mark read → guard POST returns none. Smoke count grows
  from 67.
- **Hook:** vector/unit for `_warn_assumption_alerts` (prints on allow, ack
  call fires only when alerts present).
- **UI:** `/assumptions` delivery chip and `/messages` chip verified rendered
  (frontend-verify), per the feature-visibility gate.
- **Gates:** full `npx vitest run`, `npm run lint`, `npx next build`,
  `npm run typecheck` (TS files change), doc-count check (message types /
  smoke counts cited anywhere), CHANGELOG + maintainer-log entries.
