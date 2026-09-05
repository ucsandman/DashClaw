# Troubleshooting

The errors you will actually see, what they mean, and the fix. First move for anything not listed here: `dashclaw doctor` (or `npm run doctor` from a checkout) — it checks the instance *and* the local machine and names the blocking item.

## HTTP errors from the API

### `503 SCHEMA_NOT_INITIALIZED` — the most common self-host failure

Your database schema is behind the code (fresh deploy, or you pulled changes that touch `schema/schema.js` / `drizzle/*.sql` without migrating). Every authenticated request answers this until you migrate. DashClaw deliberately answers **503, not 401**, so a schema problem is never misread as a bad key.

**Fix:** `npm run db:migrate` locally, or `POST /api/setup/migrate` (the error response names the URL). On Vercel the migration runs during build, so redeploying also fixes it.

Related: `DB_CONNECTION_FAILED` / `AUTH_LOOKUP_FAILED` (same 503 family) mean the database is unreachable or the auth lookup errored — an infrastructure problem, not a credentials problem.

### `401 Unauthorized - Invalid or missing API key`

The key genuinely doesn't match: wrong value, revoked, or the wrong instance (a key from one deployment does not work on another). Check which host you're pointing at before rotating anything — with multiple instances (local + hosted), a stale `DASHCLAW_URL` or `DASHCLAW_BASE_URL` in the environment sends valid keys to the wrong door.

### `403 Forbidden - readonly API key`

The key is valid but scoped `readonly`, and you attempted a write (`POST /api/actions`, etc.). Mint a `member`/`admin` key for agents that record actions.

### `403` with a guard decision attached

Not an auth failure — **policy blocked the action**. The response carries the decision; the SDKs raise `GuardBlockedError`. The action was recorded as blocked in the ledger. If the block is wrong, fix the policy; blocks are never downgraded case-by-case.

### `410 Gone` with `code: "APPROVAL_EXPIRED"`

The approval you (or the agent) tried to act on can no longer release anything — the requesting client provably stopped waiting. This is a truthful terminal state, not an error to retry. The agent should re-issue the action; the fresh request re-queues for approval.

### `409` on outcome reporting: `outcome already set`

Outcomes are one-shot by design — the first terminal report wins. A `409` on retry is **success from the retry's point of view**: the work's result is already durably recorded. Read `current_status` from the response instead of re-posting.

### `400` on guard: prompt injection rejected

Prompt-injection scanning runs against `declared_goal` before evaluation. High-confidence system-override patterns force a block; malformed or hostile goals can be rejected outright with `400`.

## Integration footguns

### `waitForApproval` never resolves, or "action not found"

The #1 integration bug: **two different ids.** `guard()` returns a `decision_id` (`act_gd_…`, with a deprecated `action_id` alias of the same value). `createAction()` returns the real `action_id` (`act_…`). `waitForApproval`, outcome reporting, and `GET /api/actions/:id` take the id from **`createAction`**. Passing guard's id targets a different table and will never resolve.

Also check the wait window: clients declare `approval_wait_seconds` (SDKs/MCP default 300, the Claude Code pretool hook defaults 30 via `DASHCLAW_APPROVAL_TIMEOUT`). If the human reliably approves at minute six, raise the window — or rely on the 15-minute late-approval grace and just retry the identical call.

### Agent retried and did the work twice

Do not treat a missing, `failed`, or `lost_confirmation` outcome as proof that the external effect did not happen. Reconcile the target system first. An execution claim authorizes one recorded attempt, and an `idempotency_key` deduplicates the DashClaw action record; neither makes an arbitrary external callback exactly once. Automatic retry is safe only when the target offers an effect-specific idempotency key or another authoritative reconciliation primitive. Spec: [durable execution finality](./architecture/durable-execution-finality.md).

### Claude Code hooks installed but nothing lands in `/decisions`

1. Verify the wiring directly:
   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_use_id":"t1","session_id":"smoke"}' | python .claude/hooks/dashclaw_pretool.py
   ```
2. Set `DASHCLAW_HOOK_DEBUG=1` in `~/.dashclaw/claude-hooks/.env` and re-run — the hook writes breadcrumbs on every invocation.
3. Check the hook credentials in that same `.env` (`dashclaw install claude` writes them there; nothing secret lives in `settings.json`).
4. Restart the Claude Code session — hook config is read at session start.

Fresh installs default to **enforce**; if you installed with `--observe` or set `DASHCLAW_HOOK_MODE=observe`, decisions **log** but nothing blocks. Re-installs keep whichever mode you chose.

### Some tool calls land in `/decisions` but whole categories are missing

Bash runs, or file writes, or sub-agent spawns never appear at all, while other tools record normally. That is governance **scope**, not a broken hook: `DASHCLAW_GOVERNED_CATEGORIES` decides which categories call guard, and the hook exits before the network call for one it excludes — so those calls produce no row and no signal, and the ledger looks clean because nothing was recorded, not because nothing happened.

Check that variable in `~/.dashclaw/claude-hooks/.env` (and the machine env, which shadows it). Remove it to restore the default scope, or set it to `all`. A **typo silently drops a real category** — `file-io` is not `file_io`, and the misspelled name is simply never governed.

Since v5.20 you do not have to catch this by hand: the hook declares the categories it is not governing on the calls it does still make, and any category dropped below the default (`execution,orchestration,file_io,interactive,mcp`) raises the red **Governance scope narrowed** signal on `/approvals`, naming what is unwatched. `search` and `system` are ungoverned out of the box by design and never raise it.

### MCP tools missing from the host

- stdio: the governance tool set only registers when both `DASHCLAW_URL` and `DASHCLAW_API_KEY` are present in the server's env block. No org id is needed — don't add one.
- Claude **Desktop** chat: local stdio servers crash under Desktop's bundled Node — use the OAuth connector (`https://<instance>/api/mcp`) instead. Walkthrough: [CLAUDE-DESKTOP-PLUGIN.md](./CLAUDE-DESKTOP-PLUGIN.md).
- OAuth connector loops on authorize/401: usually a stale consent tab or a preview-deployment URL — the connector must point at the production host.

### `npx dashclaw-demo` fails immediately

It needs Docker running — it pulls and runs the demo image. No Docker? The [hosted trial](https://hosted.dashclaw.io/connect) needs neither an install nor Docker.

### `npx dashclaw up` stalls or fails mid-provision

The pipeline is checkpointed — re-running `npx dashclaw up` resumes from the failed step rather than starting over. `--db docker|embedded|url` forces a database strategy if auto-detection picked wrong.

## When the dashboard misbehaves

- **Everything 503s after a `git pull`** (self-host from checkout): schema drift — `npm run db:migrate`. This is the same `SCHEMA_NOT_INITIALIZED` story as above, seen from the browser.
- **Live stream doesn't update across tabs/instances**: without Upstash Redis credentials, events are in-memory per serverless instance. Fine locally; add `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` for cross-instance replay.
- **Sign-in impossible after a fresh deploy**: set `DASHCLAW_LOCAL_ADMIN_PASSWORD` so you can sign in before configuring OAuth. See [deploy-without-oauth.md](./deploy-without-oauth.md).

## Still stuck

- `dashclaw doctor --json` output is the right thing to attach to a GitHub issue.
- Security-sensitive reports: do **not** open a public issue — see [SECURITY.md](./SECURITY.md) for coordinated disclosure.
