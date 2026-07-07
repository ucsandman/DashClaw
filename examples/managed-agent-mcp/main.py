"""
Claude Managed Agent + DashClaw MCP Governance

The simplest way to govern a Claude Managed Agent with DashClaw.
Instead of custom tools and HTTP boilerplate, the agent connects
to DashClaw's MCP server and gets 23 governance tools automatically.

Optionally attach the DashClaw governance skill for even better behavior —
the skill teaches the agent the governance protocol so you don't need
a detailed system prompt.

Requirements:
  pip install anthropic python-dotenv
  cp .env.example .env  # fill in your keys
"""

import os
import sys

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
DASHCLAW_URL = os.environ.get("DASHCLAW_URL", "http://localhost:3000")
DASHCLAW_API_KEY = os.environ.get("DASHCLAW_API_KEY", "")
DASHCLAW_SKILL_ID = os.environ.get("DASHCLAW_SKILL_ID", "")

if not ANTHROPIC_API_KEY:
    print("Error: ANTHROPIC_API_KEY is required. Set it in .env or environment.")
    sys.exit(1)


def run_governed_session(task):
    """Run a governed managed agent session via MCP."""
    client = Anthropic()

    # Build agent config
    has_skill = bool(DASHCLAW_SKILL_ID)

    # With skill: short system prompt (skill carries governance instructions)
    # Without skill: detailed system prompt
    system_prompt = (
        "You are a governed research agent."
        if has_skill
        else (
            "You are a governed research agent with DashClaw governance tools "
            "available via MCP. Before any risky action (external APIs, deploys, "
            "data modifications), call dashclaw_guard. Record significant outcomes "
            "with dashclaw_record. Use dashclaw_capabilities_list to discover "
            "available APIs."
        )
    )

    skills = []
    if has_skill:
        skills.append({
            "type": "custom",
            "skill_id": DASHCLAW_SKILL_ID,
            "version": "latest",
        })

    # 1. Create agent with DashClaw MCP server (+ optional skill)
    mode = "MCP + Skill" if has_skill else "MCP"
    print(f"Creating governed agent ({mode})...")
    agent = client.beta.agents.create(
        name=f"DashClaw Governed Agent ({mode})",
        model="claude-sonnet-4-6",
        system=system_prompt,
        tools=[{"type": "agent_toolset_20260401"}],
        mcp_servers=[
            {
                "type": "url",
                "url": f"{DASHCLAW_URL}/api/mcp",
                "headers": {"x-api-key": DASHCLAW_API_KEY},
                "name": "dashclaw",
            }
        ],
        skills=skills if skills else None,
    )
    print(f"  Agent ID: {agent.id}")

    # 2. Create environment (allow DashClaw + MCP)
    print("Creating environment...")
    environment = client.beta.environments.create(
        name="dashclaw-mcp-env",
        config={
            "type": "cloud",
            "networking": {
                "type": "limited",
                "allowed_hosts": [DASHCLAW_URL.replace("http://", "").replace("https://", "")],
                "allow_mcp_servers": True,
            },
        },
    )
    print(f"  Environment ID: {environment.id}")

    # 3. Start session
    print("Starting session...")
    session = client.beta.sessions.create(
        agent=agent.id,
        environment_id=environment.id,
        title=f"Governed ({mode}): {task[:50]}",
    )
    print(f"  Session ID: {session.id}")

    # 4. Stream — no custom tool handling needed
    print(f"\nTask: {task}")
    print("-" * 60)

    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id,
            events=[
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": task}],
                }
            ],
        )

        for event in stream:
            match event.type:
                case "agent.message":
                    for block in event.content:
                        if hasattr(block, "text"):
                            print(block.text, end="")
                case "agent.tool_use":
                    print(f"\n  [Built-in: {event.name}]")
                case "agent.mcp_tool_use":
                    print(f"\n  [DashClaw: {event.name}]")
                case "session.status_idle":
                    stop = event.stop_reason
                    if stop and stop.type == "end_turn":
                        print("\n\nAgent finished.")
                        break
                case "session.status_terminated":
                    print("\n  [Session terminated]")
                    break
                case "session.error":
                    msg = event.error.message if hasattr(event, "error") and event.error else "unknown"
                    print(f"\n  [Error: {msg}]")

    print(f"\nGovernance trail: {DASHCLAW_URL}/decisions")

    # 5. Cleanup
    try:
        client.beta.agents.archive(agent.id)
        client.beta.environments.archive(environment.id)
    except Exception:
        pass


if __name__ == "__main__":
    task = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "Research the x402 payment protocol. Use dashclaw_guard before any "
        "external API calls. Record your findings with dashclaw_record when done."
    )
    run_governed_session(task)
