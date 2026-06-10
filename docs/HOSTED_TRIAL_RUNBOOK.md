---
owner: Ops
last-verified: 2026-06-10
doc-type: runbook
---

# Hosted trial runbook — flip the activation funnel live

The one artifact needed to take the hosted trial from "code complete" to "people can try DashClaw in two minutes". Code paths shipped in the activation-funnel run (v4.7.10+): auto-seeded starter policies at provisioning, `dashclaw install claude --trial`, the visible first session (Stop-hook recap + metadata-only Code Sessions capture), and `dashclaw cost`.

**Scope:** this is the FLIP checklist. The full infrastructure detail (Neon, Turnstile, DNS, cleanup cron, observability map) lives in [`hosted-deployment-runbook.md`](./hosted-deployment-runbook.md) — follow that first, then return here.

**Credentials are referenced by NAME only. Never paste values into this file, commits, or chat.**

---

## 0. Hard rule: a separate database

The hosted instance gets its **own Vercel project and its own Neon database**. Never point it at the production/personal org DB — tenant isolation is app-layer (`org_id` scoping), and a hosted instance mints untrusted orgs into whatever DB it is given.

## 1. Infrastructure (once)

Follow [`hosted-deployment-runbook.md`](./hosted-deployment-runbook.md) sections 1–4:

- [ ] New Neon project → `DATABASE_URL` (pooled)
- [ ] Cloudflare Turnstile site → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
- [ ] Generated secrets: `CRON_SECRET`, `HOSTED_CLEANUP_SECRET`, `DASHCLAW_API_KEY` (admin), `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`
- [ ] New Vercel project with the env table from that runbook, **`DASHCLAW_HOSTED=true`** as a project (build-visible) var
- [ ] Optional instant-trial sign-in: `GOOGLE_ID` + `GOOGLE_SECRET`
- [ ] Caps reviewed: `HOSTED_TRIAL_DAYS` (30), `HOSTED_TRIAL_ACTION_CAP` (10000), `HOSTED_MAX_ACTIVE_TRIALS` (500), `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` (5)

Schema: the Vercel `buildCommand` runs `node scripts/auto-migrate.mjs` on every deploy (idempotent — includes `drizzle/0027` so the hot `action_records` indexes exist from day one). For a local check against the hosted DB use `npm run db:migrate` with that `DATABASE_URL`.

## 2. Pre-deploy readiness

```bash
npm run hosted:check-ready   # with the hosted env values exported — expect status=pass
```

## 3. Post-deploy smoke (10 minutes)

1. **Mint via browser:** open `https://<hosted-host>/connect` → Turnstile renders → mint → workspace id + `oc_live_...` key + config snippet appear.
2. **Starter policies seeded (new in this run):** with the minted key,
   ```bash
   curl -H "x-api-key: <minted-key>" https://<hosted-host>/api/policies
   ```
   expect the four `Claude Code Starter — …` policies (Block Mass-Destructive, Approval for Network Calls, Approval for Package Installs, Rate-Limit Runaway Agents). If empty, check Vercel function logs for `[HOSTED] starter-pack seeding failed` — provisioning succeeds even when seeding fails, by design.
3. **Governed request 200:**
   ```bash
   curl -X POST -H "x-api-key: <minted-key>" -H "Content-Type: application/json" \
     -d '{"action_type":"test","agent_id":"smoke","declared_goal":"runbook smoke"}' \
     https://<hosted-host>/api/guard
   ```
   expect HTTP 200 with a `decision`.
4. **Forced-expiry 403:** as admin (`DASHCLAW_API_KEY`), expire the workspace (PATCH the trial row or use the admin delete on `/api/hosted/workspaces/<id>`), then repeat the governed request — expect 403/402 (trial gate).
5. **Scripted sweep:** `npm run hosted:smoke` with `HOSTED_SMOKE_BASE_URL` + admin key — expect `[smoke] PASS`.

## 4. `dashclaw install claude --trial` end-to-end

On a machine that has never seen DashClaw:

```bash
npm i -g @dashclaw/cli
DASHCLAW_HOSTED_URL=https://<hosted-host> dashclaw install claude --trial
```

Expected: the browser opens `<hosted-host>/connect`; after signup the pasted key passes preflight; config lands in `~/.dashclaw/config.json`, hooks in `~/.dashclaw/claude-hooks/` (downloaded from the instance's own `/downloads/dashclaw-claude-code-hooks.zip`), hook mode `observe`. Then:

1. Start a Claude Code session, run any governed tool call (e.g. a Bash command).
2. End the turn — the Stop hook prints `[DashClaw] Governed N action(s) this session — $X.XX … · <hosted-host>/decisions`.
3. `dashclaw cost` prints the session's spend from `/api/finops/spend`.
4. The action appears in the trial workspace's Mission Control.

Once the hosted host is final, consider baking it as the CLI's default trial URL so users don't need `DASHCLAW_HOSTED_URL` (one-line change in `cli/lib/claude/install.js`).

## 5. Rollback

- Kill switch: unset `DASHCLAW_HOSTED` in Vercel → redeploy. Provisioning 404s; existing trial keys keep working until expiry/cleanup.
- Bad deploy: promote the last known-good Vercel deployment (env stays).
- Runaway spend: lower `HOSTED_MAX_ACTIVE_TRIALS` cannot be set to 0 (parser floor) — take the deployment offline instead.

## 6. Steady-state

- Daily cleanup via Vercel cron or the GitHub Actions workflow (see deployment runbook §7).
- Watch `[HOSTED]` function logs + `organizations WHERE hosted_mode = true` row count.
- Periodic `npm run hosted:smoke` against production.
