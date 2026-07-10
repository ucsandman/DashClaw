---
owner: Ops
last-verified: 2026-06-07
doc-type: quickstart
---

# Activate Instant Hosted Trials on Vercel — quick checklist

This turns on the **Instant Hosted Trial** flow (shipped in v4.5.0): a visitor clicks
**"Govern your Claude — free"** on the landing page, signs in with Google, and gets an
isolated, usage‑capped governed trial workspace — then connects Claude with a keyless
OAuth connector. Until you do the steps below, the feature is **inert** (the CTA is
hidden, capacity returns 404, sign‑in doesn't trial) — merging the code changed nothing
visible on prod.

For full ops detail (Neon, Turnstile, cron options, rollback) see
[`hosted-deployment-runbook.md`](./hosted-deployment-runbook.md). This page is the
minimum to switch it on.

Throughout, replace `https://dashclaw.io` with your actual production domain.

---

## Step 1 — Create Google OAuth credentials (the trial identity)

1. Go to <https://console.cloud.google.com> → pick or create a project.
2. **APIs & Services → OAuth consent screen** → configure it as **External**, publish it
   (add your email as a test user if you keep it in "Testing").
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. **Authorized JavaScript origins:** `https://dashclaw.io`
5. **Authorized redirect URI** (exactly): `https://dashclaw.io/api/auth/callback/google`
6. Copy the **Client ID** and **Client secret** — they become `GOOGLE_ID` and `GOOGLE_SECRET` below.

## Step 2 — Set the Vercel environment variables (Production scope)

In Vercel → your project → **Settings → Environment Variables**, set these for the
**Production** environment.

### Add (new for this feature)

| Variable | Value | Why |
|---|---|---|
| `DASHCLAW_HOSTED` | `true` | Master switch — enables trial provisioning, `/api/hosted/capacity`, and the landing CTA. |
| `GOOGLE_ID` | *(Client ID from Step 1)* | Google sign‑in (the trial identity). |
| `GOOGLE_SECRET` | *(Client secret from Step 1)* | Google sign‑in. |
| `HOSTED_MAX_ACTIVE_TRIALS` | `500` | Hard global cap on concurrent trials — the fail‑closed cost circuit breaker. Tune to your budget. *(Note: `0` is rejected and falls back to 500 — to pause trials, take the deploy down, don't set 0.)* |
| `HOSTED_CLEANUP_SECRET` | *(a random 32‑byte hex — see below)* | Auth for the daily cleanup cron. |

Generate the cleanup secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Change / remove (if you were running the marketing demo)

| Variable | Action |
|---|---|
| `DASHCLAW_MODE` | If set to `demo`, **remove it** (or set `self_host`). Leaving `demo` forces demo for *everyone*, including signed‑in trial users. |
| `NEXT_PUBLIC_DASHCLAW_MODE` | Same — if `demo`, **remove it** (or set `self_host`). |

Anonymous "kick the tires" demo still works after this: it's cookie‑driven (the **Run live
demo** button), and an authenticated session automatically bypasses it.

### Verify (should already exist on a live deploy)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon pooled connection string. |
| `NEXTAUTH_URL` | `https://dashclaw.io` (your production URL). |
| `NEXTAUTH_SECRET` | A random 32+ char secret (already set if sign‑in works today). |
| `ENCRYPTION_KEY` | Your standard DashClaw production secret. |

### Optional (sane defaults — only set to override)

`HOSTED_TRIAL_DAYS` (default `30`) · `HOSTED_TRIAL_ACTION_CAP` (default `10000`) ·
`HOSTED_PROVISION_MAX_PER_IP_PER_DAY` (default `5`). **Turnstile is not required** for the
sign‑in trial flow — it only protects the separate anonymous `POST /api/hosted/workspaces`
mint endpoint.

## Step 3 — Enable the free cleanup cron (GitHub Actions)

The repo already ships `.github/workflows/hosted-cleanup.yml` (runs daily). In **GitHub →
repo Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `DASHCLAW_BASE_URL` | `https://dashclaw.io` |
| `HOSTED_CLEANUP_SECRET` | **the same value** you set on Vercel in Step 2 |

(Expiry is also enforced at request time, so trials stop working on expiry even if the cron lags — this just reclaims rows.)

## Step 4 — Redeploy

The landing page is statically prerendered and reads `DASHCLAW_HOSTED` **at build time**,
so the new env only takes effect on a fresh build. In Vercel → **Deployments → Redeploy**
(or push any commit to `main`).

## Step 5 — Verify the flow

1. Open `https://dashclaw.io` — the hero shows **"Govern your Claude — free"** as the
   primary button (the self‑host button moves to secondary).
2. Click it → Google sign‑in → you land on the **Add to Claude** screen
   (`/connect?hosted=…`) with the keyless connector.
3. In Claude, **Add custom connector** → paste `https://dashclaw.io/api/mcp` → Connect →
   log in with the **same Google account** → Authorize.
4. Take a governed action; it appears in **your** Approvals. Sign in with a second
   Google account to confirm the two workspaces are isolated.

If the CTA doesn't appear: confirm `DASHCLAW_HOSTED=true` is set for **Production** and that
you **redeployed**; check `GET https://dashclaw.io/api/hosted/capacity` returns
`{ full, active, max }` (not 404).
