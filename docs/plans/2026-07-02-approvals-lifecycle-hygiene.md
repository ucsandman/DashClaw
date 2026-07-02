# Approvals lifecycle hygiene (roadmap v2.3)

**Status:** shipped (v4.30.0) — 67/67 policy-smoke checks live incl. seeded
M1–M4; /approvals expired section verified rendered (frontend-verify)
**Audit finding (item-2 live audit, third finding):** approvals whose tool
calls had already hard-blocked (hook timeout) still sat pending; approving
them executed nothing and reported nothing.

## Problem

A pending approval is an `action_records` row with
`status='pending_approval'`. Today the only way out of that state is a human
clicking approve/deny in `/approvals`. The waiting client (Python pretool
hook: 30s; MCP `dashclaw_wait_for_approval` / Node SDK / Python SDK: 300s)
gives up client-side and hard-blocks, but the server row stays pending
forever. Approving it later flips it to `running` — a lie: nothing is
waiting, nothing runs. For x402 purchases it is worse: the paired
`x402_purchases` row stays `execution_status='pending'`, which the spend
predicates count (`execution_status <> 'failed'`), so dead approvals consume
budget indefinitely.

## Decisions

1. **Clients declare their wait window at request time.** New optional
   guard/action field `approval_wait_seconds` (integer, clamped 5..86400).
   The Python hook sends its `DASHCLAW_APPROVAL_TIMEOUT` (default 30), the
   MCP server and both SDKs send their default 300. Older clients send
   nothing.

2. **Expiry = wait window + retry grace.** On creating a
   `pending_approval` row the server stamps
   `approval_expires_at = now + approval_wait_seconds + 900s`.
   The 900s grace is deliberate and mirrors
   `OPERATOR_APPROVAL_WINDOW_MINUTES` (guard.ts): "operator approves after
   the hook timed out, agent retries the identical call" is a supported
   flow — expiring at the hook window alone would break it. Clients that
   don't declare a window get the conservative default
   `DASHCLAW_APPROVAL_DEFAULT_WAIT_SECONDS` (default 300) + grace.

3. **Expired is a first-class state**, value `'expired'` on
   `action_records.status`. Lazy expiry (pairing-flow precedent, no cron —
   Vercel free tier):
   - `GET /api/actions/[actionId]` self-heals an overdue pending row to
     `expired` before responding.
   - `GET /api/actions?status=pending_approval` runs a bounded sweep first
     so `/approvals` never lists dead rows as approvable.
   - `POST /api/approvals/[actionId]` (and bulk) checks expiry before
     approving.
   - Legacy rows (`approval_expires_at IS NULL`, created before this
     migration) expire when `created_at` is older than 24h — clears the
     audit's backlog without a backfill.

4. **Acting on an expired record is truthful.** `POST /api/approvals/...`
   on an expired row returns **410 Gone** with
   `"Approval expired: the requesting agent stopped waiting ... approving it
   can no longer release anything"`, and points at the retry path (agent
   re-asks → fresh approval). Distinct from 400 (never pending) and 409
   (race: resolved by another approver).

5. **x402 rides the same lifecycle.** When a `x402_purchase` action expires
   → paired `x402_purchases.execution_status = 'expired'`; when denied →
   `'denied'` (today deny leaves it `'pending'` forever). Spend predicates
   change from `<> 'failed'` to `NOT IN ('failed','expired','denied')` so
   dead approvals stop consuming budget.

6. **Clients treat `expired` as terminal.** The pretool hook's poll loop
   adds `expired` to its terminal set (defensive; expiry normally lands
   after the hook's own deadline).

## Surfaces (feature-visibility gate)

- **Where a human sees it:** `/approvals` — expired approvals render in a
  distinct "Expired" section (muted badge, no approve/deny buttons), below
  the pending list. Click path: sidebar → Approvals. The pending list
  itself is swept, so it only shows rows an approval can still release.
- **Discoverable:** same page operators already use for approvals.
- **Verified rendered:** frontend-verify against /approvals with a seeded
  expired row.

## Not doing

- No cron/scheduled sweep (free-tier constraint; lazy sweep suffices).
- No manual "dismiss" button (legacy-null rule clears the backlog; add
  later if operators ask).
- No renegotiation of expiry by `dashclaw_wait_for_approval` with a longer
  timeout — a wait that outlives the declared window sees `expired` and
  reports it truthfully.

## Acceptance (from roadmap)

- Seeded smoke scenario: an approval past the hook window shows expired and
  cannot release anything (`scripts/policy-smoke.mjs` backdates
  `approval_expires_at` via direct SQL seed, then proves over HTTP: list
  sweep flips it, GET shows `expired`, approve returns 410, x402 spend no
  longer counts it).
- `/approvals` verified live.
- Unit tests pin: expiry stamp computation, clamps, lazy flip, 410 path,
  x402 reconciliation, spend predicate exclusion.

## Touched files

- `drizzle/0039_approvals_lifecycle.sql`, `schema/schema.js` — column + partial index.
- `app/lib/repositories/actions.repository.ts` — stamp on create, lazy
  expire helpers, sweep.
- `app/api/guard/route.ts`, `app/api/actions/route.ts` — accept + stamp
  `approval_wait_seconds`; sweep on pending list.
- `app/api/actions/[actionId]/route.ts` — self-heal on read.
- `app/api/approvals/[actionId]/route.ts`, `app/api/approvals/bulk/route.ts` — 410 path.
- `app/api/x402/purchases/route.ts`, `app/lib/repositories/x402.repository.ts` — reconcile + spend predicates.
- `app/approvals/page.tsx` — Expired section.
- `hooks/dashclaw_pretool.py`, `mcp-server/src/tools.ts`, `sdk/dashclaw.js`,
  `sdk-python/dashclaw/client.py` — declare window / terminal state.
- `scripts/policy-smoke.mjs`, `__tests__/unit/*` — proofs.
- Docs: runtime-api, openapi, SDK READMEs, CHANGELOG, maintainer log.
