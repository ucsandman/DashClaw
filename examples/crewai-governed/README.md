# CrewAI + DashClaw Governance Example

A minimal example showing how to place CrewAI `@tool` callbacks behind
DashClaw's canonical `run_governed` helper. The tool bodies are simulations and
do not access customer data or publish an external report.

## Prerequisites

- Python 3.10+ (required by crewai — Python 3.14+ is not supported)
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

This example creates two CrewAI tools using the `@tool` decorator pattern.
Each tool passes its exact act and callback to `run_governed`, which evaluates
current policy, records one action, waits when required, claims one execution
attempt, and reports the outcome.

No OPENAI_API_KEY is needed — the example runs the governance flow directly
without requiring an LLM provider.

## What's Governed

| DashClaw Feature | How It's Used |
|---|---|
| **Guard** | Current policy check against the exact act before each tool callback |
| **Action Recording** | Both tools record intent with risk scores and systems_touched |
| **HITL Approval** | High-risk tools wait for human approval when policy requires it |
| **Execution Claim** | Protocol 1 claims one exact attempt before the callback |
| **Outcome Tracking** | Callback failure and completion confirmation are reported separately |
| **Multi-Tool Governance** | Two tools with different risk profiles show graduated governance |

## Note

This example uses the DashClaw Python SDK directly (`from dashclaw import DashClaw`).
Framework task callbacks are cooperative policy and audit hooks. Keep real
external effects behind `run_governed` as shown here.
