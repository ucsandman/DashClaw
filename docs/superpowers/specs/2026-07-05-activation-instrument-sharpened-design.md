# v5.3 — Activation instrument sharpened (design)

Roadmap: `docs/plans/owner-roadmap.md` v5.3. Closes the two blind spots the
v4.6 funnel spec recorded as non-goals, now that v5.1 trial sessions make
them closable, plus the browser-vs-agent distinction v5.2 made reachable.

## Problem

The funnel (v4.6, `hosted-workspace.repository.ts`) can say *whether* a
trial used its key and acted, but not:

1. **Returned vs gone** — "minted and never came back" and "returned,
   browsed, never connected an agent" are indistinguishable. No table holds
   a trial visit fact.
2. **When the key was first used** — `api_keys.last_used_at` is a
   last-stamp; time-from-mint-to-first-key-use is unmeasurable.
3. **Browser vs agent activation** — since v5.2, `firstAction` can happen
   in the browser (session-authenticated, no key). The funnel counts it but
   cannot say which door it came through.

## Design

### 1. Trial visit stamps (org grain)

Two columns on `organizations` (timestamptz):

- `trial_first_seen_at` — first trial-session-authenticated request.
- `trial_last_seen_at` — most recent one.

A timestamp, not page-view analytics. Written in `middleware.js
resolveTrialOrg()` — the single point every trial-session request (page and
same-origin API) funnels through — **only on a cache-miss positive
resolution**, so the 60s trial-org cache is also a natural write throttle
(≤1 write / 60s / org / instance). Fire-and-forget with `.catch()`:
a failed stamp never blocks a request, and stamping must not disturb the
v5.1 transient-vs-gone error contract (the stamp runs only after a
*positive* resolve; the no-try/catch rule on the resolve query itself is
untouched).

The post-mint landing stamps `first_seen` ≈ mint time; that is expected
and honest. "Returned" is therefore defined as **seen again more than 60
minutes after mint** (`RETURN_GAP_MS`) — one sitting doesn't count as a
return. The constant lives next to the funnel math and the card copy
states the definition.

### 2. `api_keys.first_used_at`

Sibling of `last_used_at` (same bare-`timestamp` type). Both stamping
sites gain a `first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP)`
in the existing fire-and-forget UPDATE:

- `middleware.js` inline Neon path (hosted).
- `apiKeys.repository.ts touchKeyLastUsed()` (self-host internal
  resolve-key route).

First use is by definition an api-key-cache miss, so the stamp is exact.
**No backfill**: for keys already used before this ships, the true first
use is unknowable; fabricating `first_used_at = last_used_at` would be a
lie. NULL means "used before v5.3 or never" — the `keyUsed` *step* keeps
its `last_used_at IS NOT NULL` semantics (backward compatible); only the
*when* comes from `first_used_at`.

### 3. Browser-vs-agent on first action

`queryLiveTrialFacts` already scans the synthetic-excluded event union;
it additionally selects the earliest event's `agent_id`
(`(ARRAY_AGG(agent_id ORDER BY ts))[1]`). An org's activation door is
`browser` when that id equals the v5.2 card's pinned agent id, else
`agent`. The id moves to a shared constant
`app/lib/hosted/browser-action.js` (`BROWSER_FIRST_ACTION_AGENT_ID`);
`FirstGovernedActionCard.jsx` re-exports it so the existing
synthetic-prefix pin test keeps guarding it (rename trap, v5.2 memory).
Plain `.js` module: Turbopack won't map extensionless `.js`→`.ts` imports
from `.jsx` importers.

### 4. Snapshot extension (fail-closed freeze unchanged)

`hosted_trial_snapshots` gains nullable `first_key_used_at`,
`first_seen_at`, `last_seen_at` (timestamptz) and `first_action_via`
(text). `snapshotTrialFunnelFacts` freezes them at deletion;
`querySnapshotFacts` reads them back. Pre-v5.3 archived rows carry NULLs
— unknown, never guessed.

### 5. Funnel annotations (not new steps)

The funnel stays 4 steps. `computeFunnelAggregates` returns an
`annotations` object:

- `returned` — facts with `lastSeenAt - mintedAt > RETURN_GAP_MS`.
- `returnedNeverConnected` — returned AND no key use AND no first action.
- `medianHoursToFirstKeyUse` — over facts with `first_used_at` evidence.
- `firstActionVia` — `{ browser, agent }` counts over activated orgs with
  a known door (unknown/pre-v5.3 rows counted in neither).

`GET /api/hosted/funnel` (route unchanged, aggregate-only norm holds —
annotations are counts and a median, no identifiers) and the /setup
"Trial activation funnel" card render them as annotation lines under the
step grid, truthful-zeros style, with copy noting visit stamps are
measured since this version.

## Non-goals

- Per-visit analytics, page views, session counts — two timestamps only.
- Backfilling any unknowable fact.
- New routes, new auth surface, or trial-user-facing UI changes.
- Changing funnel step semantics (mint / keyUsed / firstAction /
  retainedWeek1 are untouched).

## Human surface (HUMAN-EXPERIENCE.md)

- **See it**: /setup → "Trial activation funnel" card (existing, hosted
  mode) — new annotation lines; `GET /api/hosted/funnel` carries the same
  facts for the API view.
- **Discoverable**: same card humans already read the funnel on.
- **Clicks**: none required — this is a read-only instrument; the human
  role is reading the sharpened numbers.
- **Rendered proof**: hosted-mode /setup driven headless, annotations
  visible, before ship.

## Security note

No new routes or auth surface. New writes are parameterized UPDATEs on
already-authenticated principals' own rows, fire-and-forget, throttled by
existing caches. The public funnel discloses two new aggregate counts and
a median — same disclosure class the v4.6 review signed off on.

Security review verdict (2026-07-05): SHIP, 0 blockers, 2 LOW
accepted-tradeoff notes: (1) `firstActionVia` derives from the
self-reported agent id, so an agent naming itself `browser-first-action`
would be miscounted as a browser activation — analytics distortion only,
no boundary crossed; (2) small-n annotation counts on the public funnel
are the same low-cardinality property v4.6 already accepted.

## Acceptance (from the roadmap, expanded)

- Funnel route + /setup card render returned-vs-gone,
  time-to-first-key-use, and browser-vs-agent with truthful zeros.
- Snapshots carry the new facts; deletion freeze remains fail-closed.
- Tests pin: annotation math (incl. NULL/pre-v5.3 rows), COALESCE
  stamping at both key sites, visit-stamp write on fresh trial resolve,
  browser agent-id constant vs synthetic exclusion.
- `npm run db:migrate` idempotent on legacy and fresh schemas.
