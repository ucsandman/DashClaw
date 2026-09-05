# @dashclaw/openclaw-plugin

Add DashClaw governance to tool calls that OpenClaw delivers through the installed `before_tool_call` hook, with policy enforcement, human approval gates, and a verifiable decision trail.

## Install

The recommended path is the DashClaw CLI installer — it runs the plugin install for you and finishes everything the plugin needs to actually enforce (API key written to the profile's `.env`, gateway config patched, plugin enabled, governance protocol written to `AGENTS.md`, install verified). Run it bare in a terminal and it walks you through the rest, including creating a DashClaw instance (hosted trial or local `dashclaw up`) and collecting a key if you don't have them yet:

```bash
dashclaw install openclaw
```

Installing the plugin directly also works:

```bash
openclaw plugins install @dashclaw/openclaw-plugin
```

but the raw install only puts the plugin on disk — it is not enabled and has no configuration until you complete the steps below. Already ran it? `dashclaw install openclaw` detects the installed plugin, keeps it (it never downgrades an equal-or-newer version), and finishes the rest. Full walkthrough: [dashclaw.io/guides/openclaw](https://www.dashclaw.io/guides/openclaw).

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

Every tool call delivered to the installed OpenClaw `before_tool_call` hook flows through DashClaw before it executes:

1. Agent decides to call a tool (e.g. `bash`, `write`, a custom HTTP tool).
2. The plugin **classifies the tool call** — parsing bash commands, inspecting file paths, and detecting deploy/destructive/network intents — to determine the DashClaw action type, risk score, reversibility, and systems touched.
3. The plugin calls DashClaw `/api/guard` with the full classification (`action_type`, `risk_score`, `declared_goal`, `reversible`, `systems_touched`) and canonical act evidence: the full shell command for `bash`/`exec`, or the file target for `write`/`edit`/`apply_patch`. DashClaw can therefore derive risk from what will run and match protected paths. File content is never copied into evidence. If the verdict is `block`, the tool call is rejected immediately.
4. On `allow`, `warn`, or `require_approval`, the plugin opens a governance record via `/api/actions` with the same act evidence. The server re-runs current policy and is authoritative for HITL gating. It may return `action.status === 'pending_approval'` even when the earlier guard said `allow`.
5. If the action is `pending_approval`, the plugin pauses on `waitForApproval(action.action_id)`. You approve from the DashClaw dashboard, the CLI (`dashclaw approve <id>`), or the mobile PWA. The wait uses SSE plus concurrent authoritative action polling, so a connected stream cannot hide a missed event.
6. When the server advertises execution-claim protocol 1, the plugin atomically claims the exact action, agent, act, and fresh attempt immediately before returning control to OpenClaw. Approval is consumed at this claim, not at guard time. A rejected, malformed, or lost claim acknowledgement blocks and is never retried automatically.
7. OpenClaw executes the tool once the plugin releases it. The `after_tool_call` hook records `completed` or `failed` with the error message.

This boundary covers calls OpenClaw delivers to those lifecycle hooks. Embedded
Codex native tools run behind their own runtime and require the separately
installed DashClaw Codex hooks. Older OpenClaw 0.13x Codex integrations remain
cooperative and do not inherit this plugin's mechanical interception boundary.

Claim negotiation supports server-first upgrades. A server that omits both claim
fields keeps the legacy guard and approval flow until you set
`DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1`. Any server that advertises an incomplete,
unknown, or malformed claim protocol is blocked even when strict mode is unset.

On the first intercepted tool call of each run the plugin opens a DashClaw **Agent Session** and closes it (`status: completed`) on `agent_end`, so every OpenClaw run with at least one intercepted call shows up under the Agent Sessions feature (not just Code Sessions). Session lifecycle calls are fully fail-safe — a session error never blocks a tool call or the run.

The plugin is read-mostly: it never modifies the tool's parameters or the tool's result. It only blocks, allows, or records.

### Unified policy surface

The plugin uses the **same action type vocabulary** as the DashClaw Claude Code hooks. Policies you write for Claude Code apply to OpenClaw calls delivered through the plugin hook without duplicating the policy.

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

`DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` is an environment-only rollout pin. Enable
it after the DashClaw server supports protocol 1 to reject legacy responses that
do not advertise claims.

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

### Evidence attachment

Every `guard()` and `createAction()` call now carries an `act` payload alongside the self-declared `action_type`/`risk_score`, so the server's evidence classifier grades what actually ran instead of only the plugin's own summary. Shell calls (`bash`, `exec`) attach `act.kind: 'shell'` with the full command; write calls (`write`, `edit`, `apply_patch`) attach `act.kind: 'file'` with the file path. When a shell command invokes a local script (for example `node tmp/domain-buy.mjs <name>`), the plugin also resolves that script against the tool call's workspace and attaches its first 6144 characters as `act.script.content_excerpt`, so a wrapper script can't hide its risk behind an innocuous-looking command line. For sensitive paths (`.env`, `credential`, `.pem`, `id_rsa`, `.key`) only `act.script.path` is attached, never content. If the script can't be resolved or read, or exceeds 64KB, `script` is omitted entirely — evidence attachment fails soft and never blocks the call.

## Outcome recording

The plugin caches the DashClaw `action_id` from `before_tool_call` in a module-level map keyed by the call id, then resolves it in `after_tool_call` to send `updateOutcome`. If `after_tool_call` doesn't fire (process crash, hook misordering), the action stays in `running` state in DashClaw — you'll see it in the open-loops view and can resolve it manually.

If the outcome update itself fails, the plugin logs a warning but never throws because the tool has already run. Treat that action's completion as unconfirmed. Do not infer that the external effect failed or retry it without reconciling the affected system.

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
