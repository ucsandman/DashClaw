# Governing agents over MCP

Any MCP host can talk to DashClaw — zero SDK code. Two transports, one tool surface:

| Transport | For | How |
|---|---|---|
| **stdio** | Claude Code, Codex, any local MCP client | `npx @dashclaw/mcp-server` |
| **Streamable HTTP** | Claude Desktop / claude.ai (custom connector), Claude Managed Agents, any remote MCP client | every DashClaw instance serves MCP at `/api/mcp` — no package install |

**Honesty first:** bare MCP is a **cooperative** surface. The tools return guard decisions; the model is guided (by the `dashclaw-governance` skill) to call `dashclaw_guard` before acting and to honor the answer, but MCP structurally cannot wrap tools it doesn't own, so there is no mechanical backstop for the host's other tools. If you need mechanical blocking, pair MCP with [Claude Code hooks](./claude-code.md) or route the side-effect through a registered capability (`dashclaw_invoke` — DashClaw executes that itself, so a block means the call never happens). Per-surface table: [enforcement boundary](../architecture/enforcement-boundary.md).

## stdio setup

```json
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-dashclaw.example.com",
        "DASHCLAW_API_KEY": "oc_live_xxx"
      }
    }
  }
}
```

Required: `DASHCLAW_URL` + `DASHCLAW_API_KEY`. Optional: `DASHCLAW_AGENT_ID` (defaults per host). **No org id is needed** — the API key resolves the org. Tuning knobs (timeouts, retries, `DASHCLAW_GUARD_UNAVAILABLE_POLICY` for fail-open/fail-closed behavior when the instance is unreachable) are in the [server README](../../mcp-server/README.md).

> One caveat: Claude **Desktop** chat cannot run local stdio MCP servers reliably (its bundled Node crashes them) — Desktop uses the OAuth connector below instead.

## Claude Desktop / claude.ai: the OAuth connector

Settings → Connectors → paste `https://<your-instance>/api/mcp`. OAuth auto-discovers — no key in the UI — and tool calls attribute to the `claude-desktop` agent identity. Full walkthrough incl. troubleshooting: [CLAUDE-DESKTOP-PLUGIN.md](../CLAUDE-DESKTOP-PLUGIN.md).

## Claude Managed Agents

```python
agent = client.beta.agents.create(
    name="Governed Agent",
    model="claude-sonnet-4-6",
    tools=[{"type": "agent_toolset_20260401"}],
    mcp_servers=[{
        "type": "url",
        "url": "https://your-dashclaw.example.com/api/mcp",
        "headers": {"x-api-key": "oc_live_xxx"},
        "name": "dashclaw"
    }],
)
```

A working example lives in [`examples/managed-agent-mcp/`](../../examples/managed-agent-mcp/README.md).

## What the tools are

The server exposes **12 governance tools** across 3 groups — core governance (`dashclaw_guard`, `dashclaw_record`, `dashclaw_wait_for_approval`, `dashclaw_invoke`, `dashclaw_capabilities_list`, `dashclaw_policies_list`, and session lifecycle), retrospection (`dashclaw_assumption_record`, `dashclaw_decisions_recent`), and agent identity (`dashclaw_pair`) — plus 4 read-only resources (`dashclaw://policies`, `dashclaw://capabilities`, `dashclaw://agent/{agent_id}/history`, `dashclaw://status`). The complete tool-by-tool table is [`mcp-server/README.md`](../../mcp-server/README.md).

The **local stdio server** additionally carries governed execution: provider tools for GitHub, Vercel, Neon, Stripe and more (each registers only when its credential env var is present) and stateful launch plans — every step through the same guard/policy/approval path. See [`mcp-server/docs/launch-plans.md`](../../mcp-server/docs/launch-plans.md).

## Teach the model the protocol

Wiring tools in is half the job; the model also needs to know *when* to call guard and how to behave on each verdict. That is the `dashclaw-governance` skill — drop it into your host's skills directory (bundled automatically with the coding-agent plugins, or copy from [`public/downloads/dashclaw-governance/`](../../public/downloads/dashclaw-governance/)). It teaches the decision tree, the approval-wait protocol, and session lifecycle.

## Verify

From a connected host, ask the agent to run `dashclaw_guard` with a low-risk test intent, then check `/decisions` on your instance — the evaluation lands as the newest row, attributed to the host's agent identity. If the tools are missing entirely, see [troubleshooting](../troubleshooting.md).
