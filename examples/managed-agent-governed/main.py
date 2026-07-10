"""
Claude Managed Agent + DashClaw Governance Example

Demonstrates how to govern a Claude Managed Agent through DashClaw.
The managed agent runs autonomously in Anthropic's cloud infrastructure,
and every significant action is governed through DashClaw's control plane:

  1. Agent calls `dashclaw_guard` before risky actions -> DashClaw evaluates policies
  2. Agent calls `dashclaw_invoke` to execute capabilities -> DashClaw guards + executes + records
  3. Agent calls `dashclaw_record` to log decisions -> DashClaw creates auditable action records
  4. Everything shows up in DashClaw's Approvals operations feed

The agent gets full autonomy for safe actions (file I/O, search, code execution)
via the built-in agent toolset, but must go through DashClaw for governed operations.

Requirements:
  pip install anthropic python-dotenv requests
  cp .env.example .env  # fill in your keys
"""

import json
import os
import sys

import requests
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
DASHCLAW_URL = os.environ.get("DASHCLAW_URL", "http://localhost:3000")
DASHCLAW_API_KEY = os.environ.get("DASHCLAW_API_KEY", "")

if not ANTHROPIC_API_KEY:
    print("Error: ANTHROPIC_API_KEY is required. Set it in .env or environment.")
    sys.exit(1)

DASHCLAW_HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": DASHCLAW_API_KEY,
}

AGENT_ID = "managed-governed-agent"

# ── DashClaw API Helpers ─────────────────────────────────────────────────────


def dashclaw_guard(action_type, declared_goal, risk_score, systems_touched, reversible=True):
    """Evaluate DashClaw guard policies before an action."""
    try:
        resp = requests.post(
            f"{DASHCLAW_URL}/api/guard",
            headers=DASHCLAW_HEADERS,
            json={
                "agent_id": AGENT_ID,
                "action_type": action_type,
                "declared_goal": declared_goal,
                "risk_score": risk_score,
                "systems_touched": systems_touched,
                "reversible": reversible,
            },
            timeout=10,
        )
        return resp.json()
    except Exception as e:
        return {"decision": "allow", "error": str(e)}


def dashclaw_invoke(capability_id, payload, declared_goal):
    """Invoke a DashClaw-governed capability (guard + execute + record)."""
    try:
        resp = requests.post(
            f"{DASHCLAW_URL}/api/capabilities/{capability_id}/invoke",
            headers=DASHCLAW_HEADERS,
            json={
                "agent_id": AGENT_ID,
                "declared_goal": declared_goal,
                "payload": payload,
            },
            timeout=30,
        )
        return resp.json()
    except Exception as e:
        return {"success": False, "error": str(e)}


def dashclaw_record(action_type, declared_goal, status, risk_score=30, output_summary=""):
    """Record a governed action in DashClaw."""
    try:
        resp = requests.post(
            f"{DASHCLAW_URL}/api/actions",
            headers=DASHCLAW_HEADERS,
            json={
                "agent_id": AGENT_ID,
                "action_type": action_type,
                "declared_goal": declared_goal,
                "status": status,
                "risk_score": risk_score,
                "systems_touched": [action_type],
                "output_summary": output_summary[:500],
                "reversible": True,
            },
            timeout=10,
        )
        return resp.json()
    except Exception as e:
        return {"error": str(e)}


# ── Custom Tool Handlers ────────────────────────────────────────────────────

TOOL_HANDLERS = {
    "dashclaw_guard": lambda input_data: dashclaw_guard(
        action_type=input_data.get("action_type", "unknown"),
        declared_goal=input_data.get("declared_goal", ""),
        risk_score=input_data.get("risk_score", 50),
        systems_touched=input_data.get("systems_touched", []),
        reversible=input_data.get("reversible", True),
    ),
    "dashclaw_invoke": lambda input_data: dashclaw_invoke(
        capability_id=input_data.get("capability_id", ""),
        payload=input_data.get("payload", {}),
        declared_goal=input_data.get("declared_goal", ""),
    ),
    "dashclaw_record": lambda input_data: dashclaw_record(
        action_type=input_data.get("action_type", "unknown"),
        declared_goal=input_data.get("declared_goal", ""),
        status=input_data.get("status", "completed"),
        risk_score=input_data.get("risk_score", 30),
        output_summary=input_data.get("output_summary", ""),
    ),
}


# ── Custom Tool Definitions ─────────────────────────────────────────────────

DASHCLAW_CUSTOM_TOOLS = [
    {
        "type": "custom",
        "name": "dashclaw_guard",
        "description": (
            "Evaluate DashClaw governance policies before taking a risky action. "
            "Call this BEFORE any action that modifies external systems, deploys code, "
            "sends messages, or touches production data. Returns a decision: "
            "'allow' (proceed), 'block' (stop), or 'require_approval' (wait for human). "
            "If blocked, do NOT proceed with the action."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action_type": {
                    "type": "string",
                    "description": "Category of action (e.g., 'deploy', 'send_email', 'database_write', 'api_call')",
                },
                "declared_goal": {
                    "type": "string",
                    "description": "What you intend to do, in plain language",
                },
                "risk_score": {
                    "type": "integer",
                    "description": "Estimated risk 0-100 (0=safe, 100=critical). Use 70+ for production systems.",
                },
                "systems_touched": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of systems affected (e.g., ['production', 'database', 'email'])",
                },
                "reversible": {
                    "type": "boolean",
                    "description": "Whether the action can be undone",
                },
            },
            "required": ["action_type", "declared_goal", "risk_score"],
        },
    },
    {
        "type": "custom",
        "name": "dashclaw_invoke",
        "description": (
            "Invoke a DashClaw-governed capability. This is the primary way to call "
            "external APIs and tools through DashClaw's governance loop. The capability "
            "is guarded (policy check), executed (HTTP call), and recorded (audit trail) "
            "automatically. Use this instead of making direct HTTP calls when the target "
            "API is registered as a DashClaw capability."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "capability_id": {
                    "type": "string",
                    "description": "The DashClaw capability ID to invoke (e.g., 'cap_abc123')",
                },
                "payload": {
                    "type": "object",
                    "description": "The request payload to send to the capability",
                },
                "declared_goal": {
                    "type": "string",
                    "description": "What you're trying to accomplish with this invocation",
                },
            },
            "required": ["capability_id", "declared_goal"],
        },
    },
    {
        "type": "custom",
        "name": "dashclaw_record",
        "description": (
            "Record a governed action in DashClaw's audit trail. Use this to log "
            "significant decisions, completed tasks, or notable outcomes that should "
            "be tracked for governance and compliance. Every important action the agent "
            "takes should be recorded."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action_type": {
                    "type": "string",
                    "description": "Category of action (e.g., 'research', 'analysis', 'code_change')",
                },
                "declared_goal": {
                    "type": "string",
                    "description": "What was accomplished",
                },
                "status": {
                    "type": "string",
                    "enum": ["completed", "failed", "blocked"],
                    "description": "Outcome status",
                },
                "risk_score": {
                    "type": "integer",
                    "description": "Risk level 0-100",
                },
                "output_summary": {
                    "type": "string",
                    "description": "Brief summary of what was produced or decided",
                },
            },
            "required": ["action_type", "declared_goal", "status"],
        },
    },
]

# ── System Prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a governed research agent. You have access to both standard tools \
(file I/O, bash, web search) and DashClaw governance tools.

GOVERNANCE RULES:
1. Before any action that modifies external systems or has risk > 50, \
call dashclaw_guard first. If blocked, stop. If require_approval, tell the user.
2. When invoking registered capabilities (external APIs), use dashclaw_invoke \
instead of direct HTTP calls.
3. After completing significant work, call dashclaw_record to log the outcome.

You can freely use standard tools (read, write, bash, web_search) for \
research and analysis without governance checks. Only governed actions \
(deploys, external API calls, data modifications) need DashClaw approval.
"""

# ── Main Session Loop ────────────────────────────────────────────────────────


def run_governed_session(task):
    """Run a governed managed agent session."""
    client = Anthropic()

    # 1. Create the governed agent
    print("Creating governed agent...")
    agent = client.beta.agents.create(
        name="DashClaw Governed Research Agent",
        model="claude-sonnet-4-6",
        system=SYSTEM_PROMPT,
        tools=[
            {"type": "agent_toolset_20260401"},
            *DASHCLAW_CUSTOM_TOOLS,
        ],
    )
    print(f"  Agent ID: {agent.id}")

    # 2. Create an environment
    print("Creating environment...")
    environment = client.beta.environments.create(
        name="dashclaw-governed-env",
        config={
            "type": "cloud",
            "packages": {"pip": ["requests"]},
            "networking": {"type": "unrestricted"},
        },
    )
    print(f"  Environment ID: {environment.id}")

    # 3. Start a session
    print("Starting session...")
    session = client.beta.sessions.create(
        agent=agent.id,
        environment_id=environment.id,
        title=f"Governed: {task[:50]}",
    )
    print(f"  Session ID: {session.id}")

    # 4. Track custom tool calls for result routing
    pending_tool_calls = {}

    # 5. Open stream and send the task
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
                # Agent is thinking/writing
                case "agent.message":
                    for block in event.content:
                        if hasattr(block, "text"):
                            print(block.text, end="")

                # Agent is using a built-in tool (bash, file ops, etc.)
                case "agent.tool_use":
                    print(f"\n  [Built-in tool: {event.name}]")

                # Agent is calling a DashClaw custom tool
                case "agent.custom_tool_use":
                    print(f"\n  [DashClaw: {event.name}]")
                    tool_input = event.input if isinstance(event.input, dict) else {}
                    handler = TOOL_HANDLERS.get(event.name)
                    if handler:
                        result = handler(tool_input)
                        pending_tool_calls[event.id] = json.dumps(result)
                        print(f"    -> {json.dumps(result, indent=2)[:200]}")
                    else:
                        pending_tool_calls[event.id] = json.dumps(
                            {"error": f"Unknown tool: {event.name}"}
                        )

                # Session paused — may need custom tool results
                case "session.status_idle":
                    stop = event.stop_reason
                    if stop and stop.type == "requires_action":
                        # Send results for all pending custom tool calls
                        events_to_send = []
                        for event_id in stop.event_ids:
                            result_text = pending_tool_calls.pop(event_id, '{"error": "no result"}')
                            events_to_send.append(
                                {
                                    "type": "user.custom_tool_result",
                                    "custom_tool_use_id": event_id,
                                    "content": [{"type": "text", "text": result_text}],
                                }
                            )
                        if events_to_send:
                            client.beta.sessions.events.send(
                                session.id, events=events_to_send
                            )
                    elif stop and stop.type == "end_turn":
                        print("\n\nAgent finished.")
                        break

                # Error
                case "session.error":
                    msg = event.error.message if hasattr(event, "error") and event.error else "unknown"
                    print(f"\n  [Error: {msg}]")

                case "session.status_terminated":
                    print("\n  [Session terminated]")
                    break

    # 6. Record the session completion in DashClaw
    dashclaw_record(
        action_type="managed_agent_session",
        declared_goal=f"Completed managed agent session: {task[:100]}",
        status="completed",
        risk_score=20,
        output_summary=f"Session {session.id} completed for agent {agent.id}",
    )

    print(f"\nSession complete. View governance trail at: {DASHCLAW_URL}/decisions")

    # 7. Cleanup
    try:
        client.beta.agents.archive(agent.id)
        client.beta.environments.archive(environment.id)
    except Exception:
        pass


# ── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    task = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "Research the x402 payment protocol. Before writing any findings to a file, "
        "check with DashClaw governance. Record your research outcome when done."
    )
    run_governed_session(task)
