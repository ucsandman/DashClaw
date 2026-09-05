---
owner: Ops
last-verified: 2026-06-10
doc-type: runbook
---

# Hosted trial runbook — flip the activation funnel live

This is the **flip checklist**: the final pass that takes the hosted trial from "code complete" to "a stranger can try DashClaw in two minutes". The infrastructure itself (Neon, Vercel, Cloudflare Turnstile, DNS, cleanup, every env var) is covered click-by-click in [`hosted-deployment-runbook.md`](./hosted-deployment-runbook.md) — do that first, then come back here.

Code paths being flipped (shipped in the activation-funnel run, v4.7.10+): auto-seeded starter policies at provisioning, `dashclaw install claude --trial`, the visible first session (Stop-hook recap + metadata-only Code Sessions capture), and `dashclaw cost`.

**Credentials are referenced by NAME only. Never paste secret values into this file, commits, or chat.**

---

## 0. Hard rule: a separate database

The hosted instance gets its **own Vercel project and its own Neon database**. Never point it at the production/personal database. Workspace isolation is enforced in the app (each query is scoped to an `org_id`), which means a hosted instance will happily mint workspaces for untrusted strangers into **whatever database you hand it**.

## 1. Infrastructure (once)

Work through [`hosted-deployment-runbook.md`](./hosted-deployment-runbook.md) — Part A is the two human steps (Cloudflare Turnstile ~3 min, Google OAuth ~10 min), Part B is everything Claude/the CLIs do (Neon, secrets, Vercel, DNS, GitHub Actions cleanup). You're done with it when its handoff checklist is all checked, which includes:

- [ ] All six **required** env vars on Vercel Production, with `DASHCLAW_HOSTED=true` as a normal project var (the landing page reads it at build time)
- [ ] Optional instant-trial sign-in: `GOOGLE_ID` + `GOOGLE_SECRET`
- [ ] Caps reviewed: `HOSTED_TRIAL_DAYS` (30), `HOSTED_TRIAL_ACTION_CAP` (10000), `HOSTED_MAX_ACTIVE_TRIALS` (500), `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` (5)

Schema is automatic: the Vercel build runs `node scripts/auto-migrate.mjs` on every deploy. The runner serializes with an advisory lock and uses a checksummed transactional ledger, so an edited applied migration fails instead of being silently accepted. An explicit process `DATABASE_URL` wins over repository dotenv loading. To check the hosted DB from your machine, run `npm run db:migrate` with the hosted `DATABASE_URL` exported.

## 2. Pre-deploy readiness

```bash
npm run hosted:check-ready   # with the hosted env values exported — expect status=pass
```

`warn` is acceptable (it prints a `NEXT:` hint per warning); `fail` blocks and tells you the missing piece.

## 3. Post-deploy smoke (10 minutes)

1. **Mint via browser:** open `https://<hosted-host>/connect` → the Turnstile check renders (or passes invisibly) → mint → a workspace id, an `oc_live_...` key, and a config snippet appear on screen.
2. **Starter policies seeded:** with the minted key:
   ```bash
   curl -H "x-api-key: <minted-key>" https://<hosted-host>/api/policies
   ```
   Expect the four `Claude Code Starter — …` policies (Hold Mass-Destructive Operations for Approval, Require Approval for Network Calls, Require Approval for Package Installs, Rate-Limit Runaway Agents). If the list is empty, check the Vercel function logs for `[HOSTED] starter-pack seeding failed` — provisioning deliberately succeeds even when seeding fails.
3. **Governed request returns 200:**
   ```bash
   curl -X POST -H "x-api-key: <minted-key>" -H "Content-Type: application/json" \
     -d '{"action_type":"test","agent_id":"smoke","declared_goal":"runbook smoke"}' \
     https://<hosted-host>/api/guard
   ```
   Expect HTTP 200 with a `decision` field in the body.
4. **Forced-expiry gate:** as admin (`DASHCLAW_API_KEY`), expire the workspace (set `organizations.trial_ends_at` in the past, or admin-delete via `/api/hosted/workspaces/<id>`), then repeat the governed request — expect 403 `{"error":"trial expired"}`. **Allow up to 5 minutes**: the middleware caches API-key auth (including `trial_ends_at`) with a 5-minute TTL, so requests inside that window still return 200.
5. **Scripted sweep (non-prod only):** `npm run hosted:smoke` with `HOSTED_SMOKE_BASE_URL` + the admin key — expect `[smoke] PASS`. Against production this is **expected to fail** at step 1 with 400 `turnstile verification failed: missing_token`: the script sends no Turnstile token and the instance fails closed. That's the bot gate working — production smoke is steps 1–4 above (browser mint). The scripted sweep passes only where `TURNSTILE_SECRET_KEY` is unset (local/preview bypass) or set to Cloudflare's always-pass test key.

## 4. `dashclaw install claude --trial` end-to-end

On a machine that has never seen DashClaw:

```bash
npm i -g @dashclaw/cli
DASHCLAW_HOSTED_URL=https://<hosted-host> dashclaw install claude --trial
```

Expected: the browser opens `<hosted-host>/connect`; after signup, the key you paste is preflighted with two live calls (`GET /api/health`, then `GET /api/actions?limit=1` with the key — so a typo'd key fails fast, before anything is written). Then config lands in `~/.dashclaw/config.json`, hooks in `~/.dashclaw/claude-hooks/` (downloaded from the instance's own `/downloads/dashclaw-claude-code-hooks.zip`), and your existing `~/.claude/settings.json` is backed up once to `settings.json.dashclaw-bak` before the hook entries are merged in. Hook mode starts as `observe`. Then:

1. Start a Claude Code session and run any governed tool call (e.g. a Bash command).
2. End the turn — the Stop hook prints `[DashClaw] Governed N action(s) this session — $X.XX … · <hosted-host>/decisions`.
3. `dashclaw cost` prints the session's spend (it calls `/api/finops/spend`).
4. The action appears in the trial workspace's Approvals.

Once the hosted host is final, consider baking it in as the CLI's default trial URL so users don't need `DASHCLAW_HOSTED_URL` — today the CLI resolves the URL from flag → `DASHCLAW_BASE_URL` → `DASHCLAW_HOSTED_URL` → an interactive prompt, with no built-in default (`cli/lib/claude/install.js:287`).

## 5. Rollback

- **Kill switch:** remove `DASHCLAW_HOSTED` in Vercel → redeploy. Provisioning 404s; existing trial keys keep working until expiry/cleanup.
- **Bad deploy:** promote the last known-good Vercel deployment (env stays).
- **Runaway signups:** `HOSTED_MAX_ACTIVE_TRIALS` **cannot be set to 0** (the parser only accepts positive integers and falls back to 500) — to pause trials entirely, take the deployment offline instead.

## 6. Steady-state

- Daily cleanup runs on the GitHub Actions **"Hosted cleanup"** workflow (03:00 UTC, manual-runnable). There is no Vercel cron — expiry is also enforced at request time, so trials shut off on schedule even if cleanup lags.
- Watch `[HOSTED]` function logs + the `organizations WHERE hosted_mode = true` row count.
- Periodic `npm run hosted:smoke` against production.
