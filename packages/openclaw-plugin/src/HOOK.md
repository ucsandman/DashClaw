---
name: dashclaw-governance
description: Policy enforcement, human-in-the-loop approval, and decision recording for every OpenClaw tool call. Powered by DashClaw.
version: 1.5.0
---

# DashClaw Governance Hook

Intercepts every OpenClaw tool call through a four-step governance loop:

1. **Guard** — `before_tool_call` sends the tool name, risk score, and a 500-character parameter summary to DashClaw `/api/guard`. Policies decide `allow`, `warn`, `block`, or `require_approval`.
2. **Record** — On `allow`/`warn`/`require_approval`, the hook opens a governance record via `/api/actions`. The server is authoritative — it may upgrade an `allow` decision to `pending_approval` for capabilities that require human review.
3. **Wait** — For `pending_approval` actions, the hook calls `waitForApproval(action_id)` using the **action_records ID from step 2**, not the `guard_decisions` ID from step 1. Operators approve from the DashClaw dashboard, CLI, or mobile PWA. The wait is bounded by `approvalWaitMs` (default 60s — under Codex's ~90s per-tool-call RPC watchdog); on timeout the call blocks with a retry hint while the approval stays open ~300s server-side, so approving late and retrying the same call still works.
4. **Outcome** — `after_tool_call` records `completed` or `failed` with the error message, giving DashClaw a full intent → policy → outcome trail.

On the first tool call of a run the plugin also opens a DashClaw **Agent Session** (`POST /api/sessions`), and closes it (`PATCH /api/sessions/:id` → `status: completed`) on `agent_end`, so each OpenClaw run appears under the Agent Sessions feature. Session calls are fully fail-safe — a session error never blocks a tool call or the run.

The hook never modifies tool parameters or results. It only blocks, allows, waits, or records.

## Configuration

The plugin accepts three interchangeable configuration shapes — pick whichever fits your deployment:

1. **Canonical plugin-config keys** (recommended for `openclaw.plugin.json`): `dashclawUrl` + `dashclawApiKey`.
2. **SDK-style aliases** (matches the DashClaw Node SDK): `baseUrl` + `apiKey`.
3. **Environment variables** (recommended when secrets live outside the gateway config): `DASHCLAW_BASE_URL` (or legacy `DASHCLAW_URL`) + `DASHCLAW_API_KEY`.

Precedence is `plugin config > env vars`. If env vars are set before the gateway starts, the plugin config can omit URL and API key entirely.

See the `configSchema` section in `openclaw.plugin.json` for the full list of optional fields (`agentId`, `failClosed`, `riskScoreDefault`, `highRiskTools`, `approvalWaitMs`).

## Failure modes

- If `createAction` fails and `failClosed=true` (default), the tool call is blocked with a clear reason.
- If `failClosed=false`, the tool call proceeds ungoverned with a warning in the console.
- If the guard verdict is `block`, no action record is opened — the tool call is hard-stopped and no governance row is created.

## See also

- Canonical HITL flow: `sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow
- Plugin source: `src/index.ts`
- Config schema: `openclaw.plugin.json`
