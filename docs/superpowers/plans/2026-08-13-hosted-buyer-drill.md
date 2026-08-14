# Hosted Buyer Drill (Money-Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new manual pre-release drill `scripts/drills/hosted-buyer.mjs` that proves the entire hosted money path end to end: mint → act → claim → checkout → webhook plan-flip → seat-cap 409 → action-ceiling 403 → portal → cancel → free-plan restore → export → teardown, with every step asserting exact status codes and DB truth.

**Architecture:** One self-contained Node script following the four existing drills' conventions (stdlib fetch, `_load-env.mjs`, `DRILL_STEP <id> PASS|FAIL` output, exit 0 only on all-pass, teardown in `finally`). Claim uses claim-flow.mjs's proven session-forgery pattern (DB seed + `next-auth/jwt` `encode()` with `NEXTAUTH_SECRET`). Stripe checkout completion and cancel are driven by **synthetic webhook events signed with the real `STRIPE_WEBHOOK_SECRET`** — the server verifies the signature and runs its real apply path; only Stripe's delivery hop is synthesized. The action-ceiling 403 is triggered by upserting `usage_rollups` directly (sanctioned by the spec: "a stubbed rollup read is acceptable; 250k live actions is not a drill").

**Tech Stack:** Node ≥18 (stdlib fetch), `next-auth/jwt` (already a dependency), `stripe` npm package (already a dependency — used for `webhooks.generateTestHeaderString` and teardown `customers.del`), direct SQL over `DATABASE_URL` (reuse claim-flow.mjs's driver import verbatim).

**Spec:** `C:\Projects\Practical Systems\docs\plans\2026-08-13-dashclaw-hosted-launch-implementation-plans.md`, section "Plan A". Wes approved four deviations on 2026-08-13: (1) sibling script instead of extending hosted-stranger; (2) synthetic signed webhooks instead of a browser 4242 flow; (3) local test-mode verification first, hosted run approval-gated; (4) gate wiring = npm script + drills README entry (the real repo convention — no drill is wired into CI today).

## Global Constraints

- Work happens ONLY in `C:\Projects\DashClaw`. Nothing is copied into the Practical Systems monorepo.
- No live-mode Stripe assertion. Local development and verification use **test-mode** keys only. Running the drill against `hosted.dashclaw.io` is Task 8 and requires explicit Wes approval in session — do not run it as part of any earlier task.
- Never print secrets, connection strings, JWTs, API keys, or Stripe ids prefixed `sk_` in drill output or logs. Workspace/org/customer/subscription ids are fine.
- Do not modify `hosted-stranger.mjs`, `claim-flow.mjs`, `middleware.js`, any `app/**` route, or `entitlements.ts`. This plan adds one script, one npm script line, and docs. If a route seems to need a change, STOP and surface it.
- The drill must fail closed: any missing required env var, any unexpected status, any unparseable body, any DB truth mismatch → `DRILL_STEP <id> FAIL` and exit 1. Teardown runs in `finally` and is best-effort (teardown failure prints a warning with cleanup instructions but does not flip a PASS verdict — matching claim-flow.mjs).
- Repo commands: `npm run lint`, `npm run typecheck`, `npm test` (vitest), `node --check <file>` for script syntax. Current version at HEAD: 5.21.0.
- Commit style: follow the repo's existing conventional-commit style (`feat:`, `docs:`).

## Facts reference (verified 2026-08-13 against HEAD, v5.21.0)

The executor should trust these over intuition; each was read from source this day.

| Fact | Source |
| --- | --- |
| Mint: `POST {base}/api/hosted/workspaces` with header `x-hosted-drill-token: $HOSTED_DRILL_TOKEN`; per-IP limit `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` (default 5) applies to drill mints too | `hosted-stranger.mjs`, `app/lib/hosted/drill-mint.ts` |
| Session forgery: seed `users`+`organizations` rows via SQL, then `encode({ token: { sub, userId, orgId, role: 'admin', plan: 'free', orgRefreshedAt: Date.now() }, secret })` from `next-auth/jwt`; cookie name `__Secure-next-auth.session-token` on https else `next-auth.session-token` | `claim-flow.mjs:131-138` |
| Claim: `GET/POST /api/hosted/claim`; POST requires trial cookie + `x-user-id` starting `usr_`; on success `claimTrialWorkspace` sets `claimed_at`, `claimed_by_user_id`, clears `trial_ends_at`, renames org, rebinds user | `app/api/hosted/claim/route.ts` |
| Trial-minted API key survives claim (`claimTrialWorkspace` never touches `api_keys`, org id unchanged) | `claim.repository.ts:67-101` |
| Checkout: `POST /api/billing/checkout` body `{plan}`, requires human admin; success `200 {url}`; unclaimed hosted org → `409 {error:'claim_required', message:...}` | `app/api/billing/checkout/route.ts:64-69,114` |
| Webhook: `POST /api/webhooks/stripe`, verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET` via `constructEvent`; idempotency table `stripe_webhook_events(event_id PK, event_type, org_id)`, replay → `200 {received:true, duplicate:true}` | `app/api/webhooks/stripe/route.ts`, `billing.repository.ts:93-104` |
| `checkout.session.completed` handler reads `data.object.metadata.org_id` (required), `data.object.metadata.plan` (must be `indie`/`team`), `data.object.customer`, `data.object.subscription`, `event.id`, `event.type`; writes `plan`, `stripe_customer_id` (COALESCE), `stripe_subscription_id`, `subscription_status='active'`, `trial_action_cap=NULL` | `billing.repository.ts:106-125`, route line 57 |
| `customer.subscription.deleted` handler reads only `data.object.id`, resolves org by `stripe_subscription_id`; writes `plan='free'`, `subscription_status='canceled'`, `stripe_subscription_id=NULL`, `current_period_end=NULL`, `trial_action_cap=10000` when `hosted_mode` | `billing.repository.ts:154-171` |
| Entitlements: free `{seatCap:2, ceiling:null}`, indie `{2, 50_000}`, team `{10, 250_000}` (PROVISIONAL) | `app/lib/entitlements.ts` |
| Seat cap: `POST /api/team/invites` body `{email, role?}`; success `201 {invite}`; cap → `409 {error:'SEAT_CAP_REACHED', code:'SEAT_CAP_REACHED', seat_cap:<n>, upgrade_hint:...}` (checked when `org?.hosted_mode`, counts `members.length + pendingInvites.length >= seatCap`) | `app/api/team/invites/route.ts:51,69-79,92` |
| Ceiling: enforced in `middleware.js` `enforceActionCeiling` (826-851) on `POST /api/actions` and `POST /api/guard?record=true` only; reads `usage_rollups(org_id, period 'YYYY-MM' UTC, governed_actions)`; response `403 {error:'monthly action ceiling reached', code:'ACTION_CEILING_REACHED', monthly_action_ceiling, governed_actions}`; fails open on read error | `middleware.js`, `usage.repository.ts` |
| Trial/free action cap: `enforceHostedTrial` (middleware 789-809) applies regardless of claim; compares `organizations.trial_actions_used >= trial_action_cap`; cleared to NULL by paying, restored to 10000 by cancel | middleware + `billing.repository.ts` |
| Middleware caches org facts 60s → plan-flip visibility needs poll-with-timeout (claim-flow precedent: 75s) | `claim-flow.mjs` poll loop |
| Portal: `GET /api/billing/portal`, human admin; needs `stripe_customer_id` → `200 {url}`, else `400 NO_CUSTOMER` | `app/api/billing/portal/route.ts:51` |
| Export: `GET /api/workspace/export` with `x-api-key` → 200 JSON with `exported_at` | `hosted-stranger.mjs` step 4 |
| Claimed org CANNOT be deleted via `DELETE /api/hosted/workspaces/{id}` — guard throws (`claimed_at` set → 500). Teardown must: set `claimed_at=NULL, claimed_by_user_id=NULL`, then FK-child sweep via `information_schema` (5 retry passes), then delete org rows and seeded user | `hosted-workspace.repository.ts:163-167`, `claim-flow.mjs:216-243` |
| Nothing in the codebase calls `stripe.customers.del` — the drill's teardown must do it itself | repo-wide grep 2026-08-13 |

---

### Task 0: Local target environment check

**Files:**
- Create: none (verification only; findings go in the task report)

**Interfaces:**
- Produces: a running local DashClaw instance at `http://127.0.0.1:3000` whose `.env.local` has hosted mode on, a Neon-branch `DATABASE_URL`, `NEXTAUTH_SECRET`, `HOSTED_DRILL_TOKEN` (≥24 chars), and **test-mode** `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_INDIE`, `STRIPE_PRICE_TEAM`. Later tasks run the drill against this instance.

- [ ] **Step 1: Inventory the existing env** — read `C:\Projects\DashClaw\.env.local` KEY NAMES ONLY (e.g. `Select-String -Pattern '^[A-Z_]+' | ForEach-Object { ($_ -split '=')[0] }` or grep `-o '^[A-Z_0-9]*'`). Never print values. Confirm which of the required vars above exist and whether `STRIPE_SECRET_KEY` is test-mode (check only the prefix: `sk_test_` vs `sk_live_` — grep for `^STRIPE_SECRET_KEY=sk_test_` returning a match count, not the line).
- [ ] **Step 2: If any var is missing or Stripe is live-mode locally, STOP** and report exactly what is missing. Creating test prices via the Stripe CLI is allowed (test mode only); changing `.env.local` values requires telling Wes what changed in the summary. Note: the Practical Systems week-2 journey left a valid Stripe CLI test key in `~/.config/stripe/config.toml` (expires 2026-09-06) — `stripe prices create` against test mode is available if `STRIPE_PRICE_INDIE`/`STRIPE_PRICE_TEAM` test prices don't exist.
- [ ] **Step 3: Confirm the DB is Neon-backed** — claim/trial middleware paths resolve via the Neon HTTP driver only; a non-Neon local DB makes claim steps unprovable (claim-flow.mjs marks them LIMITED). If `DATABASE_URL` is not a Neon URL, STOP and report.
- [ ] **Step 4: Boot the dev server** (`npm run dev` in the background, port 3000) and verify `GET http://127.0.0.1:3000/api/health` returns 200. Record the process PID at start (kill by PID at session end, never by name).
- [ ] **Step 5: Sanity-run the two existing hosted drills' preflights** — `node --check scripts/drills/hosted-stranger.mjs` and `node --check scripts/drills/claim-flow.mjs` (syntax only, no execution) to confirm the toolchain parses them.

---

### Task 1: Scaffold `hosted-buyer.mjs` — harness, preflight, mint → key → first action

**Files:**
- Create: `scripts/drills/hosted-buyer.mjs`
- Modify: `package.json` (add `"drill:buyer": "node scripts/drills/hosted-buyer.mjs"` next to the existing `drill:*` scripts)

**Interfaces:**
- Consumes: `scripts/drills/hosted-stranger.mjs` (read it first; copy its `_load-env.mjs` import, unhandledRejection handler, arg parsing, step/verdict output format, and its mint/key/action request shapes verbatim — the mint response field names live there and MUST be copied, not guessed).
- Produces: `step(id, fn)` harness where `fn` throws to fail; globals `baseUrl`, `workspaceId`, `orgId`, `apiKey`, `trialCookie`; `sql` tagged-template DB helper (same driver import as `claim-flow.mjs`); `teardown()` registry — an array of labeled async cleanup functions run in reverse order inside `finally`, each wrapped so one failure doesn't stop the rest (mirror claim-flow.mjs's pattern).

- [ ] **Step 1: Read `scripts/drills/hosted-stranger.mjs` and `scripts/drills/claim-flow.mjs` fully.** These are the templates; every convention (output lines, env loading, cookie capture from the mint response, DB driver import, FK-sweep teardown) comes from them.
- [ ] **Step 2: Write the scaffold.** Required env preflight — fail closed listing missing names:

```js
#!/usr/bin/env node
// hosted-buyer.mjs — money-path drill: mint → act → claim → checkout →
// webhook plan-flip → entitlement 409/403 → portal → cancel → export → teardown.
// Spec: PS docs/plans/2026-08-13-dashclaw-hosted-launch-implementation-plans.md (Plan A).
import '../_load-env.mjs';
const REQUIRED = ['HOSTED_DRILL_TOKEN', 'DATABASE_URL', 'NEXTAUTH_SECRET',
  'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`DRILL_VERDICT FAIL missing env: ${missing.join(', ')}`);
  process.exit(1);
}
```

Base URL from `--base-url` arg, default `http://127.0.0.1:3000` (copy hosted-stranger's arg parsing). Add a `--sabotage` flag: when set, exactly one assertion (the seat-cap expected status in Task 4) is deliberately flipped from 409 to 200 — this is the L1 make-it-fail switch, cheap and permanent.
- [ ] **Step 3: Implement steps `mint`, `key-works`, `first-action`** by porting hosted-stranger's first three steps unchanged (same routes, same header names, same response-field reads). Capture the `dashclaw-trial-session` cookie from the mint response `set-cookie` header (claim-flow shows how) — the claim steps need it. Register teardown: `DELETE /api/hosted/workspaces/{workspaceId}` with `HOSTED_ADMIN_API_KEY` when set (this works only while the org is unclaimed; Task 2 replaces it for the claimed case).
- [ ] **Step 4: Syntax + lint**: `node --check scripts/drills/hosted-buyer.mjs` and `npm run lint` — both clean.
- [ ] **Step 5: Run it**: `npm run drill:buyer` against the Task 0 instance. Expected: `DRILL_STEP mint PASS`, `DRILL_STEP key-works PASS`, `DRILL_STEP first-action PASS`, verdict PASS, exit 0, and the workspace deleted (verify: rerun of `GET /api/hosted/workspaces/{id}` 404s, or check the teardown output line).
- [ ] **Step 6: Commit**: `git add scripts/drills/hosted-buyer.mjs package.json && git commit -m "feat(drills): scaffold hosted-buyer money-path drill (mint/key/action)"`

---

### Task 2: Claim block — seed user, forge session, claim, rebind cookie

**Files:**
- Modify: `scripts/drills/hosted-buyer.mjs`

**Interfaces:**
- Consumes: Task 1 globals; `claim-flow.mjs` seeding SQL, `encode()` call, cookie-name logic, and teardown FK-sweep — copy verbatim, then adapt names.
- Produces: globals `userId` (a `usr_`-prefixed id), `personalOrgId`, `sessionCookie()` — a function returning the current forged session cookie string, RE-MINTED after claim with `orgId: orgId` (the trial org) so billing routes resolve the right org deterministically instead of waiting out the middleware's 60s org-fact cache.

- [ ] **Step 1: Port claim-flow.mjs's user/org seeding** (direct SQL insert of the `users` + personal `organizations` rows a Google signIn callback would create) and its session mint, verbatim shape:

```js
import { encode } from 'next-auth/jwt';
async function mintSessionCookie(boundOrgId) {
  const jwt = await encode({
    token: { sub: userId, userId, orgId: boundOrgId, role: 'admin', plan: 'free',
             orgRefreshedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET,
  });
  const name = baseUrl.startsWith('https')
    ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
  return `${name}=${jwt}`;
}
```

- [ ] **Step 2: Implement steps `claim-preview` and `claim`**: `GET /api/hosted/claim` with trial cookie + session cookie → assert `claimable: true`; `POST /api/hosted/claim` (same cookies) → assert 200. Then **re-mint the session cookie bound to the trial `orgId`** (the claim POST rebinds server-side state; the old cookie still says `personalOrgId`).
- [ ] **Step 3: Implement step `claim-db-truth`**: `sql` read of the org row → assert `claimed_at IS NOT NULL`, `claimed_by_user_id = userId`, `trial_ends_at IS NULL`.
- [ ] **Step 4: Replace the teardown for the claimed case** (port claim-flow.mjs lines ~216–243): set `claimed_at = NULL, claimed_by_user_id = NULL` on the org, FK-child sweep via `information_schema` with 5 retry passes, delete the org rows (trial + personal), delete the seeded user. Keep the Task 1 admin-DELETE teardown as a fallback ONLY for runs that die before the claim step (guard on whether `claimed` flag was set).
- [ ] **Step 5: Run** `npm run drill:buyer` → all steps through `claim-db-truth` PASS, exit 0, and a follow-up `sql` check shows zero rows left for the drill org and user.
- [ ] **Step 6: Commit**: `git commit -am "feat(drills): hosted-buyer claim block with forged-session bind and claimed-org teardown"`

---

### Task 3: Checkout, synthetic completed-webhook, idempotency, plan flip

**Files:**
- Modify: `scripts/drills/hosted-buyer.mjs`

**Interfaces:**
- Consumes: `sessionCookie()` bound to trial org (Task 2); `sql`.
- Produces: globals `stripeCustomerId` (read from DB after checkout), `subscriptionId = 'sub_drill_' + runId`, helper `postSignedWebhook(type, object, eventId)` returning the parsed response; the org is on plan `indie` when this task's steps pass.

- [ ] **Step 1: Implement step `checkout`**: `POST /api/billing/checkout`, headers: session cookie; body `{"plan":"indie"}` → assert `200` and body `url` matching `/^https:\/\/checkout\.stripe\.com\//`. Then `sql`-read the org row and capture `stripe_customer_id` (assert non-null — the route creates the customer before the session). Register teardown **now**: `stripe.customers.del(stripeCustomerId)` via the `stripe` SDK with `STRIPE_SECRET_KEY` (nothing else in the codebase ever deletes it).
- [ ] **Step 2: Implement the signed-webhook helper**:

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
async function postSignedWebhook(type, object, eventId) {
  const payload = JSON.stringify({ id: eventId, object: 'event', type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload, secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  return { status: res.status, body: await res.json() };
}
```

- [ ] **Step 3: Implement step `webhook-completed`**: POST a `checkout.session.completed` with `object = { customer: stripeCustomerId, subscription: subscriptionId, metadata: { org_id: orgId, plan: 'indie' } }`, `eventId = 'evt_drill_completed_' + runId` → assert `200` and `body.received === true` and `body.duplicate !== true`. Register teardown: `sql` delete of `stripe_webhook_events` rows whose `event_id LIKE 'evt_drill_%' || runId`.
- [ ] **Step 4: Implement step `webhook-idempotent`**: POST the IDENTICAL event again → assert `200` and `body.duplicate === true`.
- [ ] **Step 5: Implement step `plan-flip`**: `sql`-poll the org row (2s interval, 75s timeout — claim-flow's precedent) until `plan = 'indie'`; then assert `subscription_status = 'active'`, `stripe_subscription_id = subscriptionId`, `trial_action_cap IS NULL`. (DB flip is immediate; the poll allowance is for the behavioral checks in Task 4 that go through middleware's 60s org-facts cache — polling here keeps one pattern.)
- [ ] **Step 6: Run** `npm run drill:buyer` → PASS through `plan-flip`, exit 0, teardown leaves no org/user/webhook-event rows and the Stripe test dashboard shows the customer deleted (assert via `stripe.customers.retrieve` throwing `resource_missing` in the teardown's own verification line).
- [ ] **Step 7: Commit**: `git commit -am "feat(drills): hosted-buyer checkout + signed synthetic webhook + plan flip"`

---

### Task 4: Entitlement proof — seat-cap 409 and action-ceiling 403

**Files:**
- Modify: `scripts/drills/hosted-buyer.mjs`

**Interfaces:**
- Consumes: org on `indie` (Task 3); `sessionCookie()`; `apiKey`; `sql`.
- Produces: nothing new for later tasks; the org's `usage_rollups` row for the current period exists at `governed_actions = 50000` after the ceiling step (Task 5 depends on it still being there for the post-cancel assertion).

- [ ] **Step 1: Implement step `seat-cap`**: `POST /api/team/invites` (session cookie) body `{"email":"drill-invite-1-<runId>@example.com"}` → assert `201` (1 member + 0 invites < 2). Second POST `{"email":"drill-invite-2-<runId>@example.com"}` → assert `409` with `body.code === 'SEAT_CAP_REACHED'` and `body.seat_cap === 2`. **Sabotage hook**: when `--sabotage` is set, assert `200` here instead — this MUST fail the drill. Invite rows are cleaned by the existing FK sweep (verify in Step 4; if `invites` rows survive, add an explicit `sql` delete to teardown).
- [ ] **Step 2: Implement step `ceiling-seed`**: upsert the rollup:

```js
const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM' UTC
await sql`INSERT INTO usage_rollups (org_id, period, governed_actions, blocked_actions)
  VALUES (${orgId}, ${period}, 50000, 0)
  ON CONFLICT (org_id, period) DO UPDATE SET governed_actions = 50000, updated_at = NOW()`;
```

Register teardown: `sql` delete of that row (before the FK sweep runs; double-delete is harmless).
- [ ] **Step 3: Implement step `ceiling-403`**: poll `POST /api/actions` with `x-api-key` (a minimal valid action body — copy the shape from hosted-stranger's `first-action` step) every 5s up to 75s until it returns `403` with `body.code === 'ACTION_CEILING_REACHED'`; then assert `body.monthly_action_ceiling === 50000`. The poll rides out middleware's 60s org-facts cache (the plan flip must be visible to middleware before the ceiling arms). A 2xx during the poll window is tolerated-and-retried; any OTHER status fails immediately. NOTE: each tolerated 2xx creates a real governed action AND increments the rollup past 50000 — that's fine, the assert is `>=`-based server-side; just don't assert an exact `governed_actions` count.
- [ ] **Step 4: Run** `npm run drill:buyer` → PASS through `ceiling-403`. Then run `npm run drill:buyer -- --sabotage` → MUST exit 1 with `DRILL_STEP seat-cap FAIL` (L1: the check has now been observed failing). Then verify teardown left zero `invites` and `usage_rollups` rows for the drill org.
- [ ] **Step 5: Commit**: `git commit -am "feat(drills): hosted-buyer entitlement proof (seat-cap 409, ceiling 403) + sabotage switch"`

---

### Task 5: Portal, cancel, free-plan restore

**Files:**
- Modify: `scripts/drills/hosted-buyer.mjs`

**Interfaces:**
- Consumes: `stripeCustomerId`, `subscriptionId`, `postSignedWebhook`, `sql`, `apiKey`; the 50000-row rollup from Task 4 (deliberately NOT cleaned until teardown).
- Produces: org back on `free` with `trial_action_cap = 10000`.

- [ ] **Step 1: Implement step `portal`**: `GET /api/billing/portal` (session cookie) → assert `200` and `url` matching `/^https:\/\/billing\.stripe\.com\//`. (Proves the customer link is live; the cancel itself arrives as the webhook Stripe would send after a portal cancel.)
- [ ] **Step 2: Implement step `webhook-canceled`**: `postSignedWebhook('customer.subscription.deleted', { id: subscriptionId }, 'evt_drill_deleted_' + runId)` → assert `200`, `received: true`.
- [ ] **Step 3: Implement step `free-restore`**: `sql`-poll (2s/75s) until org `plan = 'free'`; then assert `subscription_status = 'canceled'`, `stripe_subscription_id IS NULL`, `trial_action_cap = 10000` (the cancel path restores the free-tier cap for hosted orgs — this is the spec's "trial cap restored").
- [ ] **Step 4: Implement step `ceiling-gone`**: poll `POST /api/actions` (x-api-key, 5s/75s) until it returns 2xx again — the `usage_rollups` row still says ≥50000, but `free` has `monthlyActionCeiling: null`, so a success PROVES the ceiling was plan-scoped, not sticky. (The free-tier `trial_action_cap` of 10000 vs `trial_actions_used` of ~4 does not interfere.) A `403 ACTION_CEILING_REACHED` during the window is tolerated-and-retried (cache); any other non-2xx fails.
- [ ] **Step 5: Run** `npm run drill:buyer` → full PASS through `ceiling-gone`, exit 0.
- [ ] **Step 6: Commit**: `git commit -am "feat(drills): hosted-buyer portal + cancel + free-plan restore proof"`

---

### Task 6: Export, final verdict, and the two-consecutive-green verification

**Files:**
- Modify: `scripts/drills/hosted-buyer.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished drill.

- [ ] **Step 1: Implement step `export`**: `GET /api/workspace/export` with `x-api-key` → assert `200`, parseable JSON, `exported_at` present (same assertion hosted-stranger uses).
- [ ] **Step 2: Final output audit**: confirm the script prints one `DRILL_STEP <id> PASS|FAIL <detail>` line per step in order (`mint`, `key-works`, `first-action`, `claim-preview`, `claim`, `claim-db-truth`, `checkout`, `webhook-completed`, `webhook-idempotent`, `plan-flip`, `seat-cap`, `ceiling-seed`, `ceiling-403`, `portal`, `webhook-canceled`, `free-restore`, `ceiling-gone`, `export`), a final `DRILL_VERDICT PASS|FAIL` line, exit 0 only on all-PASS. Grep the file for `sk_`, `whsec_`, `NEXTAUTH` in any `console.log` template — none may be printable.
- [ ] **Step 3: Run the drill twice consecutively** against the local instance: `npm run drill:buyer && npm run drill:buyer` → both exit 0 (the spec's own verify criterion). The second run also proves teardown left the instance clean enough to re-drill (the per-IP mint limit allows 5/day — two runs fit; if a dev run earlier in the session ate the budget, raise `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` in `.env.local` for the local instance and say so in the report).
- [ ] **Step 4: Repo gates**: `npm run lint`, `npm run typecheck`, `npm test` — all green (the drill is plain JS outside `tsc`'s app scope, but run all three anyway and read the output).
- [ ] **Step 5: Commit**: `git commit -am "feat(drills): hosted-buyer export step + full money-path verdict"`

---

### Task 7: Docs — drills README entry (+ CHANGELOG if convention demands)

**Files:**
- Modify: `scripts/drills/README.md`
- Maybe modify: `CHANGELOG.md` (read its recent entries first; add an entry ONLY if previous drill additions got one — match the repo's own convention, don't invent a version bump)

**Interfaces:**
- Consumes: the finished drill.
- Produces: the "gate wiring" per the approved deviation — the drill is discoverable and mandated pre-release.

- [ ] **Step 1: Add a `hosted-buyer.mjs` section to `scripts/drills/README.md`** matching the existing entries' format: what it proves (the full money path), required env (`HOSTED_DRILL_TOKEN`, `DATABASE_URL`, `NEXTAUTH_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` — note these are operator secrets, set only for the drill run, rotate `HOSTED_DRILL_TOKEN` after per the drill-mint spec), when to run it (**before any release touching billing, entitlements, claim, hosted middleware, or the Stripe webhook**), the `--sabotage` self-test flag, and the warning that a run against a live-keyed instance creates a real never-charged Stripe customer (deleted in teardown) and therefore needs explicit approval.
- [ ] **Step 2: Check git history for the CHANGELOG convention**: `git log --oneline -5 -- scripts/drills/` then inspect whether those commits touched `CHANGELOG.md`. Follow what you find.
- [ ] **Step 3: Commit**: `git add scripts/drills/README.md CHANGELOG.md && git commit -m "docs(drills): document hosted-buyer money-path drill"` (drop CHANGELOG from the add if Step 2 said no).

---

### Task 8 (GATED — do not run without explicit Wes approval in session): Hosted run

**Files:** none.

This is the spec's final verify: "drill exits 0 twice consecutively against `hosted.dashclaw.io`." It requires the production instance's operator secrets in the drill's env and it creates a live-mode Stripe customer (never charged, deleted in teardown) plus drill rows in the production DB (torn down). **Hard stop applies** (production Stripe + production data). The executor must:

- [ ] **Step 1: STOP and present to Wes**: exact command, env vars it will read, what it creates in prod (1 drill org, 1 seeded user, 1 live Stripe customer + checkout session, 2 webhook-event rows, 1 rollup row), what teardown removes, and the rollback (teardown is idempotent; manual cleanup = the un-claim + FK-sweep SQL + `stripe.customers.del`).
- [ ] **Step 2 (only after approval): run twice**, capture both verdict blocks, verify Stripe dashboard shows the customer deleted, verify the DB holds no drill rows.
- [ ] **Step 3: Report results** in the Practical Systems plan-001 tracking (memory + `docs/plans/` note): Plan A's launch-gate criterion status.

---

## Self-review (done at write time)

- **Spec coverage**: mint→act (T1), claim (T2), checkout+webhook+flip (T3), seat-cap 409 + ceiling 403 with sanctioned stubbed rollup (T4), portal cancel + free restore (T5), export+teardown+two-green (T6), gate wiring per approved deviation (T7), hosted verify (T8, gated). "4242" replaced by signed synthetic webhooks — approved deviation #2.
- **Known judgment calls baked in**: session cookie re-minted post-claim (avoids 60s cache flake); teardown ordering (webhook-events + rollup deletes registered before the FK sweep; Stripe customer delete independent); sabotage flag as the permanent L1 switch.
- **Types/names consistent**: `runId`, `orgId`, `stripeCustomerId`, `subscriptionId`, `postSignedWebhook`, `mintSessionCookie` used identically across tasks.
- **Open risk, surfaced not hidden**: exact mint-response field names and the minimal `POST /api/actions` body are deliberately specified as "copy from hosted-stranger.mjs" rather than transcribed here — transcription without the file open is how wrong field names ship. Task 1 Step 1 makes reading those files mandatory.
