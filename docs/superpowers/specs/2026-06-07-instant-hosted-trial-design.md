# Instant Hosted Trial — "Govern your Claude in one tap"

- **Date:** 2026-06-07
- **Status:** Design approved (verbal), pending spec review
- **Owner:** Wes
- **Type:** Feature — hosted onboarding

## Goal

A non-technical person ("my dad") signs in with Google and has a live, isolated,
usage-capped governed workspace on our hosting in ~30 seconds — no download, no
deploy, no secrets, no terminal — then connects their Claude with a single
paste-one-URL OAuth connector.

## Scope (v1)

- **Free, capped trial workspace**, one per Google account. No billing.
- **Google sign-in** is the identity (durable — the user can return to their workspace).
- Runs on **our hosting** (dashclaw.io), entirely on **free service tiers**.

## Non-goals (explicitly out for v1)

- No billing / paid tiers / Stripe (deferred to a later milestone; the existing FinOps/spend work is unrelated).
- No anonymous trials (an unreclaimable workspace is a worse product).
- No desktop app / native installer.
- No new multi-tenancy work — isolation already exists and is tested (see below).
- No change to the governance boundary (still a governance runtime, not an agent platform).

## Why this is small (the key finding)

DashClaw is **already multi-tenant**, and most of the machinery exists and is tested:

- `organizations` table already carries the trial fields: `hosted_mode`,
  `trial_ends_at`, `trial_action_cap`, `trial_actions_used` (`schema/schema.js:19-34`).
- Org isolation is resolved server-side from the credential; inbound `x-org-id`
  spoofing is stripped and **regression-tested** (`middleware.js:1181-1208`;
  `__tests__/unit/s18-identity-finops.regression.test.ts:81-93`).
- `enforceHostedTrial` already 403s on expiry / cap on **every** request
  (`middleware.js:415-435`), counter incremented per action
  (`app/api/actions/route.ts:295`); end-to-end tested
  (`__tests__/integration/hosted/end-to-end.test.js`).
- `POST /api/hosted/workspaces` already provisions an isolated org + admin key +
  workspace URL (`app/api/hosted/workspaces/route.ts` → `provisionHostedWorkspace`
  in `app/lib/repositories/hosted-workspace.repository.ts:16-48`).
- Google/GitHub sign-in **already auto-creates a personal isolated org** per new
  user (`app/lib/auth.ts:133-152`).

The gap: **nothing in the UI calls any of it** (operator/curl-only today), and the
Google-signup org isn't stamped as a trial or given an API key. This feature
closes that gap.

## The dad flow

1. **dashclaw.io** hero CTA: **"Govern your Claude — free."**
2. Click → **Sign in with Google** (one tap; NextAuth already wired).
3. First sign-in auto-provisions the workspace (see "signIn extension").
4. Redirect to a minimal **"Add to Claude"** screen: hero is the **OAuth connector**
   (`https://dashclaw.io/api/mcp` → Authorize, *no key*); the API key is secondary,
   under "Advanced (SDK/CLI)."
5. Dad adds the connector in Claude Desktop → authorizes with the **same Google** →
   his org resolves from the session → his Claude is governed; actions stream to
   **his** Mission Control (org-scoped, already works).

Because the connector's Authorize also runs the NextAuth `signIn` callback,
connector-first works too: adding the connector and authorizing auto-creates the
workspace, making steps 1–4 optional.

## Architecture / components

### Reused unchanged
Org model + trial fields; server-side org isolation; `enforceHostedTrial`
caps/expiry; per-user org creation on sign-in; the OAuth connector + `/api/mcp`;
org-scoped Mission Control; the per-IP provision rate limit.

### New / changed (small)

**1. `signIn` extension (`app/lib/auth.ts`).**
When `isHostedMode()` is true and the callback creates a **new** personal org
(non-founder path, `auth.ts:133-152`), additionally:
- stamp trial fields: `hosted_mode=true`, `trial_ends_at = now + HOSTED_TRIAL_DAYS`,
  `trial_action_cap = HOSTED_TRIAL_ACTION_CAP`, `trial_actions_used=0`.

**As built (deviation from the original key-mint design):** the sign-in path stamps
trial fields **only** — it does **not** mint an API key. Keys are hashed/shown-once and
the OAuth connector (the dad-flow hero) needs none; SDK/CLI users mint their own key at
`/api-keys`. The `mintOrgApiKey` helper is still extracted and reused by the anonymous
`provisionHostedWorkspace` path. Idempotent: an existing org (returning user) is never re-trialed.
Refactor the trial-stamp + key-mint logic out of `provisionHostedWorkspace` into a
shared helper (e.g. `applyHostedTrial(sql, orgId, opts)` + `mintOrgApiKey(sql, orgId)`)
used by both the anonymous endpoint and this path. **No new SQL in route files**
(repository pattern).

**2. Global trial cap — the cost circuit breaker (new).**
Add `HOSTED_MAX_ACTIVE_TRIALS` (env, default e.g. 500). Before provisioning a new
trial (both the `signIn` path and `/api/hosted/workspaces`), count active hosted
orgs (`hosted_mode=true AND trial_ends_at > now`); if `>= cap`, do **not** provision
— the new user lands on a "trials are full, check back soon / join waitlist" state,
and (connector path) the authorize returns a clear "trials full" error. Fail-closed.

**3. Hosted "Add to Claude" screen (frontend).**
A stripped variant of `/connect` for trial users, selected by a `?hosted=<orgId>`
query param (not a new route): OAuth-connector-first (no key in the hero), API key
revealed under an "Advanced" disclosure, a link to their Mission Control. Must follow `.impeccable.md`
(read at build time; tokens not hex; calm, developer-reader voice; no crypto framing).

**4. Landing CTA (frontend).**
"Govern your Claude — free" on `app/page.js` / `app/landingData.js` → Google sign-in →
hosted screen. Follows `.impeccable.md`.

## Cost & safety (the explicit gate: must not surprise-bill)

- **Free tiers only:** Vercel Hobby, Neon free, Upstash free (realtime), Cloudflare
  Turnstile, Google OAuth. **Free tiers throttle/error; they do not auto-charge.**
  The only way to incur cost is a manual paid-plan upgrade — which v1 does not do.
- **Hard global cap** (`HOSTED_MAX_ACTIVE_TRIALS`) bounds total concurrent trials →
  bounds DB + compute. This is the runaway circuit breaker.
- **Tight per-trial caps** keep each org's footprint small (default 30-day window,
  10k-action cap — tunable down). Bounds Neon storage per org.
- **Auto-cleanup** of expired trials via the existing `POST /api/hosted/cleanup`,
  scheduled by a **free GitHub Actions cron** (Vercel free tier has no cron). Reclaims
  Neon storage so total stays bounded. Note: expiry is already enforced at request
  time, so trials stop working on expiry even if cleanup lags — cleanup only reclaims rows.
- **Fail-closed:** every limit (global cap, per-trial cap, expiry, per-IP rate) stops
  new work; none triggers spend.
- **Known scaling watch-points (not v1 blockers):** Neon free plan storage/compute
  limits and Vercel Hobby bandwidth/function limits are the first ceilings under real
  volume; the caps + cleanup keep us under them for a launch. Revisit before any
  marketing push.

## Operator prerequisites (your decisions)

- **Flip dashclaw.io from demo-only to hosted (approved).** Recommended model: do
  **not** force `DASHCLAW_MODE=demo` as an env; make demo **cookie-driven** (anonymous
  "kick the tires" sets the cookie), set **`DASHCLAW_HOSTED=true`**, and clear the demo
  cookie on login. Result: anonymous visitors still get the fixture demo; signed-in
  users get a real trial on the live runtime.
- **Env to set on prod:** `DASHCLAW_HOSTED=true`, Google OAuth creds, `NEXTAUTH_SECRET`,
  `DATABASE_URL` (Neon), `HOSTED_TRIAL_DAYS`, `HOSTED_TRIAL_ACTION_CAP`,
  `HOSTED_MAX_ACTIVE_TRIALS`, `HOSTED_CLEANUP_SECRET`, optionally `TURNSTILE_*` and
  Upstash for realtime.
- **GitHub Actions cron** calling `/api/hosted/cleanup` with the cleanup secret.

## Error handling

- **Trials full** (global cap): friendly "trials are full" screen / connector error;
  no org created.
- **Trial expired / cap reached:** existing `enforceHostedTrial` 403 with a clear
  message + an upgrade/"start fresh" CTA on the dashboard.
- **Provisioning failure** (key mint fails after org create): best-effort org cleanup
  (pattern already in `provisionHostedWorkspace`); user sees a retry, not a half-org.
- **Returning user:** sign-in reuses the existing org; never double-provisions.

## Testing

- **Isolation (regression):** new trial org cannot read another org's data; spoofed
  `x-org-id` ignored (extend the existing s18 regression test for the signIn path).
- **signIn provisioning:** new Google user in hosted mode → org stamped trial + exactly
  one admin key; returning user → no second org, no second key.
- **Global cap fail-closed:** at `HOSTED_MAX_ACTIVE_TRIALS`, a new sign-in does NOT
  create an org and returns the "full" state.
- **Cap/expiry enforcement:** reuse/extend `__tests__/integration/hosted/end-to-end.test.js`.
- **One-trial-per-account:** repeat sign-in idempotent.
- **Demo coexistence:** anonymous (demo cookie) gets fixtures; authenticated gets real runtime.
- Full suite green (`npx vitest run`), lint, webpack build, `route-sql:check`.

## Open questions / caveats

- Default `HOSTED_MAX_ACTIVE_TRIALS` value (start conservative, e.g. 500).
- Trial counter is ~5 min stale via the api-key cache (`middleware.js:423`) — fine for
  a trial, not for billing.
- Many `org_id` columns lack a DB-level FK (`.default('org_default')`); isolation rests
  on the repository pattern + `route-sql:check` guardrail. Out of scope to add FKs here,
  but noted.
- Per-org request rate limiting is per-IP only; abusive single-org traffic from many IPs
  isn't throttled per-org. Acceptable for a trial; abuse-harden later.
