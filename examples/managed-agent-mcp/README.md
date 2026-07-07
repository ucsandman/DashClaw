# Claude Managed Agent + DashClaw MCP

The **recommended** way to govern a Claude Managed Agent with DashClaw. Uses MCP (Model Context Protocol) so the agent gets governance tools automatically — no custom tool definitions, no HTTP boilerplate.

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

This gives the agent 31 governance tools and 6 resources automatically. The 9 core-governance tools are listed below; for the full inventory across optimal files, session continuity, credential hygiene, skill safety, open loops, learning + retrospection, agent inbox, and behavior learning, see [`mcp-server/README.md`](../../mcp-server/README.md).

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

For even better governance behavior, attach the DashClaw governance skill. The skill teaches the agent the full governance protocol — when to guard, how to interpret decisions, how to record actions — so you don't need a detailed system prompt.

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

- **Mission Control** (`/mission-control`) — see governed actions in real time
- **Decisions** (`/decisions`) — full audit trail
- **Capabilities** (`/capabilities`) — invocation history

## vs Custom Tools

| | MCP (this example) | Custom Tools |
|---|---|---|
| Lines of code | ~80 | ~410 |
| Tool handling | Automatic (MCP protocol) | Manual (HTTP + result routing) |
| Setup | One config line | Tool definitions + HTTP client |
| Governance tools | 31 tools + 6 resources | 3 tools |
