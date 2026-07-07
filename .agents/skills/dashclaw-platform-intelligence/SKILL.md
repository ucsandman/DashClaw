---
name: dashclaw-platform-intelligence
description: DashClaw platform expert for integration, troubleshooting, and governance. Snapshot-based — prefer live queries via `python -m livingcode query`, or `GET {baseUrl}/api/doctor` when Python/livingcode/the repo are unavailable.
---

# DashClaw Platform Intelligence

**Shape snapshot:** `sha1:50ceb610985c8781a2167d748ecf79b58040b059`
**This file is auto-generated.** Do not edit by hand — regenerate with:

```bash
python -m livingcode emit skill --output <path-to-SKILL.md>
```

## Prefer Live Queries

The facts below are a snapshot. Before answering any question about DashClaw's current
structure, routes, env vars, or schema — run a live query:

```bash
python -m livingcode query summary     # High-level shape
python -m livingcode query routes      # Current API surface
python -m livingcode query env         # Current env vars
python -m livingcode query tables      # Current schema
python -m livingcode query all --json  # Full machine-readable shape
```

If the snapshot below disagrees with a live query, **trust the live query**.

### Fallback: no Python, livingcode, or repo checkout

`python -m livingcode` only works where the livingcode package and the repo
checkout are present (e.g. a developer machine). In OpenClaw / the Claude app
neither exists. When you cannot run the queries above, fall back **in this order**:

1. **`GET {baseUrl}/api/doctor`** — live route/shape health straight from the running
   instance. Requires the workspace API key (`x-api-key: <key>`); returns 401/403
   without it. This is the authoritative live source when the CLI is unavailable.
2. **Read the committed static shape** if a repo checkout is reachable:
   `app/lib/doctor/generated/shape.json` (full machine-readable shape) and
   `docs/api-inventory.json` (route inventory). These are regenerated on every
   `npm run livingcode:refresh`, so they track the same facts the queries return.
3. **Otherwise, treat the snapshot in this SKILL.md as authoritative** — it is the
   best available source when neither the API nor the repo can be reached.

## At a Glance

- **116** active API routes across **47** categories (116 total including archived)
- **4** required + **142** optional environment variables
- **112** database tables

## API Surface

### `actions`

- `DELETE, GET, POST` `/api/actions`
- `GET, PATCH` `/api/actions/[actionId]`
- `GET` `/api/actions/[actionId]/artifacts`
- `GET` `/api/actions/[actionId]/graph`
- `GET, POST` `/api/actions/[actionId]/outcome`
- `GET` `/api/actions/[actionId]/trace`
- `GET` `/api/actions/stats`

### `activity`

- `GET` `/api/activity`

### `admin`

- `POST` `/api/admin/trigger-outcome-sweep`

### `agents`

- `GET` `/api/agents/fanouts`

### `approvals`

- `POST` `/api/approvals/[actionId]`
- `POST` `/api/approvals/bulk`
- `GET` `/api/approvals/floods`

### `artifacts`

- `GET, POST` `/api/artifacts`
- `DELETE, GET` `/api/artifacts/[artifactId]`
- `POST` `/api/artifacts/evidence-bundle`

### `assumptions`

- `GET, POST` `/api/assumptions`
- `GET, PATCH` `/api/assumptions/[assumptionId]`

### `auth`

- `-` `/api/auth/[...nextauth]`
- `GET` `/api/auth/config`
- `DELETE, POST` `/api/auth/local`

### `calibration`

- `GET, POST` `/api/calibration/controller`
- `GET, POST` `/api/calibration/proposals`

### `capabilities`

- `GET` `/api/capabilities`
- `GET` `/api/capabilities/[capabilityId]/access/check`
- `POST` `/api/capabilities/[capabilityId]/invoke`

### `coverage`

- `GET, POST` `/api/coverage`

### `cron`

- `GET` `/api/cron/integration-health`
- `GET` `/api/cron/jti-sweep`
- `GET` `/api/cron/memory-maintenance`
- `GET` `/api/cron/outcome-sweep`
- `GET` `/api/cron/policy-suggestions`
- `GET` `/api/cron/signals`

### `discord`

- `POST` `/api/discord/interactions`

### `docs`

- `GET` `/api/docs/raw`

### `doctor`

- `GET` `/api/doctor`
- `POST` `/api/doctor/fix`

### `echo`

- `GET, POST` `/api/echo`

### `enforcement-liveness`

- `GET, POST` `/api/enforcement-liveness`

### `guard`

- `GET, POST` `/api/guard`
- `GET` `/api/guard/decisions`

### `halt`

- `GET, POST` `/api/halt`

### `health`

- `GET` `/api/health`

### `hosted`

- `GET` `/api/hosted/capacity`
- `POST` `/api/hosted/cleanup`
- `GET` `/api/hosted/funnel`
- `GET, POST` `/api/hosted/workspaces`
- `DELETE, GET` `/api/hosted/workspaces/[workspaceId]`

### `identities`

- `GET, POST` `/api/identities`
- `DELETE` `/api/identities/[agentId]`

### `integrations`

- `GET` `/api/integrations/health`
- `POST` `/api/integrations/health/refresh`

### `integrity`

- `GET` `/api/integrity/jwks`
- `POST` `/api/integrity/verify`

### `internal`

- `POST` `/api/internal/resolve-key`

### `keys`

- `DELETE, GET, POST` `/api/keys`
- `GET` `/api/keys/reveal`

### `live-canary`

- `GET, POST` `/api/live-canary`

### `marketing`

- `POST` `/api/marketing/event`

### `mcp`

- `POST` `/api/mcp`

### `messages`

- `GET, PATCH, POST` `/api/messages`

### `oauth`

- `GET, POST` `/api/oauth/authorize`
- `GET` `/api/oauth/metadata/authorization-server`
- `GET` `/api/oauth/metadata/protected-resource`
- `POST` `/api/oauth/register`
- `POST` `/api/oauth/token`

### `operations`

- `GET` `/api/operations/summary`

### `orgs`

- `GET, POST` `/api/orgs`
- `GET, PATCH` `/api/orgs/[orgId]`
- `DELETE, GET, POST` `/api/orgs/[orgId]/keys`

### `pairings`

- `GET, POST` `/api/pairings`
- `GET, PATCH` `/api/pairings/[pairingId]`
- `POST` `/api/pairings/[pairingId]/approve`

### `policies`

- `DELETE, GET, PATCH, POST` `/api/policies`
- `GET` `/api/policies/contract`
- `POST` `/api/policies/generate`
- `POST` `/api/policies/import`
- `GET, POST` `/api/policies/loosening`
- `GET` `/api/policies/modes`
- `POST` `/api/policies/modes/import`
- `POST` `/api/policies/modes/preview`
- `GET` `/api/policies/proof`
- `GET, POST` `/api/policies/proposals`
- `GET` `/api/policies/review`
- `POST` `/api/policies/review/verdict`
- `POST` `/api/policies/simulate`
- `GET` `/api/policies/summary`
- `GET` `/api/policies/templates`
- `POST` `/api/policies/test`
- `GET, POST` `/api/policies/tightening`

### `prompts`

- `GET` `/api/prompts/agent-connect/raw`
- `GET` `/api/prompts/sdk-coverage/raw`
- `GET` `/api/prompts/server-setup/raw`

### `security`

- `GET, POST` `/api/security/prompt-injection`
- `GET` `/api/security/status`

### `self-governance`

- `GET` `/api/self-governance`

### `session`

- `GET` `/api/session/effective`

### `sessions`

- `GET, POST` `/api/sessions`
- `GET, PATCH` `/api/sessions/[sessionId]`
- `GET` `/api/sessions/[sessionId]/actions`
- `GET` `/api/sessions/[sessionId]/events`
- `GET` `/api/sessions/[sessionId]/retro`

### `settings`

- `DELETE, GET, POST` `/api/settings`
- `POST` `/api/settings/test`

### `setup`

- `POST` `/api/setup/live-proof`
- `POST` `/api/setup/migrate`
- `POST` `/api/setup/ping`
- `GET` `/api/setup/proof`
- `GET` `/api/setup/status`

### `signals`

- `GET` `/api/signals`

### `stream`

- `GET` `/api/stream`

### `telegram`

- `POST` `/api/telegram/webhook`

### `webhooks`

- `DELETE, GET, POST` `/api/webhooks`
- `GET` `/api/webhooks/[webhookId]/deliveries`
- `POST` `/api/webhooks/[webhookId]/test`

### `workspace`

- `GET` `/api/workspace/export`
- `POST` `/api/workspace/import`

## Required Environment Variables

These must be set — DashClaw will fail to start without them.

- **`DASHCLAW_API_KEY`** - referenced in 72 file(s)
- **`DATABASE_URL`** - referenced in 74 file(s)
- **`ENCRYPTION_KEY`** - referenced in 4 file(s)
- **`NEXTAUTH_SECRET`** - referenced in 6 file(s)

## Optional Environment Variables

These have fallbacks or only activate specific features.

- `AGENT_ONLINE_WINDOW_MS` *(undocumented)*
- `AGENT_PRIVATE_KEY` *(undocumented)*
- `ALERT_FROM_EMAIL` *(undocumented)*
- `ALLOWED_ORIGIN` *(undocumented)*
- `ANTHROPIC_API_KEY` *(undocumented)*
- `ANTHROPIC_MODEL` *(undocumented)*
- `API_INVENTORY_VERIFIED_DATE` *(undocumented)*
- `API_KEY` *(undocumented)*
- `API_SECRET` *(undocumented)*
- `BASE_URL` *(undocumented)*
- `CI` *(undocumented)*
- `CRON_SECRET` *(undocumented)*
- `DASHCLAW_ACT_BINDING` *(undocumented)*
- `DASHCLAW_ACT_BINDING_TYP` *(undocumented)*
- `DASHCLAW_AGENT_ID` *(undocumented)*
- `DASHCLAW_ALERTS_DISCORD` *(undocumented)*
- `DASHCLAW_ALERTS_TELEGRAM` *(undocumented)*
- `DASHCLAW_ALLOWED_ISSUER` *(undocumented)*
- `DASHCLAW_API_KEY_ORG` *(undocumented)*
- `DASHCLAW_AUDIT_MAX_ENTRIES` *(undocumented)*
- `DASHCLAW_BASE_URL` *(undocumented)*
- `DASHCLAW_CLOSED_ENROLLMENT` *(undocumented)*
- `DASHCLAW_DB_DRIVER` *(undocumented)*
- `DASHCLAW_DB_POOL_MAX` *(undocumented)*
- `DASHCLAW_DISABLE_RATE_LIMIT` *(undocumented)*
- `DASHCLAW_EXPOSE_ERROR_DETAIL` *(undocumented)*
- `DASHCLAW_GUARD_DEADLINE_MS` *(undocumented)*
- `DASHCLAW_GUARD_FALLBACK` *(undocumented)*
- `DASHCLAW_GUARD_UNAVAILABLE_POLICY` *(undocumented)*
- `DASHCLAW_HOOK_MODE` *(undocumented)*
- `DASHCLAW_HOSTED` *(undocumented)*
- `DASHCLAW_HTTP_TIMEOUT_MS` *(undocumented)*
- `DASHCLAW_INTERNAL_BASE_URL` *(undocumented)*
- `DASHCLAW_JTI_MAX_TTL_SECONDS` *(undocumented)*
- `DASHCLAW_JTI_REPLAY_PROTECTION` *(undocumented)*
- `DASHCLAW_JWT_AUDIENCE` *(undocumented)*
- `DASHCLAW_LOCAL_ADMIN_PASSWORD` *(undocumented)*
- `DASHCLAW_LOCAL_HOME` *(undocumented)*
- `DASHCLAW_LOCK_STALE_MS` *(undocumented)*
- `DASHCLAW_LOG_STARTUP` *(undocumented)*
- `DASHCLAW_MEMORY_MAX_ENTRIES` *(undocumented)*
- `DASHCLAW_MODE` *(undocumented)*
- `DASHCLAW_NEW_CONNECT_WEBHOOK` *(undocumented)*
- `DASHCLAW_PAIRING_TTL_MINUTES` *(undocumented)*
- `DASHCLAW_RATE_LIMIT_MAX` *(undocumented)*
- `DASHCLAW_RATE_LIMIT_WINDOW_MS` *(undocumented)*
- `DASHCLAW_SELF_GOVERNANCE_PUBLIC` *(undocumented)*
- `DASHCLAW_SIGNING_KEY_JWK` *(undocumented)*
- `DASHCLAW_TIMEOUT_MS` *(undocumented)*
- `DASHCLAW_URL` *(undocumented)*
- `DISABLE_PROMPT_INJECTION_SCAN` *(undocumented)*
- `DISCORD_APPROVER_ORG_ID` *(undocumented)*
- `DISCORD_APPROVER_USER_ID` *(undocumented)*
- `DISCORD_BOT_TOKEN` *(undocumented)*
- `DISCORD_PUBLIC_KEY` *(undocumented)*
- `DRILL_IMPORT_API_KEY` *(undocumented)*
- `DRILL_IMPORT_BASE_URL` *(undocumented)*
- `ENFORCE_AGENT_SIGNATURES` *(undocumented)*
- `GITHUB_CLIENT_ID` *(undocumented)*
- `GITHUB_CLIENT_SECRET` *(undocumented)*
- `GITHUB_ID` *(undocumented)*
- `GITHUB_SECRET` *(undocumented)*
- `GITHUB_STEP_SUMMARY` *(undocumented)*
- `GOOGLE_CLIENT_ID` *(undocumented)*
- `GOOGLE_CLIENT_SECRET` *(undocumented)*
- `GOOGLE_ID` *(undocumented)*
- `GOOGLE_SECRET` *(undocumented)*
- `GUARD_LLM_KEY` *(undocumented)*
- `GUARD_WEBHOOK_SECRET` *(undocumented)*
- `HOSTED_ADMIN_API_KEY` *(undocumented)*
- `HOSTED_CLEANUP_SECRET` *(undocumented)*
- `HOSTED_DRILL_BASE_URL` *(undocumented)*
- `HOSTED_DRILL_TOKEN` *(undocumented)*
- `HOSTED_MAX_ACTIVE_TRIALS` *(undocumented)*
- `HOSTED_PROVISION_MAX_PER_IP_PER_DAY` *(undocumented)*
- `HOSTED_SMOKE_BASE_URL` *(undocumented)*
- `HOSTED_TRIAL_ACTION_CAP` *(undocumented)*
- `HOSTED_TRIAL_DAYS` *(undocumented)*
- `INTEGRATION_DATABASE_URL` *(undocumented)*
- `LIVE_CANARY_HOSTED_ORIGIN` *(undocumented)*
- `LIVE_CANARY_MARKETING_ORIGIN` *(undocumented)*
- `MOONSHOT_API_KEY` *(undocumented)*
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_` *(undocumented)*
- `NEXT_PUBLIC_DASHCLAW_MODE` *(undocumented)*
- `NEXT_PUBLIC_DASHCLAW_VERSION` *(undocumented)*
- `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS` *(undocumented)*
- `NEXT_PUBLIC_HOSTED_TRIAL_URL` *(undocumented)*
- `NEXT_PUBLIC_PLUGIN_MANIFEST_VERSION` *(undocumented)*
- `NEXT_PUBLIC_SDK_NODE_VERSION` *(undocumented)*
- `NEXT_PUBLIC_SDK_PYTHON_VERSION` *(undocumented)*
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` *(undocumented)*
- `NODE_ENV` *(undocumented)*
- `OIDC_AUTHORIZATION_URL` *(undocumented)*
- `OIDC_CLIENT_ID` *(undocumented)*
- `OIDC_CLIENT_SECRET` *(undocumented)*
- `OIDC_DISPLAY_NAME` *(undocumented)*
- `OIDC_ISSUER_URL` *(undocumented)*
- `OIDC_TOKEN_URL` *(undocumented)*
- `OIDC_USERINFO_URL` *(undocumented)*
- `OPENAI_API_KEY` *(undocumented)*
- `PORT` *(undocumented)*
- `PW_BASE_URL` *(undocumented)*
- `PW_SMOKE_PORT` *(undocumented)*
- `PYTHON` *(undocumented)*
- `PYTHONPATH` *(undocumented)*
- `REALTIME_BACKEND` *(undocumented)*
- `REALTIME_ENFORCE_REDIS` *(undocumented)*
- `REALTIME_MAX_LISTENERS` *(undocumented)*
- `REALTIME_MEMORY_MAX_LISTENERS` *(undocumented)*
- `REALTIME_REDIS_URL` *(undocumented)*
- `REALTIME_REPLAY_MAX_EVENTS` *(undocumented)*
- `REALTIME_REPLAY_WINDOW_SECONDS` *(undocumented)*
- `REDIS_URL` *(undocumented)*
- `RESEND_API_KEY` *(undocumented)*
- `S` *(undocumented)*
- `SELF_GOVERNANCE_SOURCE_URL` *(undocumented)*
- `SERVICE_NAME` *(undocumented)*
- `SQL_CAPTURE_FILE` *(undocumented)*
- `STARTUP_SMOKE_BASE_URL` *(undocumented)*
- `STARTUP_SMOKE_INTERVAL_MS` *(undocumented)*
- `STARTUP_SMOKE_SKIP_CANARY` *(undocumented)*
- `STARTUP_SMOKE_SKIP_CROSS_ORG` *(undocumented)*
- `STARTUP_SMOKE_SKIP_POLICY` *(undocumented)*
- `STARTUP_SMOKE_TIMEOUT_MS` *(undocumented)*
- `STUB_FAIL_CREATES` *(undocumented)*
- `TARGET_ENV` *(undocumented)*
- `TELEGRAM_ADMIN_CHAT_ID` *(undocumented)*
- `TELEGRAM_APPROVER_ORG_ID` *(undocumented)*
- `TELEGRAM_BOT_TOKEN` *(undocumented)*
- `TELEGRAM_WEBHOOK_SECRET` *(undocumented)*
- `TEST_BASE_URL` *(undocumented)*
- `TRUST_PROXY` *(undocumented)*
- `TURNSTILE_SECRET_KEY` *(undocumented)*
- `UPSTASH_REDIS_REST_TOKEN` *(undocumented)*
- `UPSTASH_REDIS_REST_URL` *(undocumented)*
- `VERCEL` *(undocumented)*
- `VERCEL_ENV` *(undocumented)*
- `VERCEL_PROJECT_PRODUCTION_URL` *(undocumented)*
- `VERCEL_URL` *(undocumented)*
- `WEBHOOK_ALLOWED_DOMAINS` *(undocumented)*
- `X` *(undocumented)*

## Database Tables

All 112 tables defined in `schema/schema.js` (Drizzle ORM):

- `action_embeddings`
- `action_records`
- `activity_logs`
- `agent_connections`
- `agent_identities`
- `agent_messages`
- `agent_pairings`
- `agent_presence`
- `agent_schedules`
- `agent_sessions`
- `api_keys`
- `approval_notifications`
- `assumptions`
- `behavior_dismissals`
- `behavior_samples`
- `calendar_events`
- `calibration_proposal_decisions`
- `code_optimal_file_manifests`
- `code_projects`
- `code_session_alerts`
- `code_session_handoffs`
- `code_session_memos`
- `code_session_messages`
- `code_session_signals`
- `code_session_tool_uses`
- `code_sessions`
- `compliance_exports`
- `compliance_schedules`
- `compliance_snapshots`
- `contacts`
- `content`
- `context_entries`
- `context_points`
- `coverage_reports`
- `daily_totals`
- `decisions`
- `drift_alerts`
- `drift_baselines`
- `drift_snapshots`
- `enforcement_liveness_runs`
- `entities`
- `eval_runs`
- `eval_scorers`
- `eval_scores`
- `executions`
- `feedback`
- `goals`
- `governed_secrets`
- `guard_calibration_events`
- `guard_calibration_state`
- `guard_decisions`
- `guard_policies`
- `guardrails_test_runs`
- `health_snapshots`
- `hosted_trial_snapshots`
- `ideas`
- `interactions`
- `jwt_replay_log`
- `learning_curves`
- `learning_episodes`
- `learning_recommendation_events`
- `learning_recommendations`
- `learning_velocity`
- `live_canary_runs`
- `loosening_proposal_decisions`
- `message_threads`
- `milestones`
- `notification_preferences`
- `oauth_access_tokens`
- `oauth_authorization_codes`
- `oauth_clients`
- `open_loops`
- `organizations`
- `posture_findings_state`
- `posture_snapshots`
- `profile_scores`
- `prompt_runs`
- `prompt_templates`
- `prompt_versions`
- `risk_templates`
- `routing_agent_metrics`
- `routing_agents`
- `routing_decisions`
- `routing_tasks`
- `scheduled_jobs`
- `scoring_dimensions`
- `scoring_profiles`
- `server_signing_keys`
- `session_events`
- `shared_docs`
- `skill_scan_results`
- `snippets`
- `tightening_proposal_decisions`
- `token_budgets`
- `token_snapshots`
- `topics`
- `usage_meters`
- `user_approaches`
- `user_moods`
- `user_observations`
- `user_preferences`
- `users`
- `waitlist`
- `webhook_deliveries`
- `webhooks`
- `work_order_receipts`
- `work_order_types`
- `work_orders`
- `workflows`
- `x402_endpoints`
- `x402_providers`
- `x402_purchases`

## Signal Types

These are the `type` strings emitted through `fireWebhooksForOrg` and `deliverNativeNotifications`. Webhooks can subscribe to any subset by putting the type in their `events: [...]` array (or use `['all']` for everything).

- `approval_flood`
- `autonomy_spike`
- `cost_exceeded`
- `green_insufficient`
- `integration_health_changed`
- `integration_mismatch`
- `lost_confirmation`
- `message`
- `observe_mode`
- `stale_action`
- `test`

## Detecting Drift

To check whether this snapshot matches the current codebase:

```bash
python -m livingcode diff
```

If the diff shows changes, this skill is stale — regenerate it.
