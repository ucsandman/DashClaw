---
name: dashclaw-governance
description: Policy checks, remote approvals, and execution claims at OpenClaw's supported tool hook boundary.
version: 1.6.4
---

# DashClaw Governance Hook

Governs tool calls delivered to OpenClaw's installed `before_tool_call` hook through a five-step loop. Calls outside that host hook are outside this enforcement boundary:

1. **Guard** — `before_tool_call` sends the tool name, risk score, and a 500-character parameter summary to DashClaw `/api/guard`. Policies decide `allow`, `warn`, `block`, or `require_approval`.
2. **Record** — On `allow`/`warn`/`require_approval`, the hook opens a governance record via `/api/actions`. The server is authoritative — it may upgrade an `allow` decision to `pending_approval` for capabilities that require human review.
3. **Wait** — For `pending_approval` actions, the hook calls `waitForApproval(action_id)` using the **action_records ID from step 2**, not the `guard_decisions` ID from step 1. Operators approve from the DashClaw dashboard, CLI, or mobile PWA. The wait is bounded by `approvalWaitMs` (default 60s — under Codex's ~90s per-tool-call RPC watchdog); on timeout the call blocks with a retry hint while the approval stays open ~300s server-side, so approving late and retrying the same call still works.
4. **Claim** — When the guard advertises execution-claim protocol 1, the hook claims the exact action once immediately before returning control to the host. A lost, rejected, or malformed claim blocks the call and is never retried automatically. Servers that do not advertise claims retain the existing policy and approval flow during the staged rollout. Set `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` after the server upgrade to reject legacy responses.
5. **Outcome** — `after_tool_call` records `completed` or `failed` with the error message, giving DashClaw a full intent → policy → outcome trail.

On the first tool call of a run the plugin also opens a DashClaw **Agent Session** (`POST /api/sessions`), and closes it (`PATCH /api/sessions/:id` → `status: completed`) on `agent_end`, so each OpenClaw run appears under the Agent Sessions feature. Session calls are fully fail-safe — a session error never blocks a tool call or the run.

The hook never modifies tool parameters or results. It only blocks, allows, waits, or records.

## Configuration

The plugin accepts three interchangeable configuration shapes — pick whichever fits your deployment:

1. **Canonical plugin-config keys** (recommended for `openclaw.plugin.json`): `dashclawUrl` + `dashclawApiKey`.
2. **SDK-style aliases** (matches the DashClaw Node SDK): `baseUrl` + `apiKey`.
3. **Environment variables** (recommended when secrets live outside the gateway config): `DASHCLAW_BASE_URL` (or legacy `DASHCLAW_URL`) + `DASHCLAW_API_KEY`.

Precedence is `plugin config > env vars`. If env vars are set before the gateway starts, the plugin config can omit URL and API key entirely.

See the `configSchema` section in `openclaw.plugin.json` for the full list of optional fields (`agentId`, `failClosed`, `riskScoreDefault`, `highRiskTools`, `approvalWaitMs`). `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` is an environment-only rollout pin: enable it after the server supports protocol 1 to reject legacy responses that omit claim negotiation.

## Failure modes

- If `createAction` fails and `failClosed=true` (default), the tool call is blocked with a clear reason.
- If `failClosed=false`, the tool call proceeds ungoverned with a warning in the console.
- If the guard verdict is `block`, no action record is opened — the tool call is hard-stopped and no governance row is created.
- A server that omits both claim fields retains the legacy guard and approval flow unless strict mode is set. Partial, malformed, or unknown claim advertisements always block.
- A lost, rejected, or malformed protocol-1 claim acknowledgement blocks the call and is never retried automatically.
- If the tool runs but outcome recording fails, completion is unknown. Reconcile the external system before retrying the effect.

## See also

- Canonical HITL flow: `sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow
- Plugin source: `src/index.ts`
- Config schema: `openclaw.plugin.json`
