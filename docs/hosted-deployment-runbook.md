---
owner: Ops
last-verified: 2026-06-09
doc-type: runbook
---

# Hosted DashClaw deployment runbook

This runbook deploys DashClaw as a hosted service, for example `hosted.dashclaw.io`, where visitors can mint trial workspaces via `/connect`. It is the ops companion to the hosted provisioning code already in this repo.

**Who this is for:** the operator standing up the hosted instance. Self-host users do not need this. They should follow `QUICK-START.md`.

**Estimated time:** about 45 minutes the first time, about 10 minutes after that.

---

## What is already in the repo

The current repo already includes the main hosted-mode code paths:

- `app/api/hosted/workspaces/route.js` for trial provisioning
- `app/api/hosted/workspaces/[workspaceId]/route.js` for admin inspection and deletion
- `app/api/hosted/cleanup/route.js` for trial cleanup
- `app/connect/HostedProvisionSection.jsx` and `app/connect/HostedProvisionClient.jsx` for the hosted mint UI
- `scripts/check-hosted-ready.mjs` for pre-deploy readiness checks
- `scripts/smoke-hosted.mjs` for post-deploy smoke testing
- `migrations/2026-04-18-hosted-trial-columns.sql` for hosted trial columns and index
- `vercel.json` cron entry for `/api/hosted/cleanup`

What is **not** done by the repo alone is provisioning external operator infrastructure like Neon, Vercel, Cloudflare Turnstile, and DNS.

---

## Prerequisites

- [ ] GitHub repo access with push rights to `main`
- [ ] Vercel account
- [ ] Neon account
- [ ] Cloudflare account
- [ ] Optional custom domain

---

## 1. Provision Neon Postgres

1. Go to https://console.neon.tech and create a new project.
2. Choose a region close to your Vercel deployment.
3. Copy the pooled `DATABASE_URL`.

Keep that value safe. You will paste it into Vercel.

---

## 2. Create Cloudflare Turnstile keys

1. Go to https://dash.cloudflare.com
2. Open Turnstile and add a new site.
3. Use your future hosted domain, or `*.vercel.app` for initial testing.
4. Choose `Managed` widget mode.
5. Copy both keys:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`

---

## 3. Generate secrets

Run these locally from any machine with Node installed:

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('HOSTED_CLEANUP_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('DASHCLAW_API_KEY=oc_live_' + require('crypto').randomBytes(16).toString('hex'))"
node -e "console.log('NEXTAUTH_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
```

Recommended too, if you do not already have one for the deployment:

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url').slice(0,32))"
```

Save all values.

---

## 4. Create the Vercel project

1. Go to https://vercel.com/new
2. Import the DashClaw repo
3. Framework preset should auto-detect as Next.js
4. Leave the build command as default, because `vercel.json` already sets:

```json
"buildCommand": "node scripts/auto-migrate.mjs && next build"
```

5. Add these production environment variables:

| Name | Required | Notes |
|---|---:|---|
| `DASHCLAW_HOSTED` | yes | set to `true` |
| `DATABASE_URL` | yes | from Neon |
| `DASHCLAW_API_KEY` | yes | admin key for hosted workspace inspection and deletion |
| `ENCRYPTION_KEY` | yes | standard DashClaw production secret |
| `TURNSTILE_SECRET_KEY` | yes | from Cloudflare |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | recommended | needed for visible widget rendering |
| `HOSTED_CLEANUP_SECRET` | recommended | used by GitHub Actions cleanup |
| `CRON_SECRET` | recommended | used by Vercel cron auth |
| `HOSTED_TRIAL_DAYS` | optional | defaults to `30` |
| `HOSTED_TRIAL_ACTION_CAP` | optional | defaults to `10000` |
| `HOSTED_MAX_ACTIVE_TRIALS` | optional | global concurrent-trial cap (cost circuit breaker); defaults to `500` |
| `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` | optional | defaults to `5` |
| `GOOGLE_ID` | recommended | Google OAuth client ID — enables one-tap sign-in trials (see "Instant trial" below) |
| `GOOGLE_SECRET` | recommended | Google OAuth client secret |
| `NEXTAUTH_URL` | yes | final deployment URL |
| `NEXTAUTH_SECRET` | yes | required by NextAuth |
| `ALLOWED_ORIGIN` | recommended | set to your hosted app origin |

Then deploy.

### Instant trial via Google sign-in (the prod flip)

> **Quick checklist:** for the minimum Vercel env steps to switch this on, see
> [`instant-trial-vercel-setup.md`](./instant-trial-vercel-setup.md). The detail below is the full context.

Beyond the curl/`/connect` mint flow above, the hosted instance offers a zero-friction trial: a visitor clicks **"Govern your Claude — free"** on the landing page, signs in with Google, and is auto-provisioned an isolated, usage-capped trial workspace — no key to copy. They connect Claude through the keyless OAuth connector on the stripped `/connect?hosted=<orgId>` screen, and their actions stream to their own Mission Control. To enable it:

- **`DASHCLAW_HOSTED=true`** (already required above) gates trial provisioning on sign-in, the public `GET /api/hosted/capacity` endpoint, and the landing CTA.
- **`GOOGLE_ID` + `GOOGLE_SECRET`** — Google OAuth is the trial identity (so a user can return to their workspace). Set the OAuth redirect URI to `https://<your-host>/api/auth/callback/google`.
- **`HOSTED_MAX_ACTIVE_TRIALS`** (default `500`) is the hard global cap on concurrent active trials — the cost circuit breaker. At the cap, new sign-ins land on a "trials are full" state and provision nothing (fail-closed, zero spend). Tune it to your infra budget. Note: `0` or blank falls back to `500` (the cap parser only accepts positive integers), so to effectively pause new trials, take the deployment down rather than setting the cap to `0`.
- **Do NOT set `DASHCLAW_MODE=demo`.** Demo is cookie-driven: anonymous visitors who click "Run live demo" get fixtures, while an authenticated session bypasses demo and gets the real runtime. Setting `DASHCLAW_MODE=demo` as an env forces demo for **everyone** (including signed-in trial users) and breaks the trial. Leave it unset.
- **Build-time note:** the landing page is statically prerendered and reads `DASHCLAW_HOSTED` at **build** time to decide its hero layout (which CTA is the primary). Vercel exposes project env vars to the build by default, so setting `DASHCLAW_HOSTED=true` as a **project** env (not a runtime-only override) is what makes the hosted hero render.
- **Cleanup:** expired trials are reclaimed by `/api/hosted/cleanup` (see section 7). The repo's `.github/workflows/hosted-cleanup.yml` runs it daily — add the `DASHCLAW_BASE_URL` + `HOSTED_CLEANUP_SECRET` repo secrets to enable it. Expiry is also enforced at request time, so trials stop working on expiry even if cleanup lags.

---

## 5. Validate the deployment

### Readiness check

Run locally against the same env values you plan to use in production:

```bash
DASHCLAW_HOSTED=true DATABASE_URL=<neon-url> TURNSTILE_SECRET_KEY=<turnstile-secret> DASHCLAW_API_KEY=<admin-key> NEXT_PUBLIC_TURNSTILE_SITE_KEY=<turnstile-site> HOSTED_CLEANUP_SECRET=<cleanup> npm run hosted:check-ready
```

Expected result:

```text
[hosted:check-ready] status=pass
```

If optional hosted safeguards are missing, the command exits 0 with `status=warn`
and prints `NEXT:` on each warning line. Any `status=fail` line exits non-zero
and includes the required next action.

### Smoke test

After the Vercel deployment is live:

```bash
HOSTED_SMOKE_BASE_URL=https://your-deploy.vercel.app DASHCLAW_API_KEY=<admin-key> npm run hosted:smoke
```

Expected result:

```text
[smoke] PASS
```

### Manual browser checks

Open these pages:

- `/connect`
- `/setup`

On `/connect`, confirm:

- the hosted trial section appears
- the Turnstile widget appears if site key is configured
- clicking the mint button returns a workspace ID, API key, and config snippet

On `/setup`, confirm the page renders the "Deployment truth surface" with green database, schema, and environment sections. `/api/setup/status` returns the same report as JSON if you need to diff it against the UI.

---

## 6. Configure your custom domain

1. Add your subdomain in Vercel, for example `hosted.dashclaw.io`
2. Add the DNS record Vercel asks for
3. Update the Turnstile allowed domain list
4. Update `NEXTAUTH_URL`
5. Redeploy

---

## 7. Schedule trial cleanup

Pick one.

### Option A, Vercel cron

Already configured in `vercel.json`:

```json
{ "path": "/api/hosted/cleanup", "schedule": "0 3 * * *" }
```

This route accepts:

- `Authorization: Bearer $CRON_SECRET`
- or `x-cleanup-secret: $HOSTED_CLEANUP_SECRET`
- or an authenticated admin request

### Option B, GitHub Actions cron

Add these repo secrets:

- `DASHCLAW_BASE_URL`
- `HOSTED_CLEANUP_SECRET`

Then call:

```bash
curl -X POST "$DASHCLAW_BASE_URL/api/hosted/cleanup" -H "x-cleanup-secret: $HOSTED_CLEANUP_SECRET"
```

---

## 8. Monitoring

Minimum recommended monitoring:

- Vercel deployment logs, especially `[HOSTED]` errors
- hosted trial rows in `organizations` where `hosted_mode = true`
- daily cleanup success
- periodic `npm run hosted:smoke` against production
- periodic `curl https://your-deploy.vercel.app/api/health` for machine-readable health
- `npm run doctor` locally with production-equivalent env, or `GET /api/doctor` on the deployed instance when diagnosing runtime drift

### Observability map

| Production symptom | First signal | Vercel/function signal | DashClaw route to correlate | Next action |
|---|---|---|---|---|
| Provisioning returns 404 | `/api/hosted/capacity` returns 404 | Vercel Function logs for `app/api/hosted/*` show hosted mode disabled or no invocation | `/api/doctor` Hosted section, `npm run hosted:check-ready` | Confirm `DASHCLAW_HOSTED=true` is set for Production and redeploy. |
| Provisioning returns 403 or Turnstile errors | Browser Network tab for `/api/hosted/workspaces` | Function logs for `app/api/hosted/workspaces/route.js`; look for `[HOSTED]` validation failures | `/api/doctor` Hosted section | Confirm `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` match the Cloudflare site and deployed domain. |
| Provisioning returns 429 | Response status from `/api/hosted/workspaces` | Function logs for the hosted workspace route; Vercel route/function insights for request volume | `/api/doctor` Hosted rate-limiter check | Check `HOSTED_PROVISION_MAX_PER_IP_PER_DAY`; on serverless production, add `UPSTASH_REDIS_REST_URL` or `REDIS_URL` if per-IP limits need to survive cold starts. |
| `/connect` shows no hosted trial CTA | Page source or browser render after deploy | Vercel build log; confirm env was present at build time | `/api/hosted/capacity`, `/api/doctor` | Redeploy after setting `DASHCLAW_HOSTED=true`; the landing and connect surfaces read the hosted flag during build. |
| New workspaces do not appear in Mission Control | Database query for hosted rows and browser dashboard state | Function logs for provisioning and dashboard API routes | `/api/health`, `/api/doctor` Database section | Verify `DATABASE_URL`, run setup migrations from `/setup` if tables are missing, then retry provisioning. |
| Cleanup did not run | Cron provider history | Vercel Cron or GitHub Actions log for `/api/hosted/cleanup` | `/api/health`; cleanup route response body | Confirm `CRON_SECRET` or `HOSTED_CLEANUP_SECRET` matches the caller header and rerun the cleanup request manually. |

Basic health does not require paid Vercel Observability. Start with Vercel deployment logs, the affected route's function logs, `/api/health`, `/api/doctor`, and `/setup`. Vercel route/function insights are optional production aids for traffic volume and latency trends.

---

## 9. Rollback

If hosted provisioning breaks:

1. Promote the last known-good Vercel deployment
2. Restore Neon if a destructive schema change slipped through
3. If only env changed, revert the Vercel env var and redeploy instead of rolling code back
4. Reproduce locally with:

```bash
DASHCLAW_HOSTED=true npm run dev
```

---

## 10. Operator handoff checklist

Before calling the hosted deployment ready, verify all of this:

- [ ] Neon database created
- [ ] Vercel project deployed successfully
- [ ] Hosted env vars added
- [ ] Turnstile site and secret keys configured
- [ ] `npm run hosted:check-ready` passes
- [ ] `npm run hosted:smoke` passes
- [ ] `/connect` hosted trial mint works end to end
- [ ] `/api/hosted/cleanup` works via chosen cron path
- [ ] Custom domain and `NEXTAUTH_URL` updated if using branded host

---

Runbook last verified: 2026-06-07
