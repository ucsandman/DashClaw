# Telegram Approvals — Setup Guide

One-tap approve/reject from your phone for any DashClaw action that lands on `pending_approval`. The dashboard, CLI, and mobile PWA continue to work — Telegram is an additional channel, not a replacement.

**Time to set up:** ~3 minutes with the wizard, ~5 manually. **Cost:** $0 (Telegram Bot API is free).

---

## The fast path — interactive wizard

```bash
dashclaw install telegram
```

No repo clone needed — the wizard ships in the [`@dashclaw/cli`](https://www.npmjs.com/package/@dashclaw/cli) package (`npm i -g @dashclaw/cli`, or `npx @dashclaw/cli install telegram`). From a repo clone, `npm run telegram:setup` runs the identical wizard and can additionally write the env vars into your local `.env`.

Walks you through all 8 steps: bot creation, chat ID discovery, secret generation, deploy URL, API key + org discovery, env block, webhook registration, and round-trip smoke test. Auto-discovers your chat ID from Telegram, auto-generates the webhook secret, auto-discovers your org ID from your API key, and prints the exact env block to paste into Vercel. Most people are done in ~3 minutes.

The rest of this doc is the manual walkthrough for anyone who wants to understand every step or can't run the wizard.

---

## Before you start

You need:
- A working DashClaw deploy (e.g. `https://my-dashclaw.vercel.app`)
- A Telegram account
- A DashClaw admin API key (starts with `oc_live_`). Get one from `/settings` → API Keys if you don't have one yet. The wizard uses this to auto-discover your org ID — you don't need to paste that manually.

**Important constraint:** the bot must be used as a **1:1 DM** with a single human. Group/supergroup chats don't work — `chat.id` is negative in groups and `from.id` is the individual user, so the allowlist check will fail. If you want a team inbox later, that's v1.1 scope.

---

## Step 1 — Create the bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`. Follow the prompts (pick any name + a unique username ending in `bot`).
3. BotFather replies with an HTTP API token like `7123456789:AAH...`. **This is your `TELEGRAM_BOT_TOKEN`.** Save it.

## Step 2 — Get your chat ID

1. Open a chat with your new bot and send any message (e.g. `hi`).
2. In a browser, visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   (replace `<YOUR_TOKEN>` with the value from Step 1)
3. Look for `"chat":{"id":123456789,...}` — the numeric `id` is your **`TELEGRAM_ADMIN_CHAT_ID`**. Save it.

Your chat ID is the same as your Telegram user ID for a 1:1 bot — both positive integers.

## Step 3 — Generate a webhook secret

Run locally:
```bash
openssl rand -hex 32
```
Copy the 64-character hex string. This is your **`TELEGRAM_WEBHOOK_SECRET`**.

## Step 4 — Set env vars on Vercel

Go to your Vercel project → Settings → Environment Variables. Add these four, scoped to **Production only** (not Preview):

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from Step 1 |
| `TELEGRAM_ADMIN_CHAT_ID` | from Step 2 |
| `TELEGRAM_WEBHOOK_SECRET` | from Step 3 |
| `TELEGRAM_APPROVER_ORG_ID` | the `id` field returned from `curl -H "x-api-key: oc_live_..." https://my-dashclaw.vercel.app/api/orgs` |

**Why Production only:** Telegram allows only one webhook per bot. If preview deploys share the same token, they can steal the production webhook. Keeping the token production-scoped prevents this.

Redeploy so the new env vars take effect (Vercel usually offers a redeploy prompt after env changes).

## Step 5 — Register the webhook

From your local clone of the repo (so the same `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` are on your shell):

```bash
# set env locally just for this command
export TELEGRAM_BOT_TOKEN=<token-from-step-1>
export TELEGRAM_WEBHOOK_SECRET=<secret-from-step-3>

npm run telegram:register -- --url https://my-dashclaw.vercel.app
```

Expected output:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

If you see `Webhook is currently registered at <other-url>. To replace, rerun with --force` — that means another deploy already owns the webhook. Either stop that deploy from owning it, or append `--force` to your command to overwrite.

## Step 6 — Smoke-test the round-trip

```bash
DASHCLAW_API_KEY=oc_live_xxx \
  npm run telegram:verify -- --base https://my-dashclaw.vercel.app
```

The script creates a synthetic `pending_approval` action, prints `Created act_verifyXXXX. Approve/Reject on Telegram…`, and starts polling.

Check your phone. You should see a Telegram message from your bot:
```
⏳ DashClaw approval needed

Agent:   telegram-verify
Action:  deploy
Risk:    80 • irreversible

Goal: telegram:verify-loop smoke test

act_verifyXXXX

[ ✅ Approve ]   [ ❌ Reject ]
```

Tap **Approve**. Within a second or two, the script prints:
```
✅ round-trip succeeded in 2.3s — final status: running
```

The script auto-deletes the synthetic action when you exit, so no orphan rows pollute your dashboard.

**You're done.** Every future `pending_approval` action will now ping your phone.

---

## What this gives you

- Every time a governed agent hits a capability that requires approval, your phone gets a card with the agent, action type, risk score, goal, and two buttons.
- One tap → the action resolves through the same `/api/approvals/:id` path as every other approval surface.
- Approvals made from Telegram are logged in the decision ledger with `approved_by: "telegram:<your-chat-id>"`.
- Denials send the hardcoded reason `"Denied via Telegram"` (v1 is one-tap; no free-text deny yet).

---

## Kill switch

To temporarily disable Telegram notifications without removing the env vars:
```
DASHCLAW_ALERTS_TELEGRAM=false
```
Approvals still work via the dashboard / CLI / PWA. Flip back to `true` (or remove the var) to re-enable.

---

## Troubleshooting

**Nothing happens when I tap a button.**
- Check Vercel logs for `/api/telegram/webhook` 401s. A 401 means `TELEGRAM_WEBHOOK_SECRET` on Vercel doesn't match what you registered with Telegram. Rerun Step 5.
- The message might say `⚠️ Server misconfigured: TELEGRAM_APPROVER_ORG_ID is not set` — set that env var on Vercel.
- The message might say `⚠️ Action not found` — the action was resolved (or deleted) from another channel before your tap. Expected.
- The message might say `⚠️ Already resolved — resolved by another channel` — a simultaneous approval happened elsewhere (dashboard/CLI/PWA). Expected.

**I don't receive any Telegram messages at all.**
- Confirm you messaged the bot at least once (Step 2). Telegram won't deliver until a conversation exists.
- Confirm `TELEGRAM_ADMIN_CHAT_ID` is set correctly. `getUpdates` only returns chats you've interacted with.
- Confirm `DASHCLAW_ALERTS_TELEGRAM` is NOT set to `false`.
- Check Vercel logs for `[TelegramApprovals]` warnings — they indicate Telegram API errors.

**The verify script times out.**
- Your webhook registration didn't work — rerun Step 5 and confirm `"ok":true` in the response.
- OR you're using a group chat (see "1:1 DM constraint" above). Create a new bot and use a direct chat.

**I need to rotate the bot token.**
1. Message BotFather, `/revoke`, pick your bot → get a new token.
2. Update `TELEGRAM_BOT_TOKEN` on Vercel, redeploy.
3. Rerun Step 5 (`--force` if needed).

**I need to rotate the webhook secret.**
1. Run `openssl rand -hex 32` for a new secret.
2. Update `TELEGRAM_WEBHOOK_SECRET` on Vercel, redeploy.
3. Rerun Step 5 with `--force`.

---

## Known limitations (v1)

- **Single admin chat only** — no per-agent or per-user routing yet. Every approval goes to the same `TELEGRAM_ADMIN_CHAT_ID`.
- **Approvals only** — no block-notifications, no outcome pings, no daily digest.
- **One-tap deny with hardcoded reason** — no free-text "why?" prompt.
- **No retry if Telegram is down** — if the outbound `sendMessage` fails, the action stays `pending_approval` and the operator needs to check the dashboard to find it. Use `DASHCLAW_ALERTS_TELEGRAM=false` if you don't want to depend on this at all.

These are all on the v1.1 list.

---

## Reference

- Spec: `docs/superpowers/specs/2026-04-13-telegram-approval-bridge-design.md`
- Plan: `docs/superpowers/plans/2026-04-13-telegram-approval-bridge.md`
- Emitter: `app/lib/telegramApprovals.js`
- Webhook: `app/api/telegram/webhook/route.js`
- Scripts: `scripts/telegram-register-webhook.mjs`, `scripts/telegram-verify-loop.mjs`
