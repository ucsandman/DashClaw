# Pydantic AI + DashClaw Governance Example

A minimal Pydantic AI example showing DashClaw policy, approval, and audit calls
around simulated database migrations.

> **Trust boundary:** The source uses lower-level cooperative SDK calls and does
> not claim protocol-1 execution authority. Keep migrations simulated, or move
> a real effect into `run_governed(act, params, callback)`.

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

5. Open your DashClaw dashboard at `/decisions` to see the governed actions.

## What It Does

This example creates a cooperatively instrumented database-migration tool that runs twice:
1. **Staging migration** (low risk) — guard allows, action recorded with assumptions
2. **Production migration** (high risk) — guard may require approval or block based on your policies

The DashClaw policy and audit calls are real; the migration itself is simulated, so no LLM API key or database is required. The commented `Agent` wiring in `main.py` shows how the same cooperative function registers as a tool on a real Pydantic AI agent (`tools=[governed_run_migration]`), and how `TestModel` exercises the full agent loop in tests without an LLM key.

## The Cooperative 4-Step Flow

1. **guard** — policy check before execution (allow / warn / require_approval / block)
2. **create_action** — declare intent in the decision ledger
3. **record_assumption** — pin what the agent believes to be true
4. **update_outcome** — close the loop with the result
