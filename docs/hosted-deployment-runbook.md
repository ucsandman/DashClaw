---
owner: Ops
last-verified: 2026-06-10
doc-type: runbook
---

# Hosted DashClaw deployment — the complete guide

This is the **single canonical guide** for standing up the hosted DashClaw instance (the public site where strangers can mint a free trial workspace). It assumes **zero prior knowledge** of Vercel, Cloudflare, DNS, or OAuth. Every term is defined the first time it appears, every manual step says exactly what to click and what success looks like, and every fact in here was verified against the code on 2026-06-10 (file references are included so future edits can re-verify).

> The older copy at `docs/ops/hosted-deployment.md` is retired — it had drifted (missing `ENCRYPTION_KEY`, Google sign-in, the trial cap) and is now just a pointer here. The post-deploy flip checklist lives in [`HOSTED_TRIAL_RUNBOOK.md`](./HOSTED_TRIAL_RUNBOOK.md).

**Credentials are referenced by NAME only. Never paste secret values into this file, commits, or chat.**

---

## What we're building (plain English)

A public copy of DashClaw running at `hosted.dashclaw.io` where a visitor can get a free 30-day trial workspace in two minutes. Five services make that work:

| Service | What it does here | Cost |
|---|---|---|
| **Vercel** | Runs the Next.js app (the website + API). Every push to `main` auto-deploys. | Free tier |
| **Neon** | Hosts the Postgres database (where workspaces, actions, policies live). | Free tier |
| **Cloudflare Turnstile** | A free, invisible "prove you're not a bot" check on the trial signup form — Cloudflare's replacement for those "click all the traffic lights" CAPTCHAs. | Free |
| **Google OAuth** | Lets visitors sign in with their Google account so they can return to their trial workspace. Optional but strongly recommended. | Free |
| **GitHub Actions** | Runs a small daily job that deletes expired trial workspaces. | Free |

**Hard rule: the hosted instance gets its OWN Vercel project and its OWN Neon database.** Never point it at your personal/production database — it mints workspaces for untrusted strangers into whatever database it is given.

---

## Words this guide uses

Read this once; the steps below assume these.

- **Environment variable (env var)** — a named setting (like `DATABASE_URL`) given to the app at startup instead of being written in the code. On Vercel you set them in the project's settings; the app reads them when it runs.
- **Domain / hostname** — a website address. `dashclaw.io` is a domain you **already own** (it's in your Namecheap account). A **subdomain** is a prefix on it: `hosted.dashclaw.io`. When a form asks for a "hostname", it wants one of these — you never invent one; you use a domain you own.
- **Apex domain** — the bare domain with no prefix (`dashclaw.io`). In Cloudflare Turnstile, adding the apex automatically covers **all** its subdomains, including `hosted.dashclaw.io`.
- **DNS record** — the public phone-book entry that says "`hosted.dashclaw.io` lives at server X". A **CNAME** is the type of record that says "this name is an alias for that name". Your DNS is managed at Namecheap.
- **Widget** (Cloudflare's word) — just the bot-check element that appears (or invisibly runs) on the signup form. "Add a widget" = "register one website with Turnstile and get keys for it". It is not something you build.
- **Site key vs Secret key** — Turnstile gives you two strings. The **site key** is public (it's sent to every visitor's browser to render the check). The **secret key** is private (the server uses it to verify results; treat it like a password).
- **OAuth client** — Google's record of "this app is allowed to offer Sign in with Google". Creating one gives you a **client ID** (public) and **client secret** (private).
- **Redirect URI** — the exact URL Google sends users back to after sign-in. It must match character-for-character or Google refuses.
- **Cron** — a scheduled job ("run this every day at 03:00"). Ours runs on GitHub Actions, not Vercel (the free Vercel tier doesn't do crons, and `vercel.json` deliberately contains none).
- **Pooled connection string** — Neon gives two database URLs; the "pooled" one shares connections and is the right one for serverless apps like this. It has `-pooler` in the hostname.

---

## Who does what

| # | Step | Who | Time |
|---|---|---|---|
| 1 | Cloudflare Turnstile widget | **You** (or Claude driving your logged-in browser) | ~3 min |
| 2 | Google OAuth client (optional) | **You** (Google's console requires the account owner) | ~10 min |
| 3 | Neon database | Claude (`npx neonctl` — you click "Authorize" once in a browser) | ~2 min |
| 4 | Generate the five secrets | Claude | seconds |
| 5 | Vercel project + env vars + deploy | Claude (`vercel` CLI is already logged in) | ~10 min |
| 6 | DNS + custom domain | Claude (Vercel CLI + Namecheap) | ~5 min + DNS wait |
| 7 | GitHub Actions cleanup | Claude (`gh` CLI is already logged in) | ~2 min |
| 8 | Validation + smoke tests | Claude | ~10 min |

Steps 1–2 are the only ones that need a human, because Cloudflare and Google gate them behind your logged-in account.

---

## Part A — the human steps

### A1. Create the Cloudflare Turnstile widget (~3 minutes)

What you're doing: telling Cloudflare "I want bot protection on dashclaw.io" and getting two keys back.

1. Go to https://dash.cloudflare.com and log in (create a free account if you don't have one — email + password, no credit card).
2. In the **left sidebar**, click **Turnstile**. (If you don't see it, click your account name first to land on the account-level page.)
3. Click the **"Add widget"** button.
4. Fill in the form:
   - **Widget name:** `DashClaw Hosted` — this is just a label for you; it can be anything.
   - **Hostname management:** click "Add hostnames" and enter `dashclaw.io` — the apex automatically covers `hosted.dashclaw.io` and every other subdomain. Do **not** enter `*.vercel.app` or `vercel.app` (wildcards aren't supported and the bare `vercel.app` domain is rejected/non-functional). If you later want the bot-check to also work on the raw `<project>.vercel.app` address, you can come back and add that exact hostname — the list is editable after creation (widget → Settings → Hostname Management).
   - **Widget mode:** choose **Managed**. The three modes are: **Managed** (recommended — Cloudflare decides per-visitor; most people see nothing, suspicious ones get a one-click checkbox), **Non-Interactive** (always shows a small "verifying…" spinner, never asks for clicks), **Invisible** (shows nothing at all, but Cloudflare requires you to mention them in your privacy policy if you use it). Managed is the right choice here.
   - Leave **Pre-clearance** off (it's for sites already proxied through Cloudflare; ours isn't).
5. Click **Create**.
6. **Success looks like:** a page showing a **Site Key** and a **Secret Key** (both start with `0x4`). Copy both somewhere safe (e.g. paste them to Claude in chat, or into a local scratch file — NOT into the repo). The Site Key becomes the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` env var; the Secret Key becomes `TURNSTILE_SECRET_KEY`.

Nuance worth knowing: Turnstile only protects the **anonymous** "mint a trial" button on `/connect`. The Google sign-in trial path doesn't use it (`docs/instant-trial-vercel-setup.md`). But the readiness checker (`scripts/check-hosted-ready.mjs:25`) hard-fails without the secret key, and the anonymous mint endpoint fails closed in production without it (`app/lib/hosted/turnstile.ts:14`), so do this step regardless.

### A2. Create the Google OAuth client (optional but recommended, ~10 minutes)

What you're doing: registering DashClaw with Google so visitors can "Sign in with Google" to get a trial. Skip this and the trial still works via the anonymous mint button — but users can't come back to their workspace later, and the landing page's one-click trial won't function.

1. Go to https://console.cloud.google.com and log in.
2. Top bar: click the **project dropdown** (next to the "Google Cloud" logo) → **"New project"** → name it `dashclaw-hosted` → **Create** → wait a few seconds → make sure the dropdown now shows that project.
3. In the search bar at the top, type **"Google Auth Platform"** and open it (Google moved OAuth clients here from the old "APIs & Services → Credentials" page; the direct URL is https://console.cloud.google.com/auth/clients).
4. First time only, it forces you to register the app before you can create a client. It will ask for:
   - **App name:** `DashClaw` · **User support email:** your email
   - **Audience:** choose **External** (means "any Google account can sign in", which is what a public trial needs)
   - **Contact email:** your email → finish/Create.
5. Now go to **Clients** → **"Create client"** (or "+ Create credentials → OAuth client ID" if you see the older UI):
   - **Application type:** `Web application`
   - **Name:** `dashclaw-hosted`
   - **Authorized JavaScript origins:** add `https://hosted.dashclaw.io`
   - **Authorized redirect URIs:** add exactly `https://hosted.dashclaw.io/api/auth/callback/google` — this exact path is what NextAuth listens on; one wrong character and Google shows users an error page.
   - Click **Create**.
6. **Success looks like:** a popup showing **Client ID** (ends in `.apps.googleusercontent.com`) and **Client secret**. **Copy the secret NOW — Google only shows it this once.** These become the `GOOGLE_ID` and `GOOGLE_SECRET` env vars.

If the hosted URL changes later, come back to this client and update the origin + redirect URI to match.

### A3. One browser click for Neon (when prompted)

When Claude runs `npx neonctl auth`, a browser tab opens asking you to authorize the CLI against your Neon account. Click **Authorize**. That's the whole step. (Create the free Neon account at https://neon.tech first if you've never used it.)

---

## Part B — the automated steps (Claude / any operator with the CLIs)

All of these run from the repo root. The `vercel` and `gh` CLIs are already authenticated on this machine (account `ucsandman`).

### B1. Neon database

```bash
npx neonctl auth                       # one-time; opens the browser for step A3
npx neonctl projects create --name dashclaw-hosted --region-id aws-us-east-1 --output json
npx neonctl connection-string --pooled # prints the pooled DATABASE_URL (has "-pooler" in the host)
```

The pooled string is the value for the `DATABASE_URL` env var.

### B2. Generate the five secrets

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('HOSTED_CLEANUP_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('DASHCLAW_API_KEY=oc_live_' + require('crypto').randomBytes(16).toString('hex'))"
node -e "console.log('NEXTAUTH_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url').slice(0,32))"
```

What each is for (and what breaks without it) is in the env table below. `npm run hosted:check-ready` (step B7) hard-fails on every secret the runtime genuinely needs to boot and let anyone sign in: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_KEY`, a sign-in provider pair, `TURNSTILE_SECRET_KEY`, and `DASHCLAW_API_KEY`. Formats that matter: `DASHCLAW_API_KEY` must be `oc_live_` + 32 lowercase hex characters (the checker rejects anything else); `ENCRYPTION_KEY` must be exactly 32 bytes (`app/lib/encryption.ts` throws otherwise). Redis (`REDIS_URL`/`UPSTASH_REDIS_REST_URL`) is a loud warning, not a blocker — rate limiting and SSE fall back to in-memory, which is only lossy across serverless cold starts.

### B3. Vercel project + env vars

```bash
vercel link --yes --project dashclaw-hosted   # creates/links the project, non-interactive
```

Then set each env var on Production. The pattern (the value is piped via stdin so it never lands in shell history as an argument):

```bash
echo <value> | vercel env add <NAME> production
```

Set every var in the table below that is marked **required** or **recommended**. `DASHCLAW_HOSTED=true` matters most — and it must exist as a normal project env var (the default) because the landing page reads it at **build** time to decide which hero/CTA to render.

Two things to NOT do:
- **Do not set `DASHCLAW_MODE=demo`** on this project. Demo mode as an env var forces canned fixture data for *everyone*, including signed-in trial users, and breaks the trial. (The marketing site's demo is cookie-driven and unaffected.)
- **Do not reuse your personal `DATABASE_URL`.** See the hard rule at the top.

### B4. Deploy

```bash
vercel --prod --yes
```

The build runs `node scripts/auto-migrate.mjs && next build` (`vercel.json:4`): the migration script is idempotent (safe to run every deploy), applies everything in `drizzle/` including `0027` (the hot `action_records` indexes), seeds the `org_default` organization, and seeds the admin `DASHCLAW_API_KEY` into the database. **Success looks like:** the command prints a `https://….vercel.app` URL and Vercel shows the deployment as Ready.

### B5. Custom domain — hosted.dashclaw.io

```bash
vercel domains add hosted.dashclaw.io dashclaw-hosted
```

Vercel responds with the DNS record it needs — for a subdomain it's a **CNAME** pointing `hosted` → `cname.vercel-dns.com`. Add that record at Namecheap (Domain List → dashclaw.io → **Advanced DNS** → Add New Record → Type `CNAME`, Host `hosted`, Value `cname.vercel-dns.com`). Propagation usually takes minutes, occasionally up to an hour.

Then point the app at its real address and redeploy (the URL is baked into OAuth callbacks and emails):

```bash
echo https://hosted.dashclaw.io | vercel env add NEXTAUTH_URL production --force
vercel --prod --yes
```

**Success looks like:** `https://hosted.dashclaw.io` loads the site with a padlock (Vercel issues the TLS certificate automatically).

### B6. Trial cleanup (GitHub Actions)

Expired trials are deleted by the **"Hosted cleanup"** workflow (`.github/workflows/hosted-cleanup.yml`) — daily at 03:00 UTC, manual-runnable, and it skips harmlessly if the secrets aren't set yet. There is **no Vercel cron** (`vercel.json` contains none; free tier doesn't support them — expiry is also enforced at request time, so trials stop working on time even if cleanup lags a day).

```bash
gh secret set DASHCLAW_BASE_URL --body "https://hosted.dashclaw.io"
gh secret set HOSTED_CLEANUP_SECRET --body "<the value from B2>"
gh workflow run "Hosted cleanup"        # first manual run
gh run list --workflow "Hosted cleanup" --limit 1   # confirm it went green
```

### B7. Validate everything

```bash
# 1. Readiness (run locally with the same env values that are on Vercel).
#    Every var below is a HARD requirement — the checker fails without it:
DASHCLAW_HOSTED=true DATABASE_URL=<neon-url> \
  NEXTAUTH_SECRET=<nextauth-secret> NEXTAUTH_URL=https://hosted.dashclaw.io \
  ENCRYPTION_KEY=<32-byte-key> GOOGLE_ID=<google-id> GOOGLE_SECRET=<google-secret> \
  TURNSTILE_SECRET_KEY=<secret> DASHCLAW_API_KEY=<admin-key> \
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site-key> HOSTED_CLEANUP_SECRET=<cleanup> \
  REDIS_URL=<redis-url> npm run hosted:check-ready
# expect: [hosted:check-ready] status=pass   (warn = OK with NEXT: hints; fail = blocking)
# (any complete OAuth pair works in place of GOOGLE_* — GITHUB_ID/GITHUB_SECRET or the OIDC trio.
#  Omitting REDIS_URL downgrades to status=warn, not fail.)

# 2. Smoke test against the live deployment (mints a real trial, checks /api/health with its key, then deletes it):
HOSTED_SMOKE_BASE_URL=https://hosted.dashclaw.io DASHCLAW_API_KEY=<admin-key> npm run hosted:smoke
# expect: [smoke] PASS
```

Browser checks (any human or a driven browser):

- `https://hosted.dashclaw.io/connect` → the "Try it hosted" section appears, the Turnstile check renders (or passes invisibly), and clicking the mint button returns a workspace ID + `oc_live_…` key + config snippet.
- `https://hosted.dashclaw.io/setup` → the deployment-truth page shows green database/schema/environment sections.

Then continue with the post-deploy flip checks in [`HOSTED_TRIAL_RUNBOOK.md`](./HOSTED_TRIAL_RUNBOOK.md) (starter policies, the `--trial` installer, `dashclaw cost`).

---

## The env var table (verified against code, 2026-06-10)

"Breaks without it" describes the *visible* failure so you can work backwards from a symptom.

### Required — the app does not work without these

| Name | Where it comes from | Breaks without it |
|---|---|---|
| `DASHCLAW_HOSTED` | literally the string `true` | Every `/api/hosted/*` route 404s; no trials can be minted; landing page builds with the self-host hero (`app/lib/hosted/flag.ts:2`) |
| `DATABASE_URL` | Neon, step B1 (pooled) | Build fails at auto-migrate; at runtime every authed request answers 503 `DB_CONNECTION_FAILED` |
| `NEXTAUTH_SECRET` | generated, step B2 | No login session can be verified; dashboard inaccessible |
| `ENCRYPTION_KEY` | generated, step B2 (exactly 32 chars) | Settings writes return 503 "Server misconfigured"; security check goes critical |
| `DASHCLAW_API_KEY` | generated, step B2 (`oc_live_`+32 hex) | Readiness check exits 1; no admin key seeded, so you can't inspect/delete trial workspaces |
| `TURNSTILE_SECRET_KEY` | Cloudflare, step A1 | Every anonymous mint returns 400 "turnstile verification failed" (fails closed in production) |

### Recommended — the trial works, but degraded

| Name | Where it comes from | Breaks without it |
|---|---|---|
| `NEXTAUTH_URL` | your final URL, step B5 | OAuth callbacks, invite links, and webhook URLs point at the wrong host |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare, step A1 | The signup form renders no bot-check, so anonymous visitors can never mint (server keeps rejecting them) |
| `GOOGLE_ID` + `GOOGLE_SECRET` | Google, step A2 | No "Sign in with Google" — the one-click landing-page trial is dead; only the anonymous mint works |
| `HOSTED_CLEANUP_SECRET` | generated, step B2 | The GitHub Actions cleanup can't authenticate; expired trials linger (but stop working anyway) |
| `CRON_SECRET` | generated, step B2 | `/api/cron/*` routes return 503 and startup logs a warning; harmless today since there's no Vercel cron, cheap to set anyway |
| `ALLOWED_ORIGIN` | `https://hosted.dashclaw.io` | Browser-based SDK calls from other origins get blocked by CORS |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | optional Upstash account | Per-IP rate limits reset on every serverless cold start, so they're soft; fine to defer until abuse appears |

### Optional — sane defaults built in

| Name | Default | What it tunes |
|---|---|---|
| `HOSTED_TRIAL_DAYS` | `30` | Trial length |
| `HOSTED_TRIAL_ACTION_CAP` | `10000` | Governed actions per trial |
| `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` | `5` | Anonymous mints per IP per day |
| `HOSTED_MAX_ACTIVE_TRIALS` | `500` | Global concurrent-trial cap — the cost circuit breaker. **Cannot be set to 0** (the parser only accepts positive integers and falls back to 500); to pause trials, take the deployment down instead |
| `DASHCLAW_LOCAL_ADMIN_PASSWORD` | unset (route 404s) | Password login for the operator if Google isn't configured |
| `REDIS_URL` + `REALTIME_BACKEND=redis` | in-memory | Makes the Approvals live stream survive cold starts |

---

## When something breaks

| Symptom | Most likely cause | Check | Fix |
|---|---|---|---|
| `/api/hosted/*` all return 404 | `DASHCLAW_HOSTED` not set (or not on Production) | `/api/hosted/capacity` in a browser; `/api/doctor` Hosted section | Set `DASHCLAW_HOSTED=true` as a project env var and redeploy |
| Mint button errors / 403 / "turnstile verification failed" | Turnstile keys wrong, or the domain isn't in the widget's hostname list | Browser DevTools → Network tab → the `/api/hosted/workspaces` request; Vercel function logs for `[HOSTED]` lines | Re-copy both keys; confirm `dashclaw.io` is in the widget's hostnames; redeploy |
| Mint returns 429 | Per-IP limit hit (5/day default) | Vercel function logs for the workspaces route | Expected behavior; raise `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` only if it's blocking real users |
| `/connect` shows no trial section | `DASHCLAW_HOSTED` wasn't visible at **build** time | Vercel build log | Redeploy after setting it as a project var (not a runtime-only override) |
| Google sign-in shows a Google error page | Redirect URI mismatch | The error page literally names the URI it received | Make the OAuth client's redirect URI exactly `https://hosted.dashclaw.io/api/auth/callback/google` |
| Trial signups land on "trials are full" | `HOSTED_MAX_ACTIVE_TRIALS` reached (fail-closed, by design) | `/api/hosted/capacity` | Raise the cap, or let cleanup reclaim expired trials |
| Cleanup workflow red | Secret mismatch | The Actions run log prints the HTTP status | Re-set `HOSTED_CLEANUP_SECRET` in repo secrets to match Vercel's value |
| Dashboard 503s on everything (`SCHEMA_NOT_INITIALIZED` / `DB_CONNECTION_FAILED`) | Schema drift or wrong `DATABASE_URL` | `/setup`, `/api/health`, Neon console | Verify `DATABASE_URL`; redeploy (auto-migrate reruns); see `/api/doctor` Database section |

Monitoring, minimal: watch Vercel function logs for `[HOSTED]` lines after each release, glance at `organizations WHERE hosted_mode = true` in the Neon console weekly, confirm the daily "Hosted cleanup" run is green, and re-run `npm run hosted:smoke` against production periodically.

---

## Rollback

1. **Bad deploy:** Vercel dashboard → Deployments → pick the last known-good one → **Promote to Production** (env stays as-is). Or kill-switch the trial alone: remove `DASHCLAW_HOSTED` and redeploy — provisioning 404s, existing trial keys keep working until expiry.
2. **Bad env change:** revert the env var and redeploy; don't roll code back for an env problem.
3. **Destructive schema accident:** Neon creates automatic restore points — Neon console → Branches → Restore.
4. Reproduce locally with `DASHCLAW_HOSTED=true npm run dev`.

---

## Handoff checklist

- [ ] Neon project created; pooled `DATABASE_URL` in Vercel
- [ ] Turnstile widget exists with `dashclaw.io` in its hostnames; both keys in Vercel
- [ ] All six **required** env vars set on Production (table above)
- [ ] Deployed; `npm run hosted:check-ready` = `status=pass`
- [ ] `npm run hosted:smoke` = `[smoke] PASS` against the live URL
- [ ] `/connect` mint works end-to-end in a browser
- [ ] `hosted.dashclaw.io` resolves with a valid certificate; `NEXTAUTH_URL` updated + redeployed
- [ ] `gh` repo secrets set; "Hosted cleanup" manual run green
- [ ] Google sign-in works (if configured) — including from a second Google account to confirm workspace isolation
- [ ] Continue with [`HOSTED_TRIAL_RUNBOOK.md`](./HOSTED_TRIAL_RUNBOOK.md) for the activation-funnel flip checks
