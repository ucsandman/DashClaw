# @dashclaw/mcp-server

MCP server for [DashClaw](https://github.com/ucsandman/DashClaw) governance. Exposes 12 governance tools and 4 read-only resources over [Model Context Protocol](https://modelcontextprotocol.io/) — guard, record, invoke governed capabilities, wait for approvals, and read the decision ledger, all through the DashClaw governance loop. Works with Claude Code, Claude Desktop, Claude Managed Agents, and any MCP-compatible client.

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
4. Authorize → the 29 governance tools appear, scoped to your workspace.

Works on Free/Pro/Max/Team/Enterprise (Free is capped at one custom connector).
The legacy `x-api-key` path (Managed Agents) is unchanged.

### Plugin (skills) via marketplace

To also load the DashClaw **skills** (governance protocol + platform intelligence)
in the Claude app: Customize → Plugins → "+" → Add marketplace →
`github: ucsandman/DashClaw`, then install the `dashclaw` plugin.

## Tools (12)

Grouped by domain. See [`src/tools.ts`](./src/tools.ts) for the canonical definitions.

**Core governance (9)** — the guard / record / invoke loop plus discovery and session lifecycle.

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
| `dashclaw_session_retro` | Read the session's own defensibility retro (clean/review/flagged posture) |

> **Session linkage:** after `dashclaw_session_start`, the server auto-stamps that session's id onto every `dashclaw_record` in the same connection (stdio). Pass `session_id` on `dashclaw_record` to override, or to attribute explicitly on the HTTP transport (`POST /api/mcp`), where each request is stateless.

**Session continuity (3)** — agent-runtime handoff bundle for the next session.

| Tool | Description |
|---|---|
| `dashclaw_handoff_create` | Write handoff bundle for next session |
| `dashclaw_handoff_latest` | Fetch latest unconsumed handoff |
| `dashclaw_handoff_consume` | Mark handoff consumed (idempotent) |

**Open loops (3)** — action-scoped commitments ("I will X later" tracker).

| Tool | Description |
|---|---|
| `dashclaw_loop_add` | Register action-scoped commitment |
| `dashclaw_loop_list` | List open/resolved loops |
| `dashclaw_loop_close` | Resolve an open loop |

**Retrospection (2)** — record assumptions; recent governed-action ledger.

| Tool | Description |
|---|---|
| `dashclaw_assumption_record` | Record an unverified assumption underpinning an action |
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

**Governance posture (2)** — read the org governance posture score + remediation queue (read-only).

| Tool | Description |
|---|---|
| `dashclaw_posture` | Read the org governance posture score + 6 dimensions + findings queue |
| `dashclaw_posture_next` | The next prioritized remediation finding from the posture queue |

### DashClaw-gated stdio tools (3)

Registered by [`src/tools/index.ts`](./src/tools/index.ts) on the local stdio
server only, gated on the same `DASHCLAW_URL` + `DASHCLAW_API_KEY` credentials
as the governance set:

| Tool | Description |
|---|---|
| `dashclaw_status` | Check DashClaw gate configuration and reachability |
| `dashclaw_recent_decisions` | Read recent DashClaw guard decisions |
| `export_dashclaw_evidence` | Export local audit entries carrying DashClaw guard/evidence metadata |

## Resources (4)

| URI | Description |
|---|---|
| `dashclaw://policies` | Active policy set |
| `dashclaw://capabilities` | Available capabilities and health |
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
| | `DASHCLAW_LOG_STARTUP` | `false` | Structured startup logs to stderr |
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
