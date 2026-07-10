# Claude Managed Agent + DashClaw Governance

Run a Claude Managed Agent with DashClaw as the governance and observability layer. Every significant action is guarded, recorded, and visible in Approvals.

## How It Works

The managed agent runs autonomously in Anthropic's cloud infrastructure with full access to bash, file I/O, and web search. But for governed actions (external APIs, deploys, data modifications), it goes through DashClaw:

```
Agent wants to call external API
  -> calls dashclaw_guard (custom tool)
    -> DashClaw evaluates policies
      -> allow: agent proceeds
      -> block: agent stops
      -> require_approval: operator decides in Approvals
  -> calls dashclaw_invoke (custom tool)
    -> DashClaw executes the capability through its governance loop
    -> Guard, execute, record, return result
  -> calls dashclaw_record (custom tool)
    -> DashClaw creates an auditable action record
```

## What's Governed

| Action | Governance | Tool |
|---|---|---|
| File I/O, bash, web search | Ungoverned (built-in agent tools) | `agent_toolset_20260401` |
| External API calls | Guarded + recorded | `dashclaw_invoke` |
| Risky system modifications | Policy-checked first | `dashclaw_guard` |
| Significant decisions | Logged for audit | `dashclaw_record` |

## Setup

```bash
cd examples/managed-agent-governed
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your Anthropic API key and DashClaw instance URL
```

## Run

```bash
# Default task (research x402 protocol)
python main.py

# Custom task
python main.py "Analyze our API performance data and generate a report. Check governance before writing to production."
```

## Watch It Live

While the agent runs, open your DashClaw instance:

- **Decisions** (`/decisions`) — full audit trail of every governed action
- **Capabilities** (`/capabilities`) — if you registered external APIs as capabilities, see invocation history
- **Approvals** (`/approvals`) — if a guard decision requires approval, it shows up here

## Custom Tools Registered

### `dashclaw_guard`
Evaluates DashClaw policies before a risky action. The agent calls this before any action with risk > 50 or that modifies external systems.

### `dashclaw_invoke`
Invokes a DashClaw-governed capability (external API). The full governance loop runs automatically: guard evaluation, execution, outcome recording.

### `dashclaw_record`
Logs a significant action to DashClaw's audit trail. Used for decisions, completed research, analysis outcomes.

## Next Steps

- Register your external APIs as DashClaw capabilities at `/capabilities/new`
- Create policies at `/policies` to control which agents can do what
- Set up capability access rules to restrict which agents can invoke which APIs
- Watch the operations feed in Approvals for real-time governance visibility
