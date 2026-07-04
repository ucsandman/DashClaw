# v3.4 Live-Host Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled canary that probes the production hosts as a real client, stores its verdict in the instance, and surfaces failures where the operator already looks — /setup and a posture `auditability` finding — within one canary interval.

**Architecture:** A dependency-free Node script (`scripts/live-canary.mjs`) runs hourly in GitHub Actions, probes www.dashclaw.io + hosted.dashclaw.io with plain `fetch` (every probe in the inventory is assertable curl-grade — verified live 2026-07-04), and POSTs its report to `POST /api/live-canary` on the operator's instance. Runs land in a new `live_canary_runs` table via a repository. `/setup` renders the latest instance-wide run as a "Live host canary" section (precedent: the v4.44.0 Write-path health section); posture appends one collapsed `auditability` finding when the latest run for the reporting org is failed and fresh.

**Tech Stack:** Next.js 16 App Router route + repository (Neon `sql` tag), drizzle migration 0046, GitHub Actions cron, vitest.

## Global Constraints

- Roadmap acceptance (docs/plans/owner-roadmap.md:465-467): killing a live surface (staging simulation acceptable) is detected within one canary interval and rendered; the canary's own traffic is excluded from posture/mining per v3.1.
- Free tier only → GitHub Actions cron (Vercel Hobby cron is 1/day — too coarse for a 1h interval).
- No junk trials: the trial-mint probe sends **no** `turnstile_token` and asserts the fail-closed `400 missing_token` — a `200` here is a FAIL (junk trial minted / Turnstile off).
- Synthetic-traffic exclusion is **structural**: the canary writes only to `live_canary_runs` (never `action_records`/`guard_decisions`), so posture/mining never see it. Belt-and-braces: its identity slug is `smoke-live-canary`, matching `SYNTHETIC_AGENT_RE` (app/lib/calibration-mining.js:59).
- No direct SQL in route files (`route-sql:check`); no silent catches in `app/api/**` or repositories (v4.45.0 guard) — best-effort reads on the /setup page surface an explicit "unavailable" state instead.
- HUMAN-EXPERIENCE.md: SEE it on `/setup` (nav → Setup) and `/posture` (finding card); every human step is a click (finding → Review → deep link to /setup#live-canary); verified rendered via headless browser before ship.

## Spec decisions (the three the roadmap delegates)

**Probe inventory** — 9 probes, all verified against production 2026-07-04 (contracts below are observed reality, not guesses):

| id | request | pass condition |
|----|---------|----------------|
| `marketing-home` | GET `https://www.dashclaw.io/` | 200 AND body contains `hosted.dashclaw.io/connect` (trial CTA present) |
| `marketing-docs` | GET `https://www.dashclaw.io/docs` | 200 AND body contains `DashClaw` |
| `demo-entry` | GET `https://www.dashclaw.io/demo` (no redirect follow) | 307 AND `Location` ends with `#live-demo` |
| `demo-cookie` | GET `https://www.dashclaw.io/mission-control` with `Cookie: dashclaw_demo=1` | 200 (the v4.36.2/3 cookie class, curl-grade) |
| `trial-connect` | GET `https://hosted.dashclaw.io/connect` | 200 |
| `trial-mint-fail-closed` | POST `https://hosted.dashclaw.io/api/hosted/workspaces` `{"name":"canary-probe"}` (no turnstile_token) | 400 AND body contains `turnstile` |
| `oauth-as-metadata` | GET `https://hosted.dashclaw.io/.well-known/oauth-authorization-server` | 200 AND JSON has `authorization_endpoint` |
| `oauth-resource-metadata` | GET `https://hosted.dashclaw.io/.well-known/oauth-protected-resource` | 200 AND JSON has `resource` |
| `mcp-handshake` | POST `https://hosted.dashclaw.io/api/mcp` JSON-RPC `initialize`, no auth | 401 AND `WWW-Authenticate` contains `resource_metadata` |

Each probe: 15s timeout, one retry after 5s on network error or 5xx (GH runner flake guard). Run status = `fail` if any probe fails, else `pass`.

**Cadence:** cron `17 * * * *` (hourly, off-minute to dodge top-of-hour GH queue delays) + `workflow_dispatch`. Staleness threshold **3h** (tolerates GH cron drift; a stale canary is itself a warn on /setup).

**Authentication:** probes are deliberately unauthenticated — the canary is "a real client," and every probe asserts a public contract (including two auth *challenges* as pass conditions). Reporting reuses the `integration-health.yml` secret pattern: `DASHCLAW_BASE_URL` + `DASHCLAW_API_KEY` → `POST /api/live-canary` with `x-api-key`. Secrets absent → probes still run and the job still fails visibly on breakage, report step skips (fork-safe). Runs are stored under the reporting key's org; the posture finding therefore appears only for the reporting org. `/setup` (public, org-less) renders the latest run of **one trusted canary org only** (`DASHCLAW_CANARY_ORG_ID`, default `org_default`). *Revised in-ship per the 2026-07-04 security review (HIGH):* the original instance-wide read assumed probe results carry no org data, but check titles/details are free text from any API-key holder — on the multi-tenant hosted instance a self-serve trial tenant could have planted arbitrary text on the shared public page. Tenant runs remain visible to their own org via the scoped GET and posture finding.

## File Structure

- Create: `drizzle/0046_live_canary_runs.sql`, `app/lib/repositories/live-canary.repository.ts`, `app/api/live-canary/route.ts`, `scripts/live-canary.mjs`, `.github/workflows/live-canary.yml`, `__tests__/unit/live-canary.repository.test.js`, `__tests__/unit/api-live-canary-route.test.js`, `__tests__/unit/live-canary-finding.test.js`
- Modify: `schema/schema.js` (table), `app/lib/posture/types.ts` (fix variant), `app/lib/posture/findings.ts` (deriveLiveCanaryFinding), `app/lib/posture/signals.ts` (wire read + append), `app/posture/page.tsx` (evidence line for new fix type), `app/setup/page.tsx` (Live host canary section), docs/counts/CHANGELOG/maintainer-log/roadmap at ship.

---

### Task 1: Schema + migration

**Files:** Modify `schema/schema.js` (after `postureSnapshots`, ~line 1525); Create `drizzle/0046_live_canary_runs.sql`.

**Produces:** table `live_canary_runs` (id text pk `lcr_*`, org_id FK cascade, source text, status text pass|fail, checks jsonb, started_at/finished_at timestamptz, created_at timestamptz defaultNow, index (org_id, created_at)).

```js
// @domain governance
// v3.4 live-host canary: verdicts reported by the scheduled external probe
// (scripts/live-canary.mjs via GitHub Actions). Structurally isolated from
// action_records/guard_decisions so synthetic probe traffic can never reach
// posture/mining. `checks` holds [{id,title,status,detail,durationMs,target}].
export const liveCanaryRuns = pgTable('live_canary_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('github-actions'),
  status: text('status').notNull(),
  checks: jsonb('checks').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_live_canary_runs_org_created').on(t.orgId, t.createdAt),
}));
```

Migration mirrors it with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (idempotent, fresh-install-safe: plain timestamptz, no TEXT drift). Run `npm run db:migrate`, verify with a `\d`-equivalent select.

### Task 2: Repository + tests

**Files:** Create `app/lib/repositories/live-canary.repository.ts`, `__tests__/unit/live-canary.repository.test.js`.

**Produces:**
- `insertLiveCanaryRun(sql, orgId, {source, status, checks, startedAt, finishedAt}) → {id}` — id `lcr_<crypto.randomUUID()>`; prunes rows older than 14 days for the org in the same call.
- `getLatestLiveCanaryRunForOrg(sql, orgId) → run | null`
- `canaryDisplayOrgId(env) → string` — the org whose runs the public /setup page renders (`DASHCLAW_CANARY_ORG_ID`, default `org_default`; security-review revision — see §Authentication)

Follow existing repository test conventions (mock `sql` tag; note `sql`` fragments consume vi.fn() calls` gotcha).

### Task 3: Route

**Files:** Create `app/api/live-canary/route.ts`, `__tests__/unit/api-live-canary-route.test.js`.

**Contract:**
- `POST` body `{source?, status: 'pass'|'fail', checks: [{id,title,status:'pass'|'fail',detail?,durationMs?,target?}] (1..50), startedAt, finishedAt}` — strings length-capped (id/title ≤ 200, detail/target ≤ 1000), timestamps ISO. 400 on violation with structured error; 201 `{id}` on success. Org from middleware (`x-org-id`).
- `GET ?limit=N` (default 1, max 20) → `{runs:[...]}` for the caller's org.
- All SQL via the repository (route-sql:check).

### Task 4: Posture finding

**Files:** Modify `app/lib/posture/types.ts`, `app/lib/posture/findings.ts`, `app/lib/posture/signals.ts`, `app/posture/page.tsx`; Create `__tests__/unit/live-canary-finding.test.js`.

- types.ts: add `| { type: 'view_live_canary'; deepLink: string }` to `PostureFix`.
- findings.ts: pure `deriveLiveCanaryFinding(run, nowMs) → PostureFinding | null`: null unless `run.status === 'fail'` AND `finishedAt` within 3h of nowMs. Finding: key `stableKey(['auditability','live-canary'])`, dimension `auditability`, severity `high`, title `Live host canary failing: N public surface(s)`, evidence `{observedCount: failedCheckCount, exampleActionIds: []}`, fix `{type:'view_live_canary', deepLink:'/setup#live-canary'}`, scoreDelta consistent with existing findings' display semantics (verify how deriveFindings assigns it; do not touch computeScore — the finding renders, the score formula is unchanged, explicit decision).
- signals.ts `computePosturePayload`: add `getLatestLiveCanaryRunForOrg` to the parallel gather; append the derived finding (if any) before `applyFindingStates` so snooze/accept_risk overlay works unchanged.
- posture/page.tsx `evidenceLine`: case for `view_live_canary` → `"${n} public ${n===1?'surface':'surfaces'} failing on the live hosts"`. Modal needs no change (unknown type already degrades to Review + snooze/accept_risk; `deepLink` renders via existing deep-link handling — verify, add if absent).
- Tests: fail+fresh → finding present with stable key; pass → null; stale (>3h) fail → null.

### Task 5: /setup section

**Files:** Modify `app/setup/page.tsx` (after the Write-path health article, id anchor `live-canary`).

States (server component reads `getLatestLiveCanaryRun(sql)` in the existing parallel gather; DB unconfigured or table missing → catch → explicit "unavailable/not reporting yet" info card, never silent):
- No rows → info: "No canary reports yet" + one-line pointer to the `live-canary` GitHub Actions workflow.
- Latest run pass + fresh (≤3h) → pass card: "All N public surfaces answering as expected", relative timestamp.
- Latest run fail → fail card listing failing check titles + details (public info, no redaction needed).
- Latest run older than 3h → warn: "Canary has not reported since <time>" (a dead canary is itself a finding).

### Task 6: Probe script + workflow

**Files:** Create `scripts/live-canary.mjs` (no app imports; Node 20 global fetch), `.github/workflows/live-canary.yml`.

- Script: probe defs as data per the inventory table above; hosts overridable via `LIVE_CANARY_MARKETING_ORIGIN` / `LIVE_CANARY_HOSTED_ORIGIN` (defaults `https://www.dashclaw.io` / `https://hosted.dashclaw.io`) — the override is the staging-simulation lever for acceptance. 15s timeout, 1 retry on network/5xx. Prints a human table; exits 1 on any fail. If `DASHCLAW_BASE_URL` + `DASHCLAW_API_KEY` set → POST report to `/api/live-canary` (report failure = exit 1 too; a canary that can't file its verdict is broken).
- Workflow: cron `17 * * * *` + `workflow_dispatch`; single job, Node 20, runs the script with secrets in env; `$GITHUB_STEP_SUMMARY` gets the table (integration-health.yml is the template).

### Task 7: Acceptance + verification + ship

- Live run: `node scripts/live-canary.mjs` against real hosts → all 9 pass.
- Kill simulation: `LIVE_CANARY_HOSTED_ORIGIN=https://dead.dashclaw.invalid node scripts/live-canary.mjs` → hosted probes fail, exit 1.
- Report to local instance (next start :3001 per dev-server-panic memory), then frontend-verify: `/setup#live-canary` renders the fail card; `GET /api/posture` for the org shows the `auditability` finding; posture page renders it.
- Gates: `npm run lint`, `npx vitest run` (full), `npm run typecheck`, `npx next build`.
- Ship via dashclaw-ship: v4.46.0; route count 327→328 everywhere cited; CHANGELOG + maintainer-log + roadmap v3.4 → DONE; marketing/docs line per HUMAN-EXPERIENCE clause 4; fold the pending AGENTS.md reindex stamp into the chore.
