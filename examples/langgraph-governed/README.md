# LangGraph + DashClaw Governance Example

A minimal example showing how to govern a LangGraph agent's tool calls with DashClaw.

## Prerequisites

- Python 3.10+
- A running DashClaw instance (deploy via the [Vercel button](https://github.com/ucsandman/DashClaw#deploy) or run locally)
- `DASHCLAW_BASE_URL` and `DASHCLAW_API_KEY` from your DashClaw instance

## Setup

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your DashClaw credentials:
   ```bash
   cp .env.example .env
   ```

4. Run the example:
   ```bash
   python main.py
   ```

5. Open your DashClaw dashboard at `/decisions` to see the governed action.

## What it does

This example creates a simple LangGraph StateGraph with two nodes:
- **governance_node**: Calls DashClaw guard, records the action, and reports the outcome
- **research_node**: Simulates researching a topic (LLM output is simulated — no OPENAI_API_KEY needed)

The governance node runs first, checks policy, then the research node executes if allowed.

## Note

This example uses the DashClaw Python SDK directly (`from dashclaw import DashClaw`),
governing the graph with the core methods (`guard`, `create_action`,
`wait_for_approval`, `update_outcome`) — the intercept → decide → approve → prove loop.

## What's Governed

| DashClaw Feature | Graph Node |
|---|---|
| **Guard** | `governance` — policy check with conditional routing |
| **Action Recording** | `governance` — records intent with risk score |
| **HITL Approval** | `approval` — waits for human decision (SSE-powered) |
| **Assumptions** | `research` — records reasoning basis |
| **Outcome Tracking** | `outcome` / `abort` — reports success or cancellation |

### Graph Structure

```
governance → [allow] → research → outcome → END
           → [require_approval] → approval → [approved] → research → outcome → END
                                            → [denied] → abort → END
           → [blocked] → abort → END
```

This demonstrates LangGraph's conditional routing integrated with DashClaw governance decisions.
