# @dashclaw/mcp-server

MCP server for [DashClaw](https://github.com/ucsandman/DashClaw) governance. Exposes 17 governance tools, 2 stdio-only support tools, and 3 read-only resources over [Model Context Protocol](https://modelcontextprotocol.io/): evaluate policy, record evidence, invoke registered capabilities, wait for approvals, and read the decision ledger. Works with Claude Code, Claude Desktop, Claude Managed Agents, and any MCP-compatible client.

The governance tools register only when `DASHCLAW_URL` and `DASHCLAW_API_KEY` are both set; without them the server registers nothing and warns on stderr if exactly one is present.

## Quick Start

### Claude Code / Cowork (stdio)

```bash
npx -y @dashclaw/mcp-server --url https://your-dashclaw.vercel.app --key oc_live_xxx --agent-id claude-code
```

Or add to your MCP config (`.mcp.json` for Claude Code, or `claude mcp add`):

```json
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["-y", "@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-dashclaw.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_xxx",
        "DASHCLAW_AGENT_ID": "claude-code"
      }
    }
  }
}
```

> **Claude Desktop main chat: do not use stdio.** Desktop runs local MCP servers
> on its bundled Node, which crashes this server. Use the
> [OAuth custom connector](#claude-custom-connector-remote-oauth) instead — no
> local process, works in chat and Cowork.

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

### Claude Desktop

Use the OAuth custom connector (next section) — it is the verified path for
Desktop chat, web, and Cowork, and needs no install. The old one-click `.mcpb`
bundle is **retired**: it ran the stdio server on Desktop's bundled Node, which
crash-loops. If you still have a `dashclaw` extension installed from it,
uninstall it (Settings → Extensions) before adding the connector.

### Claude custom connector (remote, OAuth)

Self-hosted DashClaw is addable as a Claude **custom connector** with no API key
in the UI — Claude's connector flow requires OAuth, not headers:

1. In Claude: Settings → Connectors → Add custom connector.
2. Paste `https://<your-instance>/api/mcp`.
3. Claude discovers `/.well-known/oauth-protected-resource`, registers via DCR,
   and opens your DashClaw login + a consent screen.
4. Authorize → the 17 governance tools appear, scoped to your workspace.

Works on Free/Pro/Max/Team/Enterprise (Free is capped at one custom connector).
The legacy `x-api-key` path (Managed Agents) is unchanged.

### Plugin (skills) via marketplace

To also load the DashClaw **skills** (governance protocol + platform intelligence)
in the Claude app: Customize → Plugins → "+" → Add marketplace →
`github: ucsandman/DashClaw`, then install the `dashclaw` plugin.

## Tools (17 governance + 2 stdio support)

Grouped by domain. See [`src/tools.ts`](./src/tools.ts) for the canonical definitions.

**Core governance (9)** — the guard / record / invoke loop plus discovery and session lifecycle.

| Tool | Description |
|---|---|
| `dashclaw_guard` | Evaluate policies before risky actions |
| `dashclaw_record` | Log actions to audit trail |
| `dashclaw_invoke` | Execute a registered capability through the server's guard, approval, execution-claim, effect, and outcome seam |
| `dashclaw_capabilities_list` | Discover available APIs |
| `dashclaw_policies_list` | See active governance policies |
| `dashclaw_wait_for_approval` | Block until a human resolves an approval |
| `dashclaw_session_start` | Register agent session |
| `dashclaw_session_end` | Close agent session |
| `dashclaw_session_retro` | Read the session's own defensibility retro (clean/review/flagged posture) |

> **Session linkage:** after `dashclaw_session_start`, the server auto-stamps that session's id onto every `dashclaw_record` in the same connection (stdio). Pass `session_id` on `dashclaw_record` to override, or to attribute explicitly on the HTTP transport (`POST /api/mcp`), where each request is stateless.

### Enforcement boundary

`dashclaw_guard`, `dashclaw_record`, and `dashclaw_wait_for_approval` are
cooperative tools. They return policy and audit state, but the MCP host or model
still chooses whether to honor it. Use a host interception hook when you need a
mechanical gate around ordinary MCP tools.

`dashclaw_invoke` is the bounded effect seam. DashClaw holds the registered
capability configuration, evaluates the exact invocation against current
policy, records it, enforces approval, and atomically claims one execution
attempt before making the external call. Approval and plan grants are consumed
at that claim, not by the earlier guard evaluation. If execution finishes but
the outcome cannot be recorded, the tool reports unknown execution state and
does not describe a retry as safe. Reconcile the external system first.

**Retrospection (2)** — record assumptions; recent governed-action ledger.

| Tool | Description |
|---|---|
| `dashclaw_assumption_record` | Record an unverified assumption underpinning an action |
| `dashclaw_decisions_recent` | Recent governed-action ledger |

**Agent identity (1)** — operator-approved pairing of an unidentified agent to a registered identity.

| Tool | Description |
|---|---|
| `dashclaw_pair` | Enroll agent identity: keypair locally, public key to /api/pairings |

**Team Tasks (3)** — create a Team Task, append an inter-agent timeline event, update task status.

| Tool | Description |
|---|---|
| `dashclaw_task_create` | Create a Team Task — one record per multi-agent /team run |
| `dashclaw_task_event` | Append one event to a Team Task timeline (delegation, reply, status, approval_needed, result, error, done) |
| `dashclaw_task_update` | Update a Team Task: status transitions and stored transport session ids |

**Plans (2)** — submit a preflight plan for one-card operator review and poll its review state. Preview and review responses are evidence; the live action is re-evaluated and any grant is consumed only by its execution claim.

| Tool | Description |
|---|---|
| `dashclaw_plan_submit` | Submit an ordered step list for preflight review; approved steps become scoped, expiring grants consumed only by an execution claim |
| `dashclaw_plan_status` | Check a submitted plan's overall and per-step verdict |

### DashClaw-gated stdio tools (2)

Registered by [`src/tools/index.ts`](./src/tools/index.ts) on the local stdio
server only, gated on the same `DASHCLAW_URL` + `DASHCLAW_API_KEY` credentials
as the governance set:

| Tool | Description |
|---|---|
| `dashclaw_status` | Check DashClaw gate configuration and reachability |
| `export_dashclaw_evidence` | Export local audit entries carrying DashClaw guard/evidence metadata |

## Resources (3)

| URI | Description |
|---|---|
| `dashclaw://policies` | Active policy set |
| `dashclaw://agent/{agent_id}/history` | Recent action history (last 50) |
| `dashclaw://status` | Instance health + operational metrics |

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
| | `DASHCLAW_LOCK_STALE_MS` | `30000` | Stale file-lock threshold for local state files |
| | `DASHCLAW_AUDIT_MAX_ENTRIES` | (unlimited) | Cap retained audit entries |

CLI args take precedence over environment variables.

> **Note:** This server reads `DASHCLAW_URL` (not `DASHCLAW_BASE_URL`); the hooks and CLI in the DashClaw repo read `DASHCLAW_BASE_URL`.

## Storage

Local-first state under **`.dashclaw-local/`** in the working directory
(override with `DASHCLAW_LOCAL_HOME`). Plain JSON — human-readable,
diffable, zero native dependencies:

| File | Holds |
|---|---|
| `state.json` | The local default workspace |
| `audit.log` | Append-only JSONL audit trail read by the DashClaw evidence tools |

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
