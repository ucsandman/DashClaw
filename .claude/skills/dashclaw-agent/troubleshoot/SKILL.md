---
name: troubleshoot
description: Debug DashClaw errors, signal issues, and misconfigurations
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: debugging
---

# Troubleshoot DashClaw

Systematic diagnostics for common DashClaw errors, signal anomalies, and configuration issues.

## Error Code Diagnostics

### 401 Unauthorized

**Symptom:** API calls return `401`.

**Checklist:**
1. Verify `x-api-key` header is set (not `Authorization: Bearer`)
2. Check `DASHCLAW_API_KEY` environment variable is set
3. Confirm the key hasn't been rotated — API keys are shown once at creation
4. Test with curl:
   ```bash
   curl -H "x-api-key: $DASHCLAW_API_KEY" $DASHCLAW_BASE_URL/api/health
   ```

**Root cause:** DashClaw uses `x-api-key` header, not Bearer tokens. The middleware does timing-safe comparison first, then falls back to hash lookup.

### 403 Forbidden

**Symptom:** API calls return `403`.

**Checklist:**
1. **Demo mode?** Demo mode blocks all write operations. Check `DASHCLAW_MODE` env var.
2. **Readonly key?** Some keys are read-only. Check key permissions in dashboard.
3. **Guard blocking?** If calling `/api/guard` and getting 403, a policy is blocking the action — this is working as intended.
4. **org_default trap?** The `org_default` org blocks API access except onboarding routes. Create a real org first.

### 429 Rate Limited

**Symptom:** API calls return `429 Too Many Requests`.

**Defaults:**
- Production: 100 requests/minute per IP
- Development: 1000 requests/minute per IP

**Fixes:**
- Set `DASHCLAW_DISABLE_RATE_LIMIT=true` for local development
- For production: use `UPSTASH_REDIS_REST_URL` for distributed rate limiting
- Batch operations where possible

### 503 Server Misconfigured

**Symptom:** API calls return `503`.

**Checklist:**
1. Is `DASHCLAW_API_KEY` set? Missing key → 503 on protected routes
2. Is `DATABASE_URL` valid? Check connection string
3. Run health check: `curl $DASHCLAW_BASE_URL/api/health`
4. Check the `/setup` page for readiness verification

## Common Gotchas

| Gotcha | Explanation |
|--------|-------------|
| Client-sent org headers stripped | Middleware ALWAYS strips `x-org-id`, `x-org-role`, `x-user-id` from requests. Org context comes from the API key, never the client. |
| Two thread systems | Context threads (`ct_*`) and message threads (`mt_*`) are separate systems. Don't mix them. |
| org_default blocks APIs | Users in `org_default` are blocked from most endpoints. Create or join a real org first. |
| API key shown once | Keys are displayed exactly once at creation. If lost, generate a new one. |
| 2MB body size limit | Request bodies larger than 2MB are rejected. |
| HTTPS required in production | Non-HTTPS connections are rejected in production mode. |
| Canonical JSON for signatures | Agent identity signatures require deterministic JSON key ordering. |
| Rate limiting is per-IP | Not per-key or per-agent. Multiple agents on same IP share the limit. |

## Signal Debugging

DashClaw computes 8 signal types. If signals are firing unexpectedly:

### 1. Autonomy Spikes
**Trigger:** >10 ungoverned actions/hour
**Fix:** Add guard checks before actions. Use `claw.guard()` before `claw.createAction()`.

### 2. High Impact, Low Oversight
**Trigger:** Irreversible decisions with risk ≥70 and no approval
**Fix:** Add approval gate policy for high-risk irreversible actions.

### 3. Repeated Failures
**Trigger:** >3 failures in 24 hours
**Fix:** Check agent logic. Review failed actions in dashboard for patterns.

### 4. Stale Open Loops
**Trigger:** Unresolved dependencies >48 hours old
**Fix:** Resolve or cancel open loops: `claw.resolveOpenLoop(loopId, 'resolved', 'Fixed')`.

### 5. Assumption Drift
**Trigger:** ≥2 invalidated assumptions in 7 days
**Fix:** Review assumptions. Agent may be operating on stale beliefs.

### 6. Stale Assumptions
**Trigger:** Unvalidated assumptions >14 days old
**Fix:** Validate or invalidate old assumptions: `claw.validateAssumption(id, true/false, reason)`.

### 7. Stale Running Actions
**Trigger:** Actions with status `running` for >1 hour
**Fix:** Two layers of cleanup:

1. **One-shot bulk repair** for any historical backlog:
   ```bash
   # Preview what would change
   node scripts/_run-with-env.mjs scripts/repair-stale-running-actions.mjs --dry-run --older-than-hours 1
   # Apply (status='completed' with "Auto-closed" summary; preserves error_message → 'failed')
   node scripts/_run-with-env.mjs scripts/repair-stale-running-actions.mjs --older-than-hours 1
   ```
2. **Prevent re-accumulation** — install `dashclaw_stop.py` (Stop hook). At turn end it queries each open action and PATCHes `status='completed'` only when the action is still `running`. Terminal statuses written by PostToolUse are preserved. See `setup-dashclaw` skill.

For ad-hoc closure of a single action: `claw.updateOutcome(actionId, { status: 'failed', output_summary: 'Timed out' })`.

### 8. Agent Silent
**Trigger:** Agent heartbeat lost >10 minutes
**Fix:** Ensure agent sends heartbeats: `claw.heartbeat({ status: 'online' })`.

## Diagnostic Tools

### Health probe

```bash
curl -sf "$DASHCLAW_BASE_URL/api/health" | jq '.'
```

Returns `{status, version, checks: {database, runtime, realtime, ...}}`. Anything other than `status: "healthy"` points at the failing check.

### Doctor (config audit)

```bash
node scripts/doctor.mjs
```

Audits the local config — env vars, DB connectivity, schema state, generated artifact freshness.

### Live SDK round-trip

```bash
# Node — guard → createAction → updateOutcome against the live instance
node scripts/_run-with-env.mjs scripts/test-sdk-live.mjs

# Python equivalent
node scripts/_run-with-env.mjs scripts/run-sdk-live-python.mjs
```

Both scripts emit a real action that you should see appear on `/decisions` within seconds. If the round-trip fails, the error pinpoints the layer (HTTP, validation, DB).

### Startup smoke test

```bash
npm run startup:smoke
```

Boots Next.js, hits the critical routes, and reports which (if any) fail to respond.

## Hook Troubleshooting

### Pretool not firing
- Verify `.claude/settings.json` has PreToolUse hook configured
- Check matcher pattern: `Bash|Edit|Write|MultiEdit`
- Verify Python is available: `python --version`
- Check hook script path is correct relative to project root

### Pretool allows everything
- Check `DASHCLAW_HOOK_MODE` — if set to `observe`, it logs but never blocks
- Check `DASHCLAW_RISK_THRESHOLD` — default is 60, lower it to catch more
- Verify policies exist: `curl -H "x-api-key: $KEY" $URL/api/policies`

### Pretool blocks everything
- Check guard policies — a too-broad policy may be catching all actions
- Try `DASHCLAW_HOOK_MODE=observe` first to understand what's being caught
- Check risk scoring — are file operations being scored too high?

### Posttool not recording outcomes
- Check temp file bridge: pretool writes to `{tempdir}/dashclaw_last_action_{tool_use_id}`
- Verify `DASHCLAW_BASE_URL` and `DASHCLAW_API_KEY` are set for posttool
- Posttool never blocks — failures are silent. Check DashClaw server logs.

### Stop hook not capturing tokens (Analytics shows $0 / 0 tokens)
- Verify `.claude/settings.json` has the `Stop` block (one entry, no matcher needed). If missing, re-run `node /path/to/DashClaw/scripts/install-hooks.mjs --target=.`.
- During a turn, confirm pretool is appending action_ids: `ls /tmp/dashclaw_turn_<session_id>` (Linux/macOS) or `dir %TEMP%\dashclaw_turn_<session_id>` (Windows). After Stop fires, that file is deleted and `/tmp/dashclaw_stop_cursor_<session_id>` appears.
- Manually fire the Stop hook to test:
  ```bash
  echo '{"session_id":"<your-session-id>","transcript_path":"<path/to/.jsonl>"}' \
    | python .claude/hooks/dashclaw_stop.py; echo "exit=$?"
  ```
  Then query the DB for any action_id from that session — `tokens_in`, `tokens_out`, `model`, `cost_estimate` should be populated.
- Confirm `PATCH /api/actions/:id` accepts token fields by checking the deployed server version: `curl -sf $DASHCLAW_BASE_URL/api/health | jq '.version'` should be ≥ 2.13.1. Older deploys silently drop `tokens_in`/`tokens_out`.

### Stale running actions piling up
- Verify the Stop hook is installed (above). It auto-closes any action still in `status='running'` at turn end. Without it, every interrupted/abandoned tool stays open forever.
- For a one-shot cleanup: `node scripts/_run-with-env.mjs scripts/repair-stale-running-actions.mjs --older-than-hours 1` (preview with `--dry-run` first).
