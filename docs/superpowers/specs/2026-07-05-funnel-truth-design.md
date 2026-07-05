# v4.6 — Funnel truth: read the trial evidence (spec)

Owner-facing activation funnel for the hosted trial — mint → first key used
→ first governed action → retained week 1 — computed from existing ledgers,
rendered on `/setup`, with truthful zeros. This is the instrument that
decides v5's direction (reach vs RBAC vs deepen). No outreach, no marketing
acts (constitution §4).

## What the evidence says

- The hosted trial (hosted.dashclaw.io) has minted trial workspaces since
  June with the funnel unread. Nothing currently renders whether a single
  trial ever converted past mint.
- Mint is atomic: `provisionHostedWorkspace`
  (`app/lib/repositories/hosted-workspace.repository.ts:66`) inserts the
  `organizations` row (`hosted_mode = TRUE`) and the `api_keys` row in one
  call. So "first key created" is not a funnel step — every mint has a key.
  The meaningful second step is **first key USE**: `api_keys.last_used_at`,
  stamped by `middleware.js` on every authenticated request.
- **The record is being destroyed on schedule.** `POST /api/hosted/cleanup`
  → `deleteHostedWorkspace` hard-deletes expired trial orgs and every child
  row (catalog-driven FK sweep). Trials live ~30 days
  (`HOSTED_TRIAL_DAYS`). A funnel computed purely from live tables
  undercounts mints as history is purged — survivorship bias, the exact
  lie this item exists to prevent. June-era expired trials are already
  unrecoverable; the funnel is truthful **from ship date forward**, and the
  surface says so.
- `/setup` is the natural owner surface: an unauthenticated server
  component doing direct repository reads, with an established norm
  (v3.6 enforcement card) of disclosing aggregates while withholding
  anything recon-useful. `/api/hosted/capacity` already exposes a
  cross-org aggregate count gated only by `isHostedMode()` — the same
  exposure class as this funnel.
- There is no cross-org authenticated owner session on the hosted
  instance; per-org keys deliberately cannot see other orgs
  (`app/api/orgs/route.ts` security comment). Aggregate-only public read
  under the hosted-mode flag is the only zero-terminal path that exists.

## Design decisions

**Funnel steps (one SQL definition, shared by live and frozen paths):**

| Step | Evidence |
|------|----------|
| Minted | `organizations` row with `hosted_mode = TRUE`; `minted_at = created_at` |
| Key used | `EXISTS api_keys` for the org with `last_used_at IS NOT NULL` |
| First governed action | earliest non-synthetic row across `guard_decisions` and `action_records` (`MIN(created_at)`, `LEAST` of the two) |
| Retained week 1 | org minted ≥ 7 days ago (**eligible**) AND any non-synthetic activity row with `created_at ≥ minted_at + 7 days` |

- Synthetic exclusion reuses the shared predicate exports from
  `app/lib/calibration-mining.js` (`SYNTHETIC_AGENT_LIKE_PATTERNS`,
  `SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS`) in SQL, exactly like
  posture/tightening/mining/tuning already do.
- Retention has a denominator: orgs younger than 7 days are reported as
  `week1Pending`, never counted as not-retained. A young org is not a
  churned org — that would be an untruthful zero.
- "First governed action" spans both `guard_decisions` (governance
  touchpoint even without a recorded action) and `action_records`
  (recorded action even if guard wasn't called) — either is evidence the
  trial governed something.
- **Fresh-schema drift guard:** `guard_decisions.created_at` is TEXT on
  fresh drizzle schemas (known bug class, 2026-07-02). Every funnel
  comparison/`MIN` on it casts `::timestamptz` in SQL — never assume the
  legacy-shaped local DB.

**Survivorship fix — `hosted_trial_snapshots` (new table, drizzle/0052):**

```
org_id           text PRIMARY KEY   -- no FK to organizations, deliberately:
                                    -- the catalog-driven child sweep in
                                    -- deleteHostedWorkspace deletes every
                                    -- FK-referencing row; this row must survive
minted_at        timestamp NOT NULL
deleted_at       timestamp NOT NULL DEFAULT now()
key_used         boolean NOT NULL
first_action_at  timestamp NULL
last_action_at   timestamp NULL
action_count     integer NOT NULL DEFAULT 0
retained_week1   boolean NOT NULL
```

- `deleteHostedWorkspace` computes the org's milestones from the live
  tables and inserts the snapshot **before** the child-row sweep. The
  write is REQUIRED: if it fails, the delete throws and the org survives
  until the next cleanup sweep retries — fail-closed for truth (a
  best-effort write would silently recreate the bug this item fixes).
  Order: revoke keys → snapshot → children → org row.
- At delete time the org is ≥ 30 days old, so week-1 eligibility is
  always satisfied; `retained_week1` freezes cleanly.
- Read path merges: live hosted orgs computed on the fly + frozen
  snapshots. One repository function owns both.

**API — `GET /api/hosted/funnel` (new route, repository-backed):**

- 404 unless `isHostedMode()` (the capacity precedent); no further auth.
  Response is aggregate-only — counts, rates, week cohorts, a median.
  **No org ids, slugs, key prefixes, or per-org rows ever.** This is an
  explicit decision: aggregates of an anonymous free trial are the same
  exposure class as the public capacity count, and it is the only
  zero-terminal owner path on the hosted instance.
- Shape:

```json
{
  "hosted": true,
  "computedAt": "…",
  "funnel": { "minted": 0, "keyUsed": 0, "firstAction": 0,
              "retainedWeek1": 0, "week1Eligible": 0, "week1Pending": 0 },
  "medianHoursToFirstAction": null,
  "cohorts": [ { "weekStart": "…", "minted": 0, "keyUsed": 0,
                 "firstAction": 0, "retainedWeek1": 0, "week1Eligible": 0 } ],
  "source": { "live": 0, "archived": 0, "truthfulSince": "…" }
}
```

- `cohorts` = mint-week grouping, most recent 8 weeks. `truthfulSince` =
  earliest evidence available (min of live `minted_at` / snapshot
  `minted_at`), so the v5 drafting sweep can cite the window honestly.

**Repository:** new functions in
`app/lib/repositories/hosted-workspace.repository.ts` (it already owns
every trial-org query): `snapshotTrialFunnelFacts(sql, orgId)` (used by
delete) and `getTrialFunnel(sql, { now })` (used by route + page). No
direct SQL in the route or page (route-sql:check).

## Human surface (HUMAN-EXPERIENCE gate)

1. **Where does a human SEE it?** A "Trial activation funnel" card on
   `/setup`, rendered only when the instance runs hosted mode. Click path:
   existing nav → Setup. On Wes's own and self-host instances the card is
   absent — the instrument doesn't apply, and rendering a permanently-zero
   hosted-trial funnel on a non-hosted instance would be noise, not truth.
2. **Is it discoverable?** `/setup` is an existing top-level surface
   already linked from nav; the card sits alongside the readiness and
   enforcement-posture cards.
3. **Is every human step a CLICK?** The instrument is read-only; the
   human role is reading it. Zero terminal steps: visit
   hosted.dashclaw.io/setup.
4. **Was it verified rendered?** Local rendered proof with
   `DASHCLAW_HOSTED=true` (next build + next start per the dev-server
   workaround) showing the card with truthful zeros/live counts, plus the
   hosted-off absence; live proof on hosted.dashclaw.io/setup after
   deploy.

**No marketing-site update** (HUMAN-EXPERIENCE clause 4, explicit
decision): this is an owner instrument for reading the trial, not a
customer-facing capability. Nothing about the product's offer changed.

## Acceptance (from the roadmap, made concrete)

- `GET /api/hosted/funnel` returns the shape above; on a hosted instance
  with zero conversions it returns real zeros (never nulls-as-zeros for
  the pending cohort; `week1Pending` distinguishes too-young from
  churned).
- `/setup` renders the funnel card in hosted mode with the four steps,
  conversion counts/rates, the cohort table, and the `truthfulSince`
  window; card absent when hosted mode is off.
- An expired trial deleted by cleanup still counts in the funnel
  (snapshot survives the FK sweep) — pinned by test.
- A failed snapshot write aborts the delete — pinned by test.
- Synthetic traffic (`loadtest-%` agents, `smoke.%`/`loadtest.%`/
  `liveproof.%` action types) never counts as first-action or retention
  evidence — pinned by test.
- Smoke: new section pins the hosted-off 404 gate. The hosted-on path is
  not live-smokeable against the local instance (flipping
  `DASHCLAW_HOSTED` means restarting the server mid-run) — pinned by
  vitest instead, reason recorded here (v4.4 precedent).
- The v5 drafting sweep can cite the funnel: numbers + window from the
  live hosted instance.

## Non-goals (recorded, with revival triggers)

- **No outreach / growth acts** — §4, Wes's alone. This item only builds
  the instrument.
- **No per-org drill-down or trial roster UI** — aggregate-only by
  design; revive only with a real owner-session/RBAC story (watch-list
  item "team/RBAC").
- **No backfill of June-era purged trials** — the evidence is gone;
  fabricating it would be the opposite of funnel truth. `truthfulSince`
  marks the window.
- **No change to mint flow, caps, or cleanup cadence** — the funnel
  reads; it does not steer.
- **No event/analytics pipeline** (page views, docs visits, drop-off
  telemetry) — the funnel is computed from governance ledgers the
  product already keeps. Revive if v5 chooses reach and needs
  acquisition-side visibility.
