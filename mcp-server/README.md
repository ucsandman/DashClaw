# @dashclaw/mcp-server

MCP server for [DashClaw](https://github.com/ucsandman/DashClaw) governance **and governed execution**. Exposes 32 governance tools and 6 read-only resources over [Model Context Protocol](https://modelcontextprotocol.io/), plus governed provider-execution tools (GitHub, Vercel, Neon, Stripe, and ten more — each provider's tools register only when its credential is present), project/policy context tools, and stateful [launch plans](./docs/launch-plans.md). Works with Claude Code, Claude Desktop, Claude Managed Agents, and any MCP-compatible client.

Every provider action runs through one guarded path: local policy × the DashClaw gate × human approvals × an audit trail. Reads are allowed by default and audited; writes, deploys, env changes, live-mode and destructive actions are policy-gated and fail closed when DashClaw is configured but unreachable.

## Quick Start

### Claude Desktop / Claude Code (stdio)

```bash
npx -y @dashclaw/mcp-server --url https://your-dashclaw.vercel.app --key oc_live_xxx --agent-id claude-desktop
```

Or add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["-y", "@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-dashclaw.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_xxx",
        "DASHCLAW_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

**About `DASHCLAW_AGENT_ID`:** this is the name that shows up on `/fleet`, `/decisions`, and every other governance surface. If you omit it, the server auto-derives an `agent_id` from the MCP protocol's `clientInfo.name` (e.g. `claude-ai` for Claude Desktop, `cursor-vscode` for Cursor) so calls don't silently commingle with other agents — but a human-friendly name like `claude-desktop` is what you actually want for dashboard readability. Explicit configuration always wins over auto-derivation.

### Claude Managed Agents (Streamable HTTP)

If you're running DashClaw, the MCP endpoint is built in at `/api/mcp`:

```python
agent = client.beta.agents.create(
    name="Governed Agent",
    model="claude-sonnet-4-6",
    tools=[{"type": "agent_toolset_20260401"}],
    mcp_servers=[{
        "type": "url",
        "url": "https://your-dashclaw.vercel.app/api/mcp",
        "headers": {"x-api-key": "oc_live_xxx"},
        "name": "dashclaw"
    }],
)
```

### Claude Desktop (one-click .mcpb)

Build the bundle from the DashClaw repo root (the build script ships in the repo, not the npm package), then install it without touching `claude_desktop_config.json`:

```bash
node scripts/build-mcpb.mjs    # → dist/dashclaw.mcpb
```

Then double-click `dist/dashclaw.mcpb` (or Settings → Extensions → Install Extension…).
The installer prompts for your instance URL, API key, and an agent ID
(default `claude-desktop`). The 32 governance tools then appear in Claude.

> **Cowork caveat:** Cowork tool availability runs through its VM, and the host `.mcpb` install path is unverified for Cowork. The OAuth remote connector (below) is the verified cross-surface path.

### Claude custom connector (remote, OAuth)

Self-hosted DashClaw is addable as a Claude **custom connector** with no API key
in the UI — Claude's connector flow requires OAuth, not headers:

1. In Claude: Settings → Connectors → Add custom connector.
2. Paste `https://<your-instance>/api/mcp`.
3. Claude discovers `/.well-known/oauth-protected-resource`, registers via DCR,
   and opens your DashClaw login + a consent screen.
4. Authorize → the 32 governance tools appear, scoped to your workspace.

Works on Free/Pro/Max/Team/Enterprise (Free is capped at one custom connector).
The legacy `x-api-key` path (Managed Agents) is unchanged.

### Plugin (skills) via marketplace

To also load the DashClaw **skills** (governance protocol + platform intelligence)
in the Claude app: Customize → Plugins → "+" → Add marketplace →
`github: ucsandman/DashClaw`, then install the `dashclaw` plugin.

## Tools (32)

Grouped by domain. See [`src/tools.ts`](./src/tools.ts) for the canonical definitions.

**Core governance (8)** — the guard / record / invoke loop plus discovery and session lifecycle.

| Tool | Description |
|---|---|
| `dashclaw_guard` | Evaluate policies before risky actions |
| `dashclaw_record` | Log actions to audit trail |
| `dashclaw_invoke` | Execute governed capabilities (guard + run + record) |
| `dashclaw_capabilities_list` | Discover available APIs |
| `dashclaw_policies_list` | See active governance policies |
| `dashclaw_wait_for_approval` | Block until a human resolves an approval |
| `dashclaw_session_start` | Register agent session |
| `dashclaw_session_end` | Close agent session |

> **Session linkage:** after `dashclaw_session_start`, the server auto-stamps that session's id onto every `dashclaw_record` in the same connection (stdio). Pass `session_id` on `dashclaw_record` to override, or to attribute explicitly on the HTTP transport (`POST /api/mcp`), where each request is stateless.

**Optimal files (2)** — Code Sessions optimizer output (root CLAUDE.md, path-scoped rules, hooks, skill packs).

| Tool | Description |
|---|---|
| `dashclaw_optimal_files_preview` | Preview optimizer output for a session |
| `dashclaw_optimal_files_manifest` | Generate optimal-files manifest |

**Session continuity (3)** — agent-runtime handoff bundle for the next session.

| Tool | Description |
|---|---|
| `dashclaw_handoff_create` | Write handoff bundle for next session |
| `dashclaw_handoff_latest` | Fetch latest unconsumed handoff |
| `dashclaw_handoff_consume` | Mark handoff consumed (idempotent) |

**Credential hygiene (3)** — check rotation due-dates before acting on tracked credentials.

| Tool | Description |
|---|---|
| `dashclaw_secret_list` | List tracked secrets (metadata only) |
| `dashclaw_secret_due` | Secrets coming due for rotation |
| `dashclaw_secret_mark_rotated` | Mark secret rotated (operator-confirmed) |

**Skill safety (1)** — static safety scan of untrusted skill files; results cached by content hash.

| Tool | Description |
|---|---|
| `dashclaw_skill_scan` | Scan skill files for unsafe patterns |

**Open loops (3)** — action-scoped commitments ("I will X later" tracker).

| Tool | Description |
|---|---|
| `dashclaw_loop_add` | Register action-scoped commitment |
| `dashclaw_loop_list` | List open/resolved loops |
| `dashclaw_loop_close` | Resolve an open loop |

**Learning + retrospection (4)** — record assumptions; log and query non-obvious decisions; recent governed-action ledger.

| Tool | Description |
|---|---|
| `dashclaw_assumption_record` | Record an unverified assumption underpinning an action |
| `dashclaw_learning_log` | Log non-obvious decision + outcome |
| `dashclaw_learning_query` | Query prior decisions/lessons |
| `dashclaw_decisions_recent` | Recent governed-action ledger |

**Agent inbox (2)** — read this agent's DashClaw inbox + mark messages read.

| Tool | Description |
|---|---|
| `dashclaw_inbox_list` | List inbox messages + unread count |
| `dashclaw_messages_mark_read` | Mark inbox messages read |

**Agent identity (1)** — operator-approved pairing of an unidentified agent to a registered identity.

| Tool | Description |
|---|---|
| `dashclaw_pair` | Enroll agent identity: keypair locally, public key to /api/pairings |

**Behavior learning (1)** — observe-only Policy Coach suggestions learned from this agent's recorded behavior.

| Tool | Description |
|---|---|
| `dashclaw_behavior_suggestions` | List observe-only Policy Coach suggestions learned from this agent's recorded behavior |

**Governance posture (2)** — read the org governance posture score + remediation queue (read-only).

| Tool | Description |
|---|---|
| `dashclaw_posture` | Read the org governance posture score + 6 dimensions + findings queue |
| `dashclaw_posture_next` | The next prioritized remediation finding from the posture queue |

**Work orders (2)** — submit a typed, budget-capped work order and check its status + receipt.

| Tool | Description |
|---|---|
| `dashclaw_work_order_submit` | Submit a typed, budget-capped, guard-gated work order; returns work_order_id + status + guard decision |
| `dashclaw_work_order_status` | Check a work order: lifecycle status, worker, guard decision, and (when terminal) the self-verifying receipt |

## Governed execution (provider + context tools)

Beyond the governance set above, the server registers the governed-execution
surface from [`src/tools/index.ts`](./src/tools/index.ts):

**Conditional registration** — a provider's tools register at startup **only
when its credential env var(s) are present** (default names below, or a stored
connection's custom env var). No token → tools absent, which keeps a
connecting agent's context lean. The governance set registers only when
`DASHCLAW_URL` **and** `DASHCLAW_API_KEY` are both set. Project/context tools
always register (they need no credentials).

**Always registered (project context, policy, approvals, audit):**
`list_projects`, `create_project`, `select_project`, `get_project_context`,
`export_context`, `add_environment`, `list_environments`,
`map_provider_resource`, `list_provider_mappings`, `get_provider_mapping`,
`list_connections`, `create_connection`, `set_app_env_vars`, `check_policy`,
`simulate_action`, `list_policy_rules`, `set_policy_rule`,
`list_pending_approvals`, `approve_action`, `reject_action`, `doctor`,
`read_project_memory`, `write_project_memory`, `list_audit_log`,
`export_audit_log`, `explain_action_risk`, `governed_action_summary`,
`get_app_logs`, `get_latest_deployment_logs`. (`dashclaw_status`,
`dashclaw_recent_decisions`, `export_dashclaw_evidence` gate on the DashClaw
credentials like the governance set.)

**Per provider (token env var → tools):**

| Provider | Credential | Tools |
|---|---|---|
| GitHub | `GITHUB_TOKEN` | `get_github_repo_context`, `get_github_repo_readme`, `list_github_repo_files`, `list_github_pull_requests`, `list_github_branches`, `get_github_status_checks`, `list_github_workflow_runs`, `list_github_workflow_jobs`, `rerun_github_workflow_run`, `cancel_github_workflow_run` |
| Vercel | `VERCEL_TOKEN` | `get_vercel_project_context`, `get_vercel_deployments`, `get_vercel_deployment_status`, `get_vercel_deployment_logs`, `get_vercel_logs`, `set_vercel_env_var`, `create_vercel_project`, `add_vercel_domain`, `create_vercel_deployment` |
| Supabase | `SUPABASE_ACCESS_TOKEN` | `list_supabase_projects`, `get_supabase_project_context`, `query_supabase`, `get_supabase_logs`, `apply_supabase_migration` |
| Stripe | `STRIPE_TEST_SECRET_KEY` / `STRIPE_LIVE_SECRET_KEY` | `list_stripe_products`, `list_stripe_customers`, `list_stripe_subscriptions`, `list_stripe_invoices`, `create_stripe_product`, `create_stripe_price`, `create_stripe_webhook`, `list_stripe_webhooks` |
| Railway | `RAILWAY_TOKEN` | `get_railway_project_context`, `discover_railway_resources`, `get_railway_deployments`, `get_railway_logs`, `create_railway_deployment`, `set_railway_env_var` |
| Namecheap | `NAMECHEAP_API_KEY` | `check_domain_availability`, `list_namecheap_domains`, `purchase_domain`, `get_dns_records`, `set_dns_records` |
| Neon | `NEON_API_KEY` | `list_neon_projects`, `create_neon_project`, `get_neon_connection_uri` |
| Upstash | `UPSTASH_API_KEY` | `list_upstash_redis_databases`, `create_upstash_redis_database`, `get_upstash_redis_env`, `get_upstash_qstash_env`, `list_upstash_qstash_schedules`, `create_upstash_qstash_schedule` |
| Cloudflare R2 | `CLOUDFLARE_API_TOKEN` | `list_cloudflare_r2_buckets`, `create_cloudflare_r2_bucket`, `get_cloudflare_r2_env`, `list_cloudflare_r2_objects` |
| Sentry | `SENTRY_AUTH_TOKEN` | `list_sentry_projects`, `create_sentry_project`, `list_sentry_client_keys`, `create_sentry_client_key`, `list_sentry_releases`, `create_sentry_release`, `list_sentry_deploys`, `create_sentry_deploy` |
| PostHog | `POSTHOG_PERSONAL_API_KEY` | `list_posthog_projects`, `create_posthog_project`, `get_posthog_project_env`, `list_posthog_feature_flags`, `create_posthog_feature_flag` |
| Clerk | `CLERK_SECRET_KEY` | `get_clerk_app_env`, `list_clerk_users`, `list_clerk_domains`, `list_clerk_redirect_urls`, `create_clerk_redirect_url` |
| Resend | `RESEND_API_KEY` | `list_resend_domains`, `create_resend_domain`, `verify_resend_domain`, `send_resend_email` |
| Twilio | `TWILIO_AUTH_TOKEN` | `list_twilio_phone_numbers`, `update_twilio_phone_number_webhooks`, `send_twilio_sms`, `create_twilio_call` |

Tokens are read from the environment at call time and **never** written to
local state, audit, or DashClaw context. Secret-shaped provider responses
(connection URIs, webhook signing secrets, REST tokens, DSNs) are shown once
in the tool result and redacted everywhere else.

## Launch plans

Stateful, verified launch tracking through the existing guarded tools — plans
track the launch tail (domain → DNS → deploy → DB → Stripe → email → env
wiring); they never execute provider mutations and never bypass
guard/policy/approvals. Full lifecycle, reality-check table, and examples in
[`docs/launch-plans.md`](./docs/launch-plans.md).

| Tool | Description |
|---|---|
| `create_launch_plan` | Derive the ordered step checklist for a declared stack from the launch playbook |
| `get_launch_status` | Evaluated (never self-reported) step status + the single next action; resumable |
| `preflight_launch` | Tokens present + valid, mappings complete, Stripe mode sanity, Namecheap IP whitelist |
| `verify_launch` | Domain resolves, deployment READY, env vars present, webhook enabled, email verified |

## Resources (6)

| URI | Description |
|---|---|
| `dashclaw://policies` | Active policy set |
| `dashclaw://capabilities` | Available capabilities and health |
| `dashclaw://agent/{agent_id}/history` | Recent action history (last 50) |
| `dashclaw://status` | Instance health + operational metrics |
| `dashclaw://code-sessions/projects` | Claude Code projects with ingested session data and per-project rollups |
| `dashclaw://code-sessions/sessions/{session_id}` | Full detail for one ingested Code Session (session, messages, tool uses) |

## Configuration

Set these in your MCP client's `env` block (preferred — scoped to the server
process, invisible to your terminals) or your shell. The annotated template
lives in [`.env.example`](./.env.example).

| CLI Arg | Env Var | Default | Description |
|---|---|---|---|
| `--url` | `DASHCLAW_URL` | `http://localhost:3000` | DashClaw instance URL — with `DASHCLAW_API_KEY`, enables the governance tool set |
| `--key` | `DASHCLAW_API_KEY` | (empty) | API key (`oc_live_` prefix) |
| `--agent-id` | `DASHCLAW_AGENT_ID` | (empty) | Default agent ID (auto-derived from MCP `clientInfo.name` when empty) |
| | `DASHCLAW_MODE` | `authoritative` | DashClaw gate mode (only `authoritative` is supported) |
| | `DASHCLAW_LOCAL_HOME` | `<cwd>/.dashclaw-local` | Where local state lives (see Storage below) |
| | `DASHCLAW_TIMEOUT_MS` | `30000` | DashClaw API request timeout |
| | `DASHCLAW_HTTP_TIMEOUT_MS` | `30000` | Provider API request timeout |
| | `DASHCLAW_HTTP_RETRIES` | `2` | Retries for idempotent provider reads (429/5xx/network) |
| | `DASHCLAW_HTTP_RETRY_BASE_MS` | `25` | Retry backoff base |
| | `DASHCLAW_LOCK_STALE_MS` | `30000` | Stale file-lock threshold for local state files |
| | `DASHCLAW_LOG_STARTUP` | `false` | Structured CLI startup logs to stderr |
| | `DASHCLAW_MEMORY_MAX_ENTRIES` | (unlimited) | Cap retained project-memory entries |
| | `DASHCLAW_AUDIT_MAX_ENTRIES` | (unlimited) | Cap retained audit entries |
| | provider tokens | (empty) | See the per-provider table above — presence enables that provider's tools |

CLI args take precedence over environment variables.

> **Note:** This server reads `DASHCLAW_URL` (not `DASHCLAW_BASE_URL`); the hooks and CLI in the DashClaw repo read `DASHCLAW_BASE_URL`.

## CLI

The same binary doubles as an operational CLI — `dashclaw-mcp <subcommand>`:
`init`, `project`, `select`, `env`, `connection`, `map`, `doctor`,
`simulate`, `audit`, `snapshot`, `dashclaw`, `context`. Bare `dashclaw-mcp`
(or any `--url`/`--key`/`--agent-id` flags) boots the stdio MCP server.
`dashclaw-mcp doctor --json` is the fastest way to check credentials and
mappings; `dashclaw-mcp context` prints the production-context summary.

## Storage

Local-first state under **`.dashclaw-local/`** in the working directory
(override with `DASHCLAW_LOCAL_HOME`). Plain JSON — human-readable,
diffable, zero native dependencies:

| File | Holds |
|---|---|
| `state.json` | Workspaces, projects, environments, connections, mappings, policy rules, pending approvals |
| `memory.json` | Project memory entries |
| `audit.log` | Append-only JSONL audit trail of every guarded action |
| `config.yaml` | Optional seed config (`dashclaw-mcp init`; template at [`docs/config.example.yaml`](./docs/config.example.yaml)) |
| `launches/<id>.json` | Launch plans (see [`docs/launch-plans.md`](./docs/launch-plans.md)) |

Secrets are never written here — tokens stay in the environment, read at call
time.

## License

[Apache-2.0](./LICENSE). This package incorporates code from an upstream
Apache-2.0 project — see [`NOTICE`](./NOTICE) for the attribution.

## Releasing

After bumping `version` in `mcp-server/package.json`, run from the repo root:

```bash
npm run release:mcp
```

One command does everything, and re-running is always safe (already-published steps are skipped):

1. Syncs `server.json` versions to `package.json` (commit the change if it edits the file).
2. Publishes to npm — your browser opens for the security-key 2FA prompt.
3. Publishes to the official MCP Registry via `mcp-publisher` — if the saved GitHub token expired, it re-runs the device-flow login (enter the printed code at github.com/login/device) and retries.

Prereqs (one-time): `npm login`, and the official `mcp-publisher` binary from [modelcontextprotocol/registry releases](https://github.com/modelcontextprotocol/registry/releases) — **never** `npm i -g mcp-publisher`, that name is squatted by an unrelated package.
