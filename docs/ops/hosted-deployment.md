---
owner: Ops
last-verified: 2026-06-09
doc-type: runbook
---

# Hosted DashClaw deployment runbook

This runbook deploys DashClaw as a hosted service (e.g. `hosted.dashclaw.io`) where visitors can mint trial workspaces via `/connect`. It is the ops companion to the code shipped in Plans 1, 2, and 4.

**Who this is for:** the operator standing up the hosted instance. Self-host users do not need this — they follow `QUICK-START.md`.

**Estimated time:** ~45 minutes first time, ~10 minutes thereafter.

---

## Prerequisites

- [ ] GitHub repo access with push rights to `main`
- [ ] Vercel account (Hobby or Pro — see cron note below)
- [ ] Neon account (free tier is sufficient for trial volume)
- [ ] Cloudflare account (free Turnstile tier)
- [ ] Optional: a registered domain (e.g. `dashclaw.io`) if you want a branded URL

---

## 1. Provision Neon Postgres

1. Go to https://console.neon.tech and click "New Project".
2. Name: `dashclaw-hosted` (or similar).
3. Region: choose the region closest to your Vercel deployment.
4. Copy the `DATABASE_URL` (the "pooled" connection string). Keep it safe — you'll paste it into Vercel.

---

## 2. Create Cloudflare Turnstile keys

1. Go to https://dash.cloudflare.com → Turnstile → Add Site.
2. Name: `DashClaw Hosted`. Domain: your future Vercel domain (or `*.vercel.app` for initial testing).
3. Widget mode: `Managed` (invisible unless suspicious).
4. Copy the **Site Key** (public, prefix `0x4...`) and **Secret Key** (private, prefix `0x4...`).

---

## 3. Generate cron + cleanup secrets

Run locally to generate two random hex strings:

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('HOSTED_CLEANUP_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Save both values — you'll paste them into Vercel, and if you use the GitHub Actions cron, into repo secrets too.

---

## 4. Generate an admin API key

The hosted instance needs an admin key so you can inspect/delete trial workspaces via `/api/hosted/workspaces/:id`:

```bash
node -e "console.log('DASHCLAW_API_KEY=oc_live_' + require('crypto').randomBytes(16).toString('hex'))"
```

This matches the key format the code expects (`oc_live_` + 32 lowercase hex chars). Save it.

---

## 5. Create the Vercel project

1. Go to https://vercel.com/new → Import the `DashClaw` repo.
2. Framework preset: Next.js (auto-detected).
3. Build command: leave default (`vercel.json` defines it).
4. Under **Environment Variables**, set the following on the `Production` environment:

| Name | Value | Source |
|:---|:---|:---|
| `DASHCLAW_HOSTED` | `true` | enables all Plan 1 routes |
| `DATABASE_URL` | from Neon (step 1) | |
| `DASHCLAW_API_KEY` | generated above (step 4) | admin key; do not leak |
| `TURNSTILE_SECRET_KEY` | from Cloudflare (step 2) | |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare (step 2) | public-safe; renders widget |
| `HOSTED_CLEANUP_SECRET` | generated above (step 3) | used by GH Actions cron |
| `CRON_SECRET` | generated above (step 3) | used by Vercel cron |
| `HOSTED_TRIAL_DAYS` | `30` | optional — default is 30 |
| `HOSTED_TRIAL_ACTION_CAP` | `10000` | optional — default is 10000 |
| `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` | `5` | optional — default is 5 |
| `NEXTAUTH_URL` | your final domain (see step 7) | required by NextAuth |
| `NEXTAUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | required by NextAuth |

5. Click **Deploy**. The build runs `node scripts/auto-migrate.mjs && next build`, which applies the Plan 1 schema migrations automatically on first deploy.

---

## 6. Validate the deployment

Once Vercel reports `Ready`:

```bash
# Locally, from the repo root, run the smoke test against the deployed URL:
HOSTED_SMOKE_BASE_URL=https://your-deploy.vercel.app DASHCLAW_API_KEY=<admin-key> npm run hosted:smoke
```

Expected: `[smoke] PASS`.

Also run the readiness checker (locally, with the same env vars you set on Vercel) to confirm nothing is missing:

```bash
DASHCLAW_HOSTED=true DATABASE_URL=<neon-url> TURNSTILE_SECRET_KEY=<turnstile-secret> \
  DASHCLAW_API_KEY=<admin-key> NEXT_PUBLIC_TURNSTILE_SITE_KEY=<turnstile-site> \
  HOSTED_CLEANUP_SECRET=<cleanup> npm run hosted:check-ready
```

Expected: `status=pass`. If optional safeguards are missing, the command exits 0 with `status=warn` and prints `NEXT:` on each warning line. `status=fail` exits non-zero and includes the required next action.

Manually verify in a browser:
- Open `https://your-deploy.vercel.app/connect`
- Confirm the "Try it hosted" section appears at the top
- Click "Mint trial workspace for Claude Code"
- Confirm the workspace ID + api_key + pre-filled config block appear
- Open `https://your-deploy.vercel.app/setup` and confirm status is green

---

## 7. Configure your custom domain (optional)

1. In the Vercel project → Settings → Domains, add `hosted.dashclaw.io` (or your preferred subdomain).
2. Vercel shows the required DNS record (usually a CNAME to `cname.vercel-dns.com`).
3. Add that record at your domain registrar. Propagation typically takes under an hour.
4. **Update Cloudflare Turnstile**: Step 2 used a placeholder domain; add your real domain to the Turnstile site's allowed list and redeploy so the widget loads correctly.
5. **Update `NEXTAUTH_URL`** in Vercel env vars to the new domain and redeploy.

---

## 8. Schedule trial cleanup

Pick ONE of:

### Option A — Vercel cron (requires a plan that supports ≥ 2 crons)

Already configured in `vercel.json`. Vercel automatically schedules `POST /api/hosted/cleanup` daily at 03:00 UTC using the `Authorization: Bearer $CRON_SECRET` header.

No additional setup — if your plan supports it, it's already active after deploy.

### Option B — GitHub Actions cron (free-tier-friendly)

1. In the GitHub repo Settings → Secrets and variables → Actions, add:
    - `DASHCLAW_BASE_URL` = your Vercel URL
    - `HOSTED_CLEANUP_SECRET` = the value from step 3
2. In Actions tab, enable the **Hosted cleanup** workflow.
3. First run: Actions → "Hosted cleanup" → "Run workflow" → confirm HTTP 200 in the log.

If you use Option B, you can safely remove the `{ "path": "/api/hosted/cleanup", ... }` entry from `vercel.json` (but it's harmless to leave it).

---

## 9. Monitoring

Minimal recommended setup:
- [ ] Vercel deployment log tail — check for `[HOSTED]` error lines after each release
- [ ] Neon query console — inspect `organizations WHERE hosted_mode = true` weekly to spot anomalies
- [ ] GitHub Actions → Hosted cleanup log — verify daily green runs
- [ ] `GET /api/health` — poll after deploy and before announcing readiness
- [ ] `GET /api/doctor` or local `npm run doctor` with production-equivalent env — compare Database, Deployment, and Hosted sections against the Vercel env

### Observability map

| Symptom | Inspect | Correlate with | Recovery |
|---|---|---|---|
| Hosted routes return 404 | Vercel function logs for `app/api/hosted/*`; `/api/hosted/capacity` response | `/api/doctor` Hosted section | Set `DASHCLAW_HOSTED=true` in Production and redeploy. |
| Mint requests fail with 403 | Browser Network tab and `app/api/hosted/workspaces/route.js` logs | `/api/doctor` Hosted Turnstile checks | Fix Turnstile site/secret keys and allowed domains, then redeploy. |
| Mint requests hit 429 | Vercel route/function insights for `/api/hosted/workspaces` request volume | Hosted rate-limit warning in `/api/doctor` | Tune `HOSTED_PROVISION_MAX_PER_IP_PER_DAY`; add Redis/Upstash for serverless shared limits if needed. |
| Setup or dashboard shows DB missing | Vercel build/runtime logs and Neon connection state | `/setup`, `/api/health`, `/api/doctor` Database section | Run the setup migration path, verify `DATABASE_URL`, then redeploy if env changed. |
| Cleanup falls behind | Vercel Cron or GitHub Actions run log | `/api/health` and cleanup route response | Check `CRON_SECRET` or `HOSTED_CLEANUP_SECRET`, then manually POST `/api/hosted/cleanup`. |

Beyond minimal (future):
- Sentry for error aggregation
- Datadog / Grafana for request rate + 4xx/5xx ratios
- Slack webhook on `/api/integrations/health` state flips

---

## 10. Rollback

If a release breaks hosted provisioning:

1. Vercel dashboard → Deployments → pick the last known-good deploy → **Promote to Production**.
2. If the schema migrated destructively, restore Neon from the most recent branch (Neon creates automatic branches on DDL). Step-by-step: Neon → Branches → "Reset to snapshot".
3. If the break is env-only, revert the Vercel env var and redeploy rather than rolling code back.
4. File an issue describing the break and investigate locally with `DASHCLAW_HOSTED=true npm run dev`.

---

_Runbook last verified: 2026-04-18 against Plans 1, 2, 4._
