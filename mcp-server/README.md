# @dashclaw/mcp-server

MCP server for [DashClaw](https://github.com/ucsandman/DashClaw) governance. Exposes 29 governance tools and 6 read-only resources over [Model Context Protocol](https://modelcontextprotocol.io/). Works with Claude Code, Claude Desktop, Claude Managed Agents, and any MCP-compatible client.

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
(default `claude-desktop`). The 29 governance tools then appear in Claude.

> **Cowork caveat:** Cowork tool availability runs through its VM, and the host `.mcpb` install path is unverified for Cowork. The OAuth remote connector (below) is the verified cross-surface path.

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

## Tools (29)

Grouped by domain. See [`lib/tools.js`](./lib/tools.js) for the canonical definitions.

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

**Behavior learning (1)** — observe-only Policy Coach suggestions learned from this agent's recorded behavior.

| Tool | Description |
|---|---|
| `dashclaw_behavior_suggestions` | List observe-only Policy Coach suggestions learned from this agent's recorded behavior |

**Governance posture (2)** — read the org governance posture score + remediation queue (read-only).

| Tool | Description |
|---|---|
| `dashclaw_posture` | Read the org governance posture score + 6 dimensions + findings queue |
| `dashclaw_posture_next` | The next prioritized remediation finding from the posture queue |

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

| CLI Arg | Env Var | Default | Description |
|---|---|---|---|
| `--url` | `DASHCLAW_URL` | `http://localhost:3000` | DashClaw instance URL |
| `--key` | `DASHCLAW_API_KEY` | (empty) | API key (`oc_live_` prefix) |
| `--agent-id` | `DASHCLAW_AGENT_ID` | (empty) | Default agent ID |

CLI args take precedence over environment variables.

> **Note:** This server reads `DASHCLAW_URL` (not `DASHCLAW_BASE_URL`); the hooks and CLI read `DASHCLAW_BASE_URL`.
