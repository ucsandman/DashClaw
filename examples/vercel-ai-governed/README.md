# Vercel AI SDK + DashClaw Governance Example

A minimal example showing how to govern Vercel AI SDK tool calls with DashClaw using the 4-step governance loop. A generic `governed()` wrapper turns any AI SDK tool's `execute` function into a governed one.

## Prerequisites

- Node.js 20+
- A running DashClaw instance (deploy via the [Vercel button](https://github.com/ucsandman/DashClaw#deploy) or run locally)
- `DASHCLAW_BASE_URL` and `DASHCLAW_API_KEY` from your DashClaw instance

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your DashClaw credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the example:
   ```bash
   npm start
   ```

4. Open your DashClaw dashboard at `/decisions` to see the governed actions.

## What It Does

Two AI SDK tools (`lookupOrder`, `refundOrder`) get governed `execute` functions:
1. **Order lookup** (low risk) — guard allows, action recorded
2. **Refund** (high risk) — guard may require approval or block based on your policies

The governance flow is real; the refund itself is simulated, so no LLM API key is required — the demo invokes the tools' `execute` directly, exactly the way `generateText`'s tool-call step would. The commented `generateText` block in `index.mjs` shows the production wiring (`tools: { refundOrder, lookupOrder }`).

## The 4-Step Governance Loop

1. **guard** — policy check before execution (allow / warn / require_approval / block)
2. **createAction** — declare intent in the decision ledger
3. **recordAssumption / waitForApproval** — evidence and HITL when required
4. **updateOutcome** — close the loop with the result
