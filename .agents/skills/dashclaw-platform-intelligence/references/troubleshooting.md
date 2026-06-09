# DashClaw Troubleshooting Guide

## Table of Contents

- [Triage: Run Doctor First](#triage-run-doctor-first)
- [Error: 401 Unauthorized](#error-401-unauthorized)
- [Error: 403 Forbidden](#error-403-forbidden)
- [Error: 429 Rate Limited](#error-429-rate-limited)
- [Error: 503 Server Misconfigured](#error-503-server-misconfigured)
- [Error: redirect_uri Not Associated](#error-redirect_uri-not-associated)
- [First User Not Admin](#first-user-not-admin)
- [Actions Not Appearing in Dashboard](#actions-not-appearing-in-dashboard)
- [Hooks Don't Fire (Fresh / Docker / Out-of-Box)](#hooks-dont-fire-fresh--docker--out-of-box)
- [Blocked Actions Not Audited](#blocked-actions-not-audited)
- [Agent Pairing Fails](#agent-pairing-fails)
- [Guard Blocks Unexpectedly](#guard-blocks-unexpectedly)
- [Session Stalled](#session-stalled)
- [Branch Freshness Block](#branch-freshness-block)
- [MCP Degraded](#mcp-degraded)
- [Drift Guard Failed](#drift-guard-failed)
- [Permission Escalation Block](#permission-escalation-block)
- [Stale Running Actions / "Other" Bucket Dominates](#stale-running-actions--other-bucket-dominates)
- [Analytics Total Cost / Tokens Show Zero](#analytics-total-cost--tokens-show-zero)
- [Common Gotchas](#common-gotchas)
- [General Diagnostic Approach](#general-diagnostic-approach)
- [Companion Diagnostic Scripts](#companion-diagnostic-scripts)

## Stale Running Actions / "Other" Bucket Dominates

**Symptom:** Action Volume chart's "Other" bucket greatly exceeds Completed/Failed/Blocked. Most rows in `action_records` have `status='running'` and no `timestamp_end`.

**Cause:** PreToolUse opened the action but PostToolUse never closed it (interrupted tool, agent crash, posttool HTTP failure, or — historically — the pre-2026-04-09 `updated_at` column bug).

**Fix:**
1. **One-shot bulk repair** — close any running action older than the threshold. Reversible (status update only, no deletion).
   ```bash
   # Preview
   node scripts/_run-with-env.mjs scripts/repair-stale-running-actions.mjs --dry-run --older-than-hours 1
   # Apply (status='completed' with auto-close summary; preserves rows with error_message → 'failed')
   node scripts/_run-with-env.mjs scripts/repair-stale-running-actions.mjs --older-than-hours 1
   ```
2. **Stop re-accumulation** — install the Stop hook (`hooks/dashclaw_stop.py`). It auto-closes any action still in `status='running'` at turn end while preserving terminal statuses written by PostToolUse. Use `node scripts/install-hooks.mjs --target=.` to install all three hooks correctly.

## Analytics Total Cost / Tokens Show Zero

**Symptom:** `/analytics` shows `$0.00 Total Cost`, `0 Input Tokens`, `0 Output Tokens` even though Actions and Active Agents are populated.

**Cause:** Agents aren't reporting `tokens_in` / `tokens_out` / `model` to `/api/actions` (POST or PATCH). Pre-2026-04-14 the PATCH route silently dropped these fields anyway.

**Fix:**
1. Confirm the deployed server build accepts token fields: `curl -sf $DASHCLAW_BASE_URL/api/health | jq '.version'` should be ≥ 2.13.1.
2. Confirm the `model` column exists: `SELECT column_name FROM information_schema.columns WHERE table_name='action_records' AND column_name='model';` returns one row. If not, run `node scripts/_run-with-env.mjs scripts/migrate-action-model-column.mjs`.
3. Wire token reporting:
   - **Claude Code** — install the Stop hook (`node scripts/install-hooks.mjs --target=.`).
   - **OpenClaw** — upgrade to `@dashclaw/openclaw-plugin@1.2.1+`.
   - **Custom SDK agents** — pass `tokens_in`, `tokens_out`, `model` in your `updateOutcome` calls; cost is derived server-side.
4. See `docs/ANALYTICS-ROLLOUT.md` for the full data flow and verification queries.

## Triage: Run Doctor First

For almost any self-host issue, run Doctor before anything else. It diagnoses database schema, configuration, auth, deployment, SDK reachability, governance staleness, and livingcode shape drift — and auto-fixes safe issues.

```bash
# As an operator on the host:
npm run doctor                  # local mode — can write .env, run migrations

# From anywhere with an API key:
dashclaw doctor                 # rich terminal output, invokes /api/doctor[/fix]
dashclaw doctor --no-fix        # diagnose only
dashclaw doctor --json          # for CI / scripts
dashclaw doctor --category database,config
```

**Exit codes:** `0` healthy, `1` warnings/failures/unreachable.

If Doctor reports `drift_detected`, see [Drift Guard Failed](#drift-guard-failed). If it fails with no config, it will prompt you interactively and offer to save to `~/.dashclaw/config.json` (`600` mode). Use `dashclaw logout` to remove saved credentials.

## Error: 401 Unauthorized

**"Unauthorized - Invalid or missing API key"**

1. Check `x-api-key` header is being sent (not query params -- those leak in logs)
2. Check `DASHCLAW_API_KEY` is set in the server's `.env`
3. If using multi-org keys, verify the key hash exists in `api_keys` table and is not revoked
4. If using session auth (dashboard), check `Sec-Fetch-Site` is `same-origin`
5. Cross-origin requests without an API key always get 401

## Error: 403 Forbidden

Multiple causes -- check the error message:

**"Demo mode: write APIs are disabled"**
- You are hitting the demo instance (`DASHCLAW_MODE=demo`)
- Writes are blocked in demo mode by design
- Fix: Use your self-hosted instance URL instead

**"Forbidden - readonly API key"**
- The API key has `role=readonly` in the `api_keys` table
- Fix: Use an admin-role API key for write operations

**"Forbidden - Complete onboarding to access this resource"**
- User is on `org_default`, which is blocked from all APIs except onboarding
- Fix: Complete workspace setup at `/setup` on the dashboard
- Response includes `{ needsOnboarding: true }` for programmatic detection

**"Guard blocked action"**
- Behavior guard policy matched and returned `decision: block`
- Check `decision.reasons` and `decision.matched_policies` in the response
- Fix: Adjust the policy, lower the risk score, or change the action type

## Error: 429 Rate Limited

**"Rate limit exceeded. Please slow down."**

Defaults:
- Production: 100 requests per minute
- Development: 1000 requests per minute

Fixes:
- Wait 60 seconds (Retry-After header is set)
- Increase: `DASHCLAW_RATE_LIMIT_MAX=500` in server `.env`
- Adjust window: `DASHCLAW_RATE_LIMIT_WINDOW_MS=120000` (2 minutes)
- Dev bypass: `DASHCLAW_DISABLE_RATE_LIMIT=true`

For agents that batch operations, implement client-side rate limiting or increase the server limit.

## Error: 503 Server Misconfigured

**"Server misconfigured: set DASHCLAW_API_KEY to protect /api/* endpoints"**
- Production mode but no `DASHCLAW_API_KEY` env var set
- Fix: Set `DASHCLAW_API_KEY` in server `.env`

**"DASHCLAW_API_KEY_ORG references org that does not exist"**
- The configured org ID doesn't exist in the `organizations` table
- Fix: Run migrations:
  ```bash
  node scripts/_run-with-env.mjs scripts/migrate-multi-tenant.mjs
  ```
- Or create the org: `POST /api/orgs` with admin key

## Error: redirect_uri Not Associated

OAuth callback URL missing from your provider app settings.

Add these callback URLs:
- **GitHub:** `http://localhost:3000/api/auth/callback/github`
- **Google:** `http://localhost:3000/api/auth/callback/google`

For production, replace `http://localhost:3000` with your deployed URL.

## First User Not Admin

**Symptom:** You signed in to a fresh self-hosted instance and landed with `role=member` instead of `role=admin`. You can't access admin-only surfaces.

**Expected behavior:** The **first user** to sign in to a fresh instance is auto-promoted to `role=admin` in their org (BUG-03 fix, `707c5636`). Subsequent signups default to `role=member`.

**Diagnosis:**

1. Confirm you were the first sign-in (another user signing in before OAuth redirect churn completes is a common cause — the signIn callback gates promotion on a settled session, not bootstrap).
2. Check the `users` table for your row and inspect `role` and `organization_id`.
3. If an admin already exists, first-user promotion is skipped by design. Ask the existing admin to promote you via `PATCH /api/team/[userId]`.

**Fix:** If you were genuinely first and the promotion didn't happen (stale code pre-fix), upgrade past `707c5636` or manually `UPDATE users SET role='admin' WHERE id=...`.

## Actions Not Appearing in Dashboard

0. **Hooks never fired** (the most common cause for a Claude Code agent that recorded *nothing*): the governance hooks weren't installed (the plugin doesn't install them) or didn't load (project-settings folder-trust gate in a fresh/Docker session). See [Hooks Don't Fire](#hooks-dont-fire-fresh--docker--out-of-box).
1. **Org mismatch**: The agent's API key must resolve to the same org as the dashboard user. Check which org the key maps to.
2. **Route handler check**: Verify `const orgId = request.headers.get('x-org-id')` is being used to scope queries.
3. **Demo mode confusion**: If `DASHCLAW_MODE=demo`, the dashboard shows fixture data, not real data.
4. Run the diagnostic script:
   ```bash
   node .claude/skills/dashclaw-platform-intelligence/scripts/diagnose.mjs \
     --base-url http://localhost:3000 --api-key $DASHCLAW_API_KEY
   ```

## Hooks Don't Fire (Fresh / Docker / Out-of-Box)

**Symptom:** You set up DashClaw, ran an agent, and NOTHING was recorded — no PreToolUse/PostToolUse governance, no actions in the ledger — even though the hook scripts work when invoked manually. Often a global Stop hook DID fire while the project Pre/PostToolUse hooks didn't.

**Most common causes:**

1. **Hooks were never installed, or you're on an old setup.** As of plugin bundle **2.14.1** the marketplace plugin **bundles** the Pre/Post/Stop hooks — they fire as soon as the plugin is enabled (no separate step, no folder-trust gate). Older plugin versions shipped MCP + skills only, so if you installed before that — or wired the MCP server manually — run the standalone installer: `node scripts/install-hooks.mjs` (per project) or `--global --governance` (user-level).

2. **Bundled hooks need Python + creds.** Plugin-bundled hooks run `python "${CLAUDE_PLUGIN_ROOT}/hooks/dashclaw_pretool.py"` — they exit silently if Python isn't on PATH, or if `DASHCLAW_BASE_URL` (or `DASHCLAW_URL`) + `DASHCLAW_API_KEY` aren't in the environment Claude Code launched from.

3. **Folder Trust gates the STANDALONE per-project installer (not the plugin).** If you used `install-hooks.mjs` to write a project `.claude/settings.json`, those hooks only load **after** you accept Claude Code's "trust this folder?" prompt — so in a fresh / Docker / headless session they silently never load, while a **user-level** `~/.claude/settings.json` hook still fires (the classic "Stop ran but Pre/PostToolUse didn't"). **Plugin-bundled hooks and `--global --governance` (user-level) are NOT gated by folder trust.**

**Also note:** the `npx dashclaw-demo` Docker image is the web app in demo mode + a *scripted* SDK agent (`scripts/demo-agent.mjs`, agent_id `pipeline-agent`) — NOT a Claude Code harness, so it never exercises hooks regardless of settings.

**Simplest fix — install/enable the DashClaw plugin** (`claude plugin install dashclaw@dashclaw`): the hooks are bundled and fire on enable with no trust gate. Then just set Python + `DASHCLAW_BASE_URL`/`DASHCLAW_API_KEY` in the env.

**Fix without the plugin — install at the USER level (no trust gate; fires in every project incl. Docker):**

```bash
# The repo must be present in the environment (hooks are Python; needs python3 + node).
export DASHCLAW_BASE_URL="https://your-instance"   # the hooks read this (DASHCLAW_URL also works)
export DASHCLAW_API_KEY="oc_live_..."
node scripts/install-hooks.mjs --global --governance   # full Pre/Post/Stop → ~/.claude/settings.json, NO secret written
# undo with: node scripts/install-hooks.mjs --global --governance --uninstall
```

Then start a **fresh** Claude Code session (so it reads `~/.claude/settings.json`) and run a tool. Verify at `<instance>/decisions`.

**10-second proof the hook + creds resolve (records one action under your agent_id):**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | python3 hooks/dashclaw_pretool.py; echo "exit=$?"
```

**Silent-config traps:**
- The hooks read `DASHCLAW_BASE_URL`; the MCP server reads `DASHCLAW_URL`. They now accept **either** name, but if your build predates that, setting only `DASHCLAW_URL` left the hooks silently dead.
- If **exactly one** of base-url / api-key is set, PreToolUse prints `[DashClaw] ⚠ Governance hook is half-configured — <VAR> is not set…` instead of exiting invisibly. If **both** are unset the hook stays silent by design (non-DashClaw users see nothing).
- Alternative to user-level install: accept the folder-trust prompt for the project (`claude` → "trust this folder" → restart) so the project `.claude/settings.json` hooks from `node scripts/install-hooks.mjs` load.

## Blocked Actions Not Audited

**Symptom:** Guard blocked an action but no record appears in the Decisions ledger or `action_records`.

**Cause:** Pre-BUG-02, `dashclaw_pretool`'s `handle_block` returned early without recording. The fix now records blocked actions with `status=blocked`.

**Fix:**

1. Verify you're running a hook version that includes the BUG-02 fix (`e9ce9aaa`, `6f0a57bd`).
2. Confirm the server accepts `status=blocked` on `POST /api/actions` (it does post-`6f0a57bd`).
3. Re-run the action to confirm a `blocked` row now lands in the audit trail.

## Agent Pairing Fails

The agent pairing flow has several gotchas:

1. **Canonical JSON ordering matters** for signature verification. Use `JSON.stringify` with sorted keys.
2. **Middleware strips client-sent org headers.** The pairing request goes through without org context initially; an admin must approve.
3. **Full flow:**
   - Generate RSA keypair
   - `POST /api/pairings` with public key PEM
   - Operator approves at the approval URL (returned in response)
   - Agent polls `GET /api/pairings/{id}` or uses `waitForPairing()`
4. If the admin key is wrong, the approval POST will 401.

## Guard Blocks Unexpectedly

1. Check which policies matched: look at `decision.matched_policies` in the guard response
2. Test the policy in isolation:
   ```javascript
   const result = await dc.testPolicy({
     policyId: 'pol_xxx',
     testInput: { actionType: 'your_type', riskScore: 50 }
   });
   ```
3. Check guard policies on the server (v1 SDK constructor accepts `guardMode`, v2 uses server-side policy config)
4. If using `DASHCLAW_GUARD_FALLBACK=block`, the guard fails closed when the LLM is unavailable

## Session Stalled

**Symptom:** Agent session shows `status: stalled` and no new actions are being recorded.

**Cause:** The session exceeded the idle threshold without activity. DashClaw emits a `session_stalled` signal when no actions, messages, or heartbeats are received within the configured window.

**Fix:**

1. Check the session status and blocked reason:
   ```bash
   curl -H "x-api-key: $DASHCLAW_API_KEY" \
     $DASHCLAW_BASE_URL/api/sessions/$SESSION_ID
   ```
2. If the agent is alive but idle, update the session to clear the stall:
   ```javascript
   await dc.updateSession(sessionId, {
     status: 'active',
     blocked_reason: null,
   });
   ```
3. If the agent crashed, mark the session as `ended` and create a new one:
   ```javascript
   await dc.updateSession(sessionId, { status: 'ended', blocked_reason: 'agent_crash' });
   const fresh = await dc.createSession({ agent_id, workspace, branch });
   ```

## Branch Freshness Block

**Symptom:** Guard returns `block` with `matched_policies` containing a `branch_freshness` policy. Error message says the branch is behind main.

**Cause:** The working branch has fallen too far behind the base branch. A `branch_freshness` guard policy is configured with a `max_commits_behind` threshold, and the session's `commits_behind` value exceeds it.

**Fix:**

1. Rebase or merge the latest changes from the base branch:
   ```bash
   git fetch origin && git rebase origin/main
   ```
2. Update the session to reflect the fresh state:
   ```javascript
   await dc.updateSession(sessionId, {
     branch_freshness: 'fresh',
     commits_behind: 0,
   });
   ```
3. Retry the guarded action.

## MCP Degraded

**Symptom:** A `mcp_degraded` signal appears. MCP tools may timeout or return errors. Session may show `blocked_reason: mcp_handshake_failed`.

**Cause:** The MCP tool connection dropped or the handshake failed. This can happen due to network issues, MCP server restarts, or misconfigured tool endpoints.

**Fix:**

1. Check MCP server health and network connectivity.
2. Retry the MCP handshake:
   ```javascript
   // The hooks layer will automatically retry on the next tool call.
   // To force a reconnect, restart the agent or Claude Code session.
   ```
3. If the MCP server is down, clear the blocked reason so other work can continue:
   ```javascript
   await dc.updateSession(sessionId, {
     status: 'active',
     blocked_reason: null,
   });
   ```
4. Check the session events for the full error trail:
   ```bash
   curl -H "x-api-key: $DASHCLAW_API_KEY" \
     $DASHCLAW_BASE_URL/api/sessions/$SESSION_ID/events
   ```

## Drift Guard Failed

**Symptom:** `npm run doctor` (or `dashclaw doctor`) reports `drift_detected`. Pre-commit hook aborts with a livingcode drift warning. Skill/OpenAPI/API inventory artifacts look out of date.

**Cause:** The livingcode shape snapshot at `app/lib/doctor/generated/last-snapshot.json` disagrees with the current repo shape. Some source under `app/api/`, `app/lib/`, `schema/schema.js`, `middleware.js`, or `livingcode/` changed without regenerating derivative artifacts.

**Fix:**

```bash
npm run livingcode:refresh
```

That re-emits `shape.json`, `last-snapshot.json`, doctor check modules, the MCP route inventory, `public/downloads/dashclaw-platform-intelligence/SKILL.md`, the zip + manifest, and the global `~/.claude/skills/dashclaw-platform-intelligence/SKILL.md` (if writable). Outputs are idempotent — re-runs produce byte-identical content when source is unchanged.

**Never hand-edit generated artifacts.** Pre-commit will overwrite them and you'll lose your changes. Edit the source (code / `livingcode/emitters/*.py` / `references/*.md`) and regenerate.

## Permission Escalation Block

**Symptom:** Guard returns `block` with `matched_policies` containing a `permission_escalation` policy. The agent attempted an action requiring a higher permission level than its pairing allows.

**Cause:** The agent's pairing has a `permission_level` (e.g., `readonly` or `workspace_write`) that is insufficient for the requested operation. A `permission_escalation` policy prevents the agent from self-elevating.

**Fix:**

1. Check the agent's current permission level:
   ```bash
   curl -H "x-api-key: $DASHCLAW_API_KEY" \
     $DASHCLAW_BASE_URL/api/pairings/$PAIRING_ID
   ```
2. If the agent legitimately needs higher permissions, an operator must update the pairing:
   ```javascript
   // PATCH /api/pairings/{pairingId} with the new permission level
   // Valid levels: readonly, workspace_write, danger, prompt, allow
   await fetch(`${baseUrl}/api/pairings/${pairingId}`, {
     method: 'PATCH',
     headers: { 'x-api-key': operatorKey, 'Content-Type': 'application/json' },
     body: JSON.stringify({ permission_level: 'workspace_write' }),
   });
   ```
3. Retry the guarded action after the pairing is updated.

## Common Gotchas

1. **Client-sent org headers are stripped.** Middleware always removes `x-org-id`, `x-org-role`, `x-user-id` from inbound requests. Org context comes from API key resolution only.

2. **Two thread systems exist.** Context threads (`ct_*` via `/api/context/threads`) track reasoning. Message threads (`mt_*` via `/api/messages/threads`) are for communication. Not interchangeable.

3. **org_default trap.** New users land on `org_default` which is blocked from all APIs except onboarding. Must complete workspace setup first.

4. **API key shown once.** The onboarding key is displayed exactly once. If lost, generate a new one via `POST /api/keys` or the dashboard.

5. **Body size limit.** 2MB max for POST/PUT/PATCH. Large sync payloads should be chunked.

6. **HTTPS in production.** SDK warns if `baseUrl` is not HTTPS. API keys sent over HTTP are visible to network observers.

7. **Repository pattern enforced.** Never put SQL in route files. CI catches it via `npm run route-sql:check`.

8. **Demo writes always 403.** Even if you have a valid API key, `DASHCLAW_MODE=demo` blocks all writes.

9. **Agent signatures need canonical JSON.** Key ordering matters when signing payloads.

10. **Rate limiting is per-IP.** Multiple agents on the same machine share a rate limit bucket.

11. **Plugin ≠ hooks, and project hooks need folder-trust.** `claude plugin install dashclaw` ships MCP + skills only; governance hooks are a separate `node scripts/install-hooks.mjs` step. Project `.claude/settings.json` hooks won't load in a fresh/Docker session until you accept Claude Code's folder-trust prompt — use `--global --governance` to install at the user level and skip the gate. See [Hooks Don't Fire](#hooks-dont-fire-fresh--docker--out-of-box).

## General Diagnostic Approach

```
1. Check the HTTP status code and full error message
2. Map it to a section above
3. Check middleware.js for the exact condition producing that error
4. Check the route handler: app/api/<path>/route.js
5. Check the repository: app/lib/repositories/<domain>.repository.js
6. Check if migrations are needed (missing tables/columns)
7. Run the diagnose script for automated checks
```

## Companion Diagnostic Scripts

**Full validation:**
```bash
node .claude/skills/dashclaw-platform-intelligence/scripts/validate-integration.mjs \
  --base-url http://localhost:3000 --api-key $DASHCLAW_API_KEY --full
```

**Targeted diagnosis:**
```bash
node .claude/skills/dashclaw-platform-intelligence/scripts/diagnose.mjs \
  --base-url http://localhost:3000 --api-key $DASHCLAW_API_KEY \
  --error "403 Forbidden" --endpoint "/api/actions"
```

Both scripts support `--json` for machine-readable output.
