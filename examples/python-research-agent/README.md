# Python Research Agent

A Python agent that researches a topic, fetches content from sources, and writes a report file. Governance fires on the file write step. This example uses the Python SDK and requires no AI API key. The "research" is simulated with hardcoded content so the example focuses purely on the governance flow.

> **Trust boundary:** The source uses lower-level cooperative SDK calls and does
> not claim protocol-1 execution authority. Its research and report write stay
> simulated. Put a real file or network effect inside `run_governed`.

## What happens

1. A guard check permits the research phase (low risk, read-only)
2. The agent "fetches" four sources with realistic progress output
3. A second guard check fires before writing the report (risk 40, filesystem write)
4. An action record is created with a replay link
5. If `require_approval`, the agent prints the approval block and waits 60 seconds
6. On approval the report write is simulated; on denial the agent exits cleanly
7. The final outcome is recorded in DashClaw

## Prerequisites

- Python 3.10+
- A running DashClaw instance (local or cloud)
- `DASHCLAW_API_KEY` from your instance
- No AI API key needed

## Setup

```bash
cd examples/python-research-agent
cp .env.example .env
# Edit .env with your keys
pip install -r requirements.txt
```

## Run

```bash
python agent.py
```

## Approving from a second terminal

When the agent prints the approval block, open a second terminal and run:

```bash
dashclaw approve <actionId shown in the approval block>
```

Or deny:

```bash
dashclaw deny <actionId> --reason "Report topic not approved"
```

The agent detects the decision within 3 seconds and proceeds or exits.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| DASHCLAW_BASE_URL | Yes | http://localhost:3000 | Your DashClaw instance |
| DASHCLAW_API_KEY | Yes | none | Operator API key |
| RESEARCH_TOPIC | No | AI agent governance patterns | Topic to research |

## Replay

Every governed action gets a permanent replay URL:

```
http://localhost:3000/replay/<actionId>
```

This page shows the guard policy, the agent's declared goal, risk score, and write outcome.
