# @dashclaw/openclaw-plugin

Add DashClaw governance to OpenClaw — every tool call gets policy enforcement, human approval gates, and a verifiable decision trail.

## Install

```bash
openclaw plugins install @dashclaw/openclaw-plugin
```

## Configure

The plugin accepts **three interchangeable configuration shapes** — pick whichever fits your deployment. Precedence is plugin config > env vars.

### Option A — canonical plugin-config keys

```json
{
  "plugins": {
    "entries": {
      "dashclaw-governance": {
        "enabled": true,
        "config": {
          "dashclawUrl": "https://my-dashclaw.vercel.app",
          "dashclawApiKey": "oc_live_...",
          "agentId": "my-openclaw-agent",
          "failClosed": true,
          "highRiskTools": ["bash", "exec", "write_file"]
        }
      }
    }
  }
}
```

### Option B — SDK-style aliases

If you prefer the same naming as the DashClaw Node SDK:

```json
{
  "config": {
    "baseUrl": "https://my-dashclaw.vercel.app",
    "apiKey": "oc_live_...",
    "agentId": "my-openclaw-agent"
  }
}
```

### Option C — environment variables (recommended for secrets)

Set these before the gateway starts and omit URL/key from plugin config entirely:

```bash
export DASHCLAW_BASE_URL="https://my-dashclaw.vercel.app"    # DASHCLAW_URL also accepted
export DASHCLAW_API_KEY="oc_live_..."
export DASHCLAW_AGENT_ID="my-openclaw-agent"                 # optional
```

```json
{
  "config": {
    "failClosed": true,
    "highRiskTools": ["bash", "exec", "write_file"]
  }
}
```

This is the cleanest setup when you already keep DashClaw credentials in a `.env` / `secrets/` file shared with other tooling (CLI, local SDK scripts, MCP server).

Config changes require a gateway restart, the same as any other OpenClaw plugin.

## What happens

Every tool call your agent makes flows through DashClaw before it executes:

1. Agent decides to call a tool (e.g. `bash`, `write`, a custom HTTP tool).
2. The plugin **classifies the tool call** — parsing bash commands, inspecting file paths, and detecting deploy/destructive/network intents — to determine the DashClaw action type, risk score, reversibility, and systems touched.
3. The plugin calls DashClaw `/api/guard` with the full classification (`action_type`, `risk_score`, `declared_goal`, `reversible`, `systems_touched`) and canonical act evidence: the full shell command for `bash`/`exec`, or the file target for `write`/`edit`/`apply_patch`. DashClaw can therefore derive risk from what will run and match protected paths. File content is never copied into evidence. If the verdict is `block`, the tool call is rejected immediately.
4. On `allow`, `warn`, or `require_approval`, the plugin opens a governance record via `/api/actions`. The server re-runs policy here and is the authoritative source for HITL gating — it may return `action.status === 'pending_approval'` even when guard said `allow` (for example, if the capability has `requires_approval: true`).
5. If the action is `pending_approval`, the plugin pauses on `waitForApproval(action.action_id)`. You approve from the DashClaw dashboard, the CLI (`dashclaw approve <id>`), or the mobile PWA — the agent is unblocked the moment the operator approves (SSE first, polling fallback).
6. On approval, the tool executes. The `after_tool_call` hook records the outcome (`completed` or `failed`, with the error message) so DashClaw has a full intent → policy → outcome trail.

On the first tool call of each run the plugin opens a DashClaw **Agent Session** and closes it (`status: completed`) on `agent_end`, so every OpenClaw run shows up under the Agent Sessions feature (not just Code Sessions). Session lifecycle calls are fully fail-safe — a session error never blocks a tool call or the run.

The plugin is read-mostly: it never modifies the tool's parameters or the tool's result. It only blocks, allows, or records.

### Unified policy surface

The plugin uses the **same action type vocabulary** as the DashClaw Claude Code hooks. Policies you write for Claude Code automatically apply to OpenClaw agents — no duplication needed.

| Tool call | Action type | Risk | Reversible |
|---|---|---|---|
| `bash: git push origin main` | `deploy` | 80 | no |
| `bash: rm -rf /tmp/data` | `security` | 90 | no |
| `bash: git diff` | `review` | 10 | yes |
| `bash: curl https://api.example.com` | `api` | 40 | yes |
| `bash: npm install express` | `build` | 30 | yes |
| `write: .env.production` | `security` | 85 | yes |
| `edit: src/app.ts` | `apply` | 50 | yes |
| `read: config.json` | `review` | 15 | yes |

For bash/exec tools, the plugin parses the command to classify intent. For file tools, it scans the path for sensitive patterns (`.env`, `credential`, `private_key`, etc.). Unrecognized tools fall through to `other` with the default risk score.

### `action_id` distinction

`guard()` returns an `action_id` that points at the `guard_decisions` table
(prefix `act_gd_…`). `createAction()` returns an `action_id` that points at
the `action_records` table. `waitForApproval()` polls
`GET /api/actions/:id`, which resolves against `action_records` — so the
plugin always waits using the `createAction()` ID, never the `guard()` ID.
Plugin builds at `1.0.0` had this wrong and the PWA approval queue stayed
empty because the wait target didn't exist. Fixed in `1.0.1`.

## Configuration reference

| Field | Type | Default | Description |
|---|---|---|---|
| `dashclawUrl` | string | **required** | Base URL of your DashClaw instance, e.g. `https://my-dashclaw.vercel.app`. |
| `dashclawApiKey` | string | **required** | DashClaw API key (starts with `oc_live_`). |
| `agentId` | string | `"openclaw"` | Identifier this OpenClaw instance reports to DashClaw. |
| `defaultModel` | string | `""` | Fallback model id (e.g. `claude-sonnet-5`, `openai-codex/gpt-5.4`) used when `llm_output` events don't include a `model` field. Without this, unpriced turns land `tokens_in`/`tokens_out` but `cost_estimate` stays `$0`. Env var: `DASHCLAW_DEFAULT_MODEL`. |
| `failClosed` | boolean | `true` | If DashClaw is unreachable, block the tool call. Set `false` to fail open. |
| `autoPairing` | boolean | `true` | Automatically answer operator pairing requests from the DashClaw `/identities` page. The private key is stored at `~/.dashclaw/identity/<agentId>.pem` and never leaves this machine. Set `false` to require manual pairing (MCP `dashclaw_pair` or SDK `createPairing`). |
| `riskScoreDefault` | number | `50` | Fallback risk score for tool calls the classifier doesn't recognize. Recognized commands (git, curl, rm, npm, etc.) compute their own risk score automatically. |
| `highRiskTools` | string[] | `[]` | Tool names that start at risk score 85 instead of the default, before classification. A pattern match then takes precedence over that starting score in both directions: a destructive command still scores 90, a deploy scores 80, and read-only tools are capped at 15 no matter what they started at. |
| `approvalWaitMs` | number | `60000` | How long a `require_approval` decision waits for the operator before blocking with a retry hint. Keep it below your runtime's per-tool-call watchdog — Codex's embedded dynamic-tool RPC kills calls at ~90s, which would silently drop the tool result instead of blocking cleanly. The approval stays open ~300s server-side, so the operator can approve after the wait and the agent's retry of the same call passes (guard approval grant + idempotent `createAction`). |

## Automatic identity pairing

When an admin clicks **Request pairing** for this agent on the DashClaw
`/identities` page, the plugin answers on the agent's next tool call — no LLM
involvement:

1. It reads the agent's unread DashClaw inbox and finds the
   `dashclaw.pairing_request` directive.
2. It generates an RSA-2048 keypair locally. The private key is written to
   `~/.dashclaw/identity/<agentId>.pem` (mode 600) and never leaves the
   machine.
3. It POSTs the public key to `/api/pairings` and marks the message read.

The pairing then appears under **Pending Pairings** on `/identities` for the
admin's one-click approval — approval is what creates the identity. Disable
with `autoPairing: false`. To rotate keys, delete the `.pem` file and click
**Request pairing** again. Auto-pairing is fire-and-forget: it runs once per
gateway process and can never block or fail a tool call.

## Fail-closed vs fail-open

- **`failClosed: true` (default)** — if DashClaw is unreachable for any reason (network error, 5xx, timeout), the plugin blocks the tool call with a clear reason. This is the safe default for governance: no decisions slip through unrecorded.
- **`failClosed: false`** — if DashClaw is unreachable, the plugin logs a warning and lets the tool call proceed. Choose this only when availability matters more than governance guarantees (e.g. a non-critical agent that should keep running through DashClaw outages).

The fail-closed branch only fires for **infrastructure failures** talking to DashClaw. Explicit `block` or denied `require_approval` decisions always block the tool call regardless of `failClosed`.

## How tool calls are classified

The plugin goes beyond tool names — it inspects the **content** of each call:

- **bash/exec**: Parses the command string against known command sets (readonly, destructive, network, package management, git subcommands) and regex patterns for deploy and destructive operations. A `git push` is classified as `deploy` (risk 80, irreversible), while `git diff` is `review` (risk 10).
- **write/edit/apply_patch**: Scans the file path for sensitive patterns (`.env`, `credential`, `private_key`, `.pem`). Sensitive paths get `security` (risk 85); normal paths get `apply`.
- **read/web_search/web_fetch**: Always `review` with low risk (capped at 15).
- **sessions_send**: `message`, irreversible.
- **Everything else**: `other` with the configured default risk.

This classification mirrors what the DashClaw Claude Code hooks do via `dashclaw_agent_intel`, so the same guard policies fire consistently across both platforms.

## Outcome recording

The plugin caches the DashClaw `action_id` from `before_tool_call` in a module-level map keyed by the call id, then resolves it in `after_tool_call` to send `updateOutcome`. If `after_tool_call` doesn't fire (process crash, hook misordering), the action stays in `running` state in DashClaw — you'll see it in the open-loops view and can resolve it manually.

If the outcome update itself fails, the plugin logs a warning but never throws — DashClaw recording is best-effort and must not break your agent's tool execution.

## Token usage and cost (v1.2.1+)

The plugin hooks OpenClaw's `llm_output` and `agent_end` events to attribute LLM token usage back to the governed tool calls that assistant response induced. Each `llm_output` reports `{input, output, cacheRead, cacheWrite}` plus the resolved `model`; when the next `llm_output` (or `agent_end`) fires, the plugin PATCHes `tokens_in`, `tokens_out`, and `model` onto every action opened since the last usage boundary. DashClaw derives `cost_estimate` server-side from its pricing table.

Accounting notes:

- Tokens are split evenly across the tool calls attributable to the same assistant response. Remainders go to the earliest buckets so the sum is preserved.
- Cache reads are weighted at 0.1× (Anthropic bills cache reads at ~10% of base input price) before being added to `tokens_in`. Cache writes are counted at full price. This keeps the derived cost aligned with real billing without requiring the server to model cache pricing.
- Failures are silent: a warning is logged but token attribution never blocks or throws. If your provider doesn't populate `usage`, nothing is patched.
- **Missing `model`:** if `llm_output` fires with `usage` but no `model`, the plugin stashes tokens using `config.defaultModel` / `DASHCLAW_DEFAULT_MODEL` as a fallback. When both are unset, tokens are still attributed but `cost_estimate` stays `$0` — because the server refuses to guess the model (retroactively backfilling `model = NULL` would have priced every historical row as Opus). The plugin logs a one-time breadcrumb per run in this case so ops can spot it quickly.

## Troubleshooting cost attribution

If actions are flowing but `cost_estimate` stays `$0` for an OpenClaw agent, run this query against your DashClaw DB — it decomposes the three failure modes in one shot:

```sql
SELECT
  agent_id,
  COUNT(*) AS actions,
  COUNT(*) FILTER (WHERE tokens_in > 0 OR tokens_out > 0) AS with_tokens,
  COUNT(*) FILTER (WHERE model IS NOT NULL AND model <> '') AS with_model,
  COUNT(*) FILTER (WHERE cost_estimate > 0) AS with_cost
FROM action_records
WHERE org_id = '<your_org_id>'
  AND timestamp_start::timestamptz >= NOW() - INTERVAL '30 days'
GROUP BY agent_id
ORDER BY actions DESC;
```

Interpretation:

| `with_tokens` | `with_model` | `with_cost` | Likely cause |
|---|---|---|---|
| `0` | `0` | `0` | Plugin older than v1.2.0, or OpenClaw runtime doesn't emit `llm_output`. Upgrade both. |
| `> 0` | `0` | `0` | `llm_output` fires without `model`. Set `config.defaultModel` or `DASHCLAW_DEFAULT_MODEL`. |
| `> 0` | `> 0` | `0` | Model string isn't matched by DashClaw's pricing table. Add it via Settings → Model Pricing. |
| `> 0` | `> 0` | `> 0` | Working. If the UI disagrees, check the analytics aggregation. |

## Links

- DashClaw: <https://github.com/ucsandman/DashClaw>
- DashClaw Node SDK: <https://www.npmjs.com/package/dashclaw>
- OpenClaw: <https://docs.openclaw.ai>

## License

MIT — see [LICENSE](./LICENSE).
