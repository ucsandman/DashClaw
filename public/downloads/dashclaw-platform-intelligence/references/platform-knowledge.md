# DashClaw Platform Knowledge

## Table of Contents

- [What DashClaw Is](#what-dashclaw-is)
- [Deployment Modes](#deployment-modes)
- [Tech Stack](#tech-stack)
- [Auth Chain](#auth-chain)
- [ID Prefixes](#id-prefixes)
- [Architectural Guardrails](#architectural-guardrails)
- [Product Surfaces](#product-surfaces)
- [Dashboard Navigation](#dashboard-navigation)
- [CLI and Hooks Layer](#cli-and-hooks-layer)
- [Extension Layer](#extension-layer)
- [Signal Types](#signal-types)
- [Livingcode Shape System](#livingcode-shape-system)
- [Key Reference Files](#key-reference-files)

## What DashClaw Is

AI agent decision infrastructure. A control plane for policy enforcement, decision recording,
assumption tracking, compliance mapping, security signals, messaging, evaluation scoring,
prompt management, behavioral drift detection, learning analytics, scoring profiles, and operator
workflows. The governance layer for AI agent fleets.

**Zero-dependency philosophy**: All features work without any LLM API key by default. The only
optional LLM feature is the `llm_judge` scorer type in the Evaluation Framework.

## Deployment Modes

- **Marketing site** (`DASHCLAW_MODE=demo` + `NEXT_PUBLIC_DASHCLAW_MODE=demo`): dashclaw.io, fake data, no login. All writes return 403.
- **Self-hosted** (`DASHCLAW_MODE=self_host`, the default): real database, GitHub/Google OAuth, API key auth.

Both modes serve the same landing page. `/demo` sets a cookie and redirects to `/dashboard` with fixture data. `/dashboard` in self-host requires login.

## Tech Stack

- Next.js 16 (App Router), JavaScript, Tailwind CSS 3
- Postgres (TCP via `postgres`, serverless via `@neondatabase/serverless`)
- Auth: NextAuth v4 for UI (GitHub, Google, or OIDC), `x-api-key` header for agents/tools
- **Version:** the platform and both SDKs share one version (Node + Python; see `CHANGELOG.md` / `package.json`).
- SDKs:
  - **Node v2 — governance runtime** (`sdk/dashclaw.js`, 126 methods across Core Governance, Scoring, Execution Studio, Messaging, Sessions, and Capability Runtime). This is the SDK that ships as the `dashclaw` package.
  - **Node v1 — DEPRECATED full platform legacy** (`sdk/legacy/dashclaw-v1.js`), re-exported as `dashclaw/legacy` for older integrations; removed in v5.0.0 (see `docs/sdk-parity.md`).
  - **Python — full platform** (`sdk-python/dashclaw/client.py`, 224 methods).
- Node SDK naming: camelCase. Python SDK naming: snake_case.

## Auth Chain

This is the full middleware pipeline -- critical for troubleshooting:

```
Client request hits middleware.js
  |
  +--> Strip x-org-id, x-org-role, x-user-id from inbound headers (ALWAYS)
  |
  +--> Rate limit check (local in-memory or Upstash Redis)
  |     Default: 100 req/min (prod), 1000 req/min (dev)
  |     Override: DASHCLAW_RATE_LIMIT_MAX, DASHCLAW_RATE_LIMIT_WINDOW_MS
  |     Dev bypass: DASHCLAW_DISABLE_RATE_LIMIT=true
  |
  +--> Body size check: 2MB max for POST/PUT/PATCH
  |
  +--> PUBLIC_ROUTES check:
  |     /api/health, /api/setup/status, /api/auth, /api/cron, /api/docs/raw, /api/prompts
  |     These skip auth entirely (but still rate-limited)
  |
  +--> Protected route auth:
        |
        +--> x-api-key header present?
        |     |
        |     +--> Fast path: timing-safe compare against DASHCLAW_API_KEY env var
        |     |     Success: inject x-org-id from DASHCLAW_API_KEY_ORG (default: org_default)
        |     |
        |     +--> Slow path: SHA-256 hash lookup in api_keys table
        |           Success: inject x-org-id + x-org-role from resolved key
        |           Failure: 401 Unauthorized
        |
        +--> No API key?
              |
              +--> Same-origin request (Sec-Fetch-Site: same-origin)?
              |     Resolve NextAuth session token --> orgId + role
              |     Supported: GitHub, Google, OIDC (Authentik, Keycloak, etc.)
              |     org_default users blocked from all APIs except onboarding
              |
              +--> Cross-origin without key --> 401 Unauthorized
```

**First-user-admin rule:** The first user to sign in to a fresh self-hosted instance is auto-promoted to `role=admin` in their org. Subsequent signups land as `role=member` by default. The signIn callback (`app/lib/auth/callbacks.js`) gates this on a settled session — not on bootstrap promotion — so the rule survives OAuth redirect churn. See BUG-03 fix (`707c5636`).

**Action type validation:** `POST /api/actions` now accepts **arbitrary `action_type` strings** from third-party agent frameworks. Validation was intentionally relaxed in `11e0911a` — don't assume an enum.

**Plan quotas:** All plan quotas (API keys, actions/day, agents) were removed (`49d7b69c`, `db6ee6b0`). Open-source instances are unlimited by design.

## ID Prefixes

| Prefix | Entity |
|---|---|
| `sn_` | Snippets |
| `mt_` | Message threads |
| `ct_` | Context threads |
| `oc_live_` / `oc_test_` | API keys |
| `pi_` | Prompt injection scans |
| `org_` | Organizations |
| `gp_` | Guard policies |
| `es_` | Evaluation scorers |
| `sc_` | Evaluation scores |
| `er_` | Evaluation runs |
| `pt_` | Prompt templates |
| `pv_` | Prompt versions |
| `fb_` | Feedback entries |
| `ce_` | Compliance exports |
| `cs_` | Compliance schedules |
| `da_` | Drift alerts |
| `db_` | Drift baselines |
| `ds_` | Drift snapshots |
| `lv_` | Learning velocity records |
| `lc_` | Learning curve records |
| `sp_` | Scoring profiles |
| `sd_` | Scoring dimensions |
| `ps_` | Profile scores |
| `rt_` | Risk templates |
| `sess_` | Sessions |

## Architectural Guardrails

1. **Route SQL guardrail**: No direct SQL in `app/api/**/route.js`. Use repositories in `app/lib/repositories/*.repository.js`. CI enforces via `npm run route-sql:check`.

2. **Real-time first**: DashClaw uses Server-Sent Events (SSE) via `/api/stream` to push updates instantly. Dashboard components use the `useRealtime` hook instead of polling.

3. **Default-deny**: All `/api/*` routes require auth unless listed in `PUBLIC_ROUTES` in middleware.js. New endpoints are protected by default.

4. **Org context injection**: Never accept `x-org-id`, `x-org-role`, `x-user-id` from clients. Middleware strips them and injects trusted values from API key resolution.

5. **Two separate thread systems**:
   - Context threads (`ct_*` via `/api/context/threads`) -- track reasoning and context
   - Message threads (`mt_*` via `/api/messages/threads`) -- inter-agent communication
   - These are NOT interchangeable.

6. **Zero-LLM default**: All features must work without any LLM API key. The only exception is the `llm_judge` scorer type, which gracefully degrades when no provider is configured.

7. **DB patterns**: TEXT primary keys with crypto-random prefixed IDs. `getSql()` for connection, `getOrgId()` for org scoping. Tagged template SQL via Neon's `postgres` driver.

## Product Surfaces

| Path | Purpose |
|---|---|
| `/` | Public landing site |
| `/demo` | Demo sandbox (fake data, read-only, no login) |
| `/connect` | 8-minute "first governed action" onboarding (MCP + agent bootstrap paths) |
| `/setup` | Readiness verification and instance health |
| `/mission-control` | Strategic fleet overview (reactive timeline + live log) |
| `/widget` | Installable PWA status widget — chrome-free glanceable cockpit: overall posture, key counts, top signal, live recent-action log, and inline Approve/Deny for pending approvals (resolves via `/api/approvals`, clears across all channels; always-on-top-ready; backed by `GET /api/widget/summary`) |
| `/dashboard` | Draggable widget dashboard (real-time reactive cards) |
| `/workspace` | Per-agent workspace (digest, context, handoffs, snippets, preferences, memory) |
| `/approve` | Mobile PWA approval surface (optimized for on-call operator on phone) |
| `/approvals` | Desktop approval queue |
| `/decisions` | Visual causal chain ledger with inline message trails in expanded rows |
| `/decisions/{actionId}` | Chronological decision timeline (guard decisions, messages, assumptions, actions, outcomes, open loops) |
| `/agents` | Fleet roster (presence, health, recent actions) |
| `/agents/{agentId}` | Agent governance profile — vitals strip, trust posture, policies, decisions, assumptions, signals |
| `/policies` | Shields-first policy builder (ActivityTab + CustomTab, AI generator inline, agent-scope picker, risk explainer) |
| `/policies/generate` | AI policy generator standalone page |
| `/security` | Security dashboard (signals, guard decisions, findings) |
| `/posture` | Governance posture score (score hero + 6 dimension cards + remediation queue + resolve modal + risk-accepted ledger). Gaming-resistant: score only rises from active, proven-to-fire policies; drafting never raises it. |
| `/analytics` | Cost + action analytics (hero stats, cost trend, action volume, breakdowns, token usage) |
| `/activity` | Raw activity log |
| `/compliance` | Compliance mapping (framework controls, gap analysis, evidence, reports) |
| `/compliance/exports` | Compliance export generation, scheduling, downloads |
| `/evaluations` | Evaluation framework (scorers, scores, runs, quality tracking) |
| `/prompts` | Prompt registry (templates, versions, rendering, usage stats) |
| `/drift` | Drift detection (baselines, alerts, severity, trends) |
| `/learning` | Learning loop (episodes, recommendations) |
| `/learning/analytics` | Learning analytics (velocity, maturity, curves, summary) |
| `/scoring` | Scoring profiles and dimensions |
| `/sessions` | Session Lifecycle dashboard (active sessions, stall detection, recovery) |
| `/capabilities` | Capability registry (edit/delete inline, invoke, test, health) |
| `/integrations` | Integrations health |
| `/webhooks` | Outbound webhook configuration and delivery history |
| `/identities` | Agent identity binding with approval confirmation and permission levels |
| `/api-keys` | API key management |
| `/spend` | FinOps Spend overview (Fleet lens — agent LLM cost + x402 capability spend) |
| `/spend/x402` | x402 purchases — governed capability spend records (provider registry + purchase ledger) |
| `/spend/code` | Your Claude Code spend (advisory) |

## Dashboard Navigation

The left sidebar is organized into five groups (`app/components/Sidebar.js`). **Labs** starts collapsed by default to keep the sidebar calm; state persists via `sessionStorage`.

| Group | Items |
|---|---|
| **Govern** | Mission Control, Decisions, Approvals, Policies, Posture, Fleet |
| **Observe** | Security, Analytics, Activity, Compliance |
| **Spend** | Overview, Purchases, Your Claude Code |
| **Configure** | API Keys, Integrations, Webhooks, Identities, Settings |
| **Labs** *(collapsible)* | Assumptions, Sessions, Drift, Learning, Quality, Prompts, Workflows, Model Strategies, Knowledge, Capabilities |

## CLI and Hooks Layer

**CLI (`@dashclaw/cli`)**: Terminal client installed via `npm install -g @dashclaw/cli` (see `cli/`). Commands:
- `dashclaw approvals` — interactive inbox (arrow keys, `A`/`D`/`O`/`Q`)
- `dashclaw approve <actionId> [--reason ...]`
- `dashclaw deny <actionId> [--reason ...]`
- `dashclaw doctor [--json] [--no-fix] [--category ...]` — diagnoses instance and auto-fixes safe issues by invoking `/api/doctor` and `/api/doctor/fix`
- `dashclaw logout` — removes saved config

Config resolution order:
1. Env vars (`DASHCLAW_BASE_URL`, `DASHCLAW_API_KEY`, optional `DASHCLAW_AGENT_ID`)
2. `~/.dashclaw/config.json` (mode `600`, persisted after interactive prompt)
3. Interactive first-run prompt

Approvals use `POST /api/actions/:id/approve`; real-time sync via Redis SSE.

**Claude Code Hooks (`hooks/`)**: Three Python scripts for `PreToolUse`, `PostToolUse`, and `Stop` lifecycle events. Require only stdlib, no pip installs. Governed tools: Bash, Edit, Write, MultiEdit, sub-agent spawns (Agent/Task), and MCP tool calls (`mcp__*`) — so connector sends like Gmail/Stripe/Calendar are governed too. Safe to install even without DashClaw configured (silent no-op when env vars are missing). `dashclaw_pretool` records blocked actions on `handle_block` so the audit trail captures policy denials (BUG-02 fix).

**SDK terminal output**: The Node SDK's `waitForApproval()` method prints a structured approval block to stdout before blocking. The block includes the action ID, policy name, risk score, declared goal, and the replay URL.

**Approval sync architecture**: Browser, CLI, mobile `/approve` PWA, and SDK polling all converge at `POST /api/actions/:id/approve`. The API commits to Neon Postgres, publishes `action.updated` to the Redis stream, and every connected SSE listener receives the decision within the SSE heartbeat window (~1 second).

**DashClaw Doctor (`npm run doctor` + `/api/doctor`)**: Self-host diagnostic and auto-fix engine. Runs check modules for database schema, configuration, auth, deployment, SDK reachability, and governance staleness. Local mode (`npm run doctor`) handles filesystem-level fixes — e.g., writing env vars to `.env` (always backing up), generating secrets, CORS config, seeding a default policy, running DB migrations. API endpoints (`GET /api/doctor`, `POST /api/doctor/fix`) are used by the CLI and by CI pipelines. Check modules and constants are emitted from the livingcode shape (see `app/lib/doctor/generated/checks-from-shape.mjs`).

## Extension Layer

These are optional packages published alongside the core runtime.

**`@dashclaw/mcp-server`** (`mcp-server/`): Model Context Protocol server exposing governance as MCP tools and resources. Two transports:
- **stdio binary** — `npx @dashclaw/mcp-server --url ... --key ...` (Claude Desktop, Claude Code, MCP Inspector)
- **Streamable HTTP** — `POST /api/mcp` on the DashClaw instance itself

**29 tools across 10 groups:**
- *Core governance (8):* `dashclaw_guard`, `dashclaw_record`, `dashclaw_invoke`, `dashclaw_capabilities_list`, `dashclaw_policies_list`, `dashclaw_wait_for_approval`, `dashclaw_session_start`, `dashclaw_session_end`.
- *Optimal files (2):* `dashclaw_optimal_files_preview`, `dashclaw_optimal_files_manifest`.
- *Session continuity (3):* `dashclaw_handoff_create`, `dashclaw_handoff_latest`, `dashclaw_handoff_consume`.
- *Credential hygiene (3):* `dashclaw_secret_list`, `dashclaw_secret_due`, `dashclaw_secret_mark_rotated`.
- *Skill safety (1):* `dashclaw_skill_scan`.
- *Open loops (3):* `dashclaw_loop_add`, `dashclaw_loop_list`, `dashclaw_loop_close`.
- *Learning + retrospection (4):* `dashclaw_learning_log`, `dashclaw_learning_query`, `dashclaw_decisions_recent`, `dashclaw_assumption_record` — record an assumption an action rests on (validate/refute later).
- *Agent inbox (2):* `dashclaw_inbox_list`, `dashclaw_messages_mark_read`.
- *Behavior learning (1):* `dashclaw_behavior_suggestions` — observe-only Policy Coach suggestions from recorded behavior.
- *Governance posture (2, read-only):* `dashclaw_posture`, `dashclaw_posture_next` — org governance posture score + 6 dimensions + prioritized findings; read-only (remediation is human-gated).

**6 resources:** `dashclaw://policies`, `dashclaw://capabilities`, `dashclaw://agent/{agent_id}/history`, `dashclaw://status`, `dashclaw://code-sessions/projects`, `dashclaw://code-sessions/sessions/{session_id}`.

Route inventory for tools is emitted from the shape to `mcp-server/lib/routes-inventory.generated.json` — keep tools and routes in sync.

**`@dashclaw/openclaw-plugin`** (`packages/openclaw-plugin/`, v1.2.1): Governance plugin for the OpenClaw agent framework. Intercepts lifecycle hooks (`before_tool_call` / `after_tool_call`), calls `guard` / `createAction` / `waitForApproval` / `updateOutcome` automatically, and installs the HOOK.md pack via the openclaw CLI. Tool classification vocabulary aligns with DashClaw's guard action types. Ships with regression tests for `handle_block` audit-trail behavior. As of v1.2.1, the plugin also hooks `llm_output` and `agent_end` to attribute LLM token usage (with cache_read tokens weighted at 0.1×) back to each tool call via PATCH on `tokens_in`/`tokens_out`/`model` — DashClaw derives `cost_estimate` server-side.

**`@dashclaw/governance` skill** (`public/downloads/dashclaw-governance/`): Companion Anthropic Claude skill that teaches governed agents the protocol (guard-before-act, decision handling, recording rules, session lifecycle). Loads org-specific policies and capabilities from MCP resources at session start. Designed to pair with `@dashclaw/mcp-server` in Managed Agents. See `public/downloads/dashclaw-governance/SKILL.md`.

**Managed Agents integration**: The `examples/managed-agent-*` scripts show how to register a governed Managed Agent via the Anthropic API with the governance skill attached. The `scripts/setup-agents.ts` pattern creates an environment via the Managed Agents API and writes `ANTHROPIC_ENVIRONMENT_ID` back to `.env`.

## Signal Types

DashClaw emits 11 signal types. All are evaluated server-side without an LLM.

| Signal Type | Trigger |
|---|---|
| `guard_block` | Guard policy returned `block` decision |
| `guard_warn` | Guard policy returned `warn` decision |
| `approval_timeout` | Pending approval expired without response |
| `loop_stale` | Open loop exceeded expected resolution time |
| `injection_detected` | Prompt injection scan flagged content |
| `drift_alert` | Behavioral drift z-score exceeded threshold |
| `feedback_negative` | User submitted negative feedback |
| `session_stalled` | Session had no activity beyond idle threshold |
| `branch_stale` | Working branch fell N+ commits behind main |
| `mcp_degraded` | MCP tool handshake failed or connection dropped |
| `green_insufficient` | Test suite did not meet required green level for action |

Session lifecycle, signal emission, and recovery workflows all operate without an LLM provider configured. They use rule-based evaluation and threshold checks only.

## Livingcode Shape System

`livingcode/` is a Python package that models the DashClaw repo as a **shape** — a structured JSON snapshot of routes, env vars, tables, schema, and other derived facts. It produces drift-free derivative artifacts so docs, skills, MCP inventories, and doctor checks never go stale relative to code.

**Commands:**

```bash
python -m livingcode query summary       # high-level counts
python -m livingcode query routes        # current API surface
python -m livingcode query env           # current env vars
python -m livingcode query tables        # current schema
python -m livingcode query all --json    # full machine-readable shape
python -m livingcode diff                # compare snapshot to current repo
python -m livingcode emit shape-json --output ...
python -m livingcode emit skill --output ...
python -m livingcode emit doctor-checks --output ...
python -m livingcode emit mcp-tools --output ...
```

**Fallback when livingcode/Python/the repo are unavailable** (e.g. OpenClaw or the Claude app): these commands only run where the livingcode package and a repo checkout are present. Otherwise, in order: (1) `GET {baseUrl}/api/doctor` for live route/shape health — requires the workspace API key (`x-api-key: <key>`), returns 401/403 without it; (2) read the committed static shape `app/lib/doctor/generated/shape.json` plus `docs/api-inventory.json` if a checkout is reachable; (3) otherwise treat the snapshot in the generated SKILL.md as authoritative.

**Refresh orchestrator:** `scripts/livingcode-refresh.mjs` (run via `npm run livingcode:refresh`) re-emits every derivative artifact and is invoked automatically by the pre-commit hook when staged changes touch `app/api/`, `app/lib/`, `schema/schema.js`, `middleware.js`, or `livingcode/`. Outputs:

- `app/lib/doctor/generated/shape.json` (committed; read at runtime by JS)
- `app/lib/doctor/generated/last-snapshot.json` (drift-check baseline)
- `app/lib/doctor/generated/checks-from-shape.mjs` (generated doctor checks)
- `mcp-server/lib/routes-inventory.generated.json`
- `public/downloads/dashclaw-platform-intelligence/SKILL.md` (website download)
- `public/downloads/dashclaw-platform-intelligence.zip(.manifest)?`
- `~/.claude/skills/dashclaw-platform-intelligence/SKILL.md` (global skill)

**Idempotence:** The shape-json emitter substitutes a content-hash signature for the wall-clock timestamp, so re-runs produce byte-identical output. The zip is only rebuilt when the manifest hash disagrees with the skill directory contents.

**Do not hand-edit generated artifacts.** The pre-commit hook will overwrite them. Regenerate instead.

**Drift guard:** The doctor includes a drift check that compares `last-snapshot.json` with the current shape. If they disagree, `npm run doctor` reports `drift_detected` and suggests `npm run livingcode:refresh`.

## Key Reference Files

When you need current data from the codebase, read these:

| What | File |
|---|---|
| Full route inventory | `docs/api-inventory.json` / `docs/api-inventory.md` |
| OpenAPI spec (stable) | `docs/openapi/critical-stable.openapi.json` |
| SDK parity matrix | `docs/sdk-parity.md` |
| SDK README (copy-as-markdown source) | `sdk/README.md` |
| Node v2 SDK source | `sdk/dashclaw.js` |
| Node v1 legacy SDK source (DEPRECATED) | `sdk/legacy/dashclaw-v1.js` |
| Python SDK source | `sdk-python/dashclaw/client.py` |
| Middleware (auth chain) | `middleware.js` |
| Sidebar navigation | `app/components/Sidebar.js` |
| Demo fixtures | `app/lib/demo/demoFixtures.js` |
| Repository modules | `app/lib/repositories/*.repository.js` |
| Client setup guide | `docs/client-setup-guide.md` |
| Agent bootstrap guide | `docs/agent-bootstrap.md` |
| Design context (anti-refs, tiebreakers) | `.impeccable.md` |
| Project architecture | `PROJECT_DETAILS.md` |
| Changelog (platform releases) | `CHANGELOG.md` |
| Cross-SDK test harness | `docs/sdk-critical-contract-harness.json` |
| Eval engine | `app/lib/eval.js` |
| Prompt engine | `app/lib/prompt.js` |
| Feedback engine | `app/lib/feedback.js` |
| Compliance exporter | `app/lib/compliance/exporter.js` |
| Drift engine | `app/lib/drift.js` |
| Learning analytics | `app/lib/learningAnalytics.js` |
| Scoring profiles engine | `app/lib/scoringProfiles.js` |
| LLM abstraction (optional) | `app/lib/llm.js` |
| Doctor engine | `app/lib/doctor/` (+ generated `app/lib/doctor/generated/`) |
| CLI entrypoint | `cli/bin/dashclaw.js` |
| CLI doctor formatter | `cli/lib/doctor.js` |
| MCP server (stdio + HTTP) | `mcp-server/` (README at `mcp-server/README.md`) |
| OpenClaw plugin | `packages/openclaw-plugin/` |
| Governance skill (companion) | `public/downloads/dashclaw-governance/SKILL.md` |
| Livingcode package | `livingcode/` (README at `livingcode/README.md`) |
| Refresh orchestrator | `scripts/livingcode-refresh.mjs` |
| Shape snapshot history | `.organism/shape-snapshots/` |
