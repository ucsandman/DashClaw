# Claude Managed Agent + DashClaw MCP

The shortest way to give a Claude Managed Agent DashClaw policy, audit, and
registered-capability tools through MCP, with no custom tool definitions or HTTP
boilerplate.

> **Trust boundary:** Ordinary MCP governance tools are cooperative. They do not
> mechanically intercept the managed agent's built-in tools. For registered
> capabilities, `dashclaw_invoke` is the bounded server-side effect seam and
> claims one execution attempt immediately before the external call.

Compare: the [custom tools example](../managed-agent-governed/) is ~410 lines. This MCP version is ~80 lines.

## How It Works

The agent connects to DashClaw's MCP server via a single config line:

```python
mcp_servers=[{
    "type": "url",
    "url": f"{DASHCLAW_URL}/api/mcp",
    "headers": {"x-api-key": DASHCLAW_API_KEY},
    "name": "dashclaw",
}]
```

This gives the agent 17 governance tools and 3 resources automatically. The core-governance tools are listed below; for the full inventory, see [`mcp-server/README.md`](../../mcp-server/README.md).

| Tool | Purpose |
|---|---|
| `dashclaw_guard` | Check policies before risky actions |
| `dashclaw_record` | Log actions to audit trail |
| `dashclaw_invoke` | Execute governed capabilities |
| `dashclaw_capabilities_list` | Discover available APIs |
| `dashclaw_policies_list` | See active governance policies |
| `dashclaw_wait_for_approval` | Wait for human approval |
| `dashclaw_session_start` | Register session |
| `dashclaw_session_end` | Close session |
| `dashclaw_session_retro` | Read the session's own defensibility retro |

## MCP + Skill (Recommended)

For more consistent governance behavior, attach the DashClaw governance skill. The skill teaches the cooperative MCP protocol: when to guard, how to interpret decisions, when to use the registered-capability effect seam, and how to record actions. You do not need to duplicate those instructions in the system prompt.

### Upload the skill once:

```bash
ANTHROPIC_API_KEY=sk-xxx node scripts/upload-skill.mjs
# Returns: skill_id=skill_abc123
```

### Add to your .env:

```bash
DASHCLAW_SKILL_ID=skill_abc123
```

The example automatically detects the skill ID and attaches it. The system prompt shortens to just "You are a governed research agent" — the skill carries the rest.

### Without skill vs with skill:

| | MCP Only | MCP + Skill |
|---|---|---|
| System prompt | Detailed governance instructions | One sentence |
| Agent behavior | Follows system prompt rules | Internalizes governance protocol |
| Policy awareness | Must be told about policies | Reads policies from MCP resources at start |
| Capability discovery | Must be prompted | Automatically discovers on session init |

## Setup

```bash
cd examples/managed-agent-mcp
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Anthropic API key and DashClaw instance URL
```

## Run

```bash
# Default task
python main.py

# Custom task
python main.py "Analyze our API performance. Guard before writing to production."
```

## Watch It Live

While the agent runs, open your DashClaw instance:

- **Decisions** (`/decisions`) — full audit trail
- **Capabilities** (`/capabilities`) — invocation history

## vs Custom Tools

| | MCP (this example) | Custom Tools |
|---|---|---|
| Lines of code | ~80 | ~410 |
| Tool handling | Automatic (MCP protocol) | Manual (HTTP + result routing) |
| Setup | One config line | Tool definitions + HTTP client |
| Governance tools | 17 tools + 3 resources | 3 tools |
