# Vercel AI SDK + DashClaw Governance Example

A minimal example showing how to put Vercel AI SDK tool callbacks behind
DashClaw's canonical `runGoverned()` helper. A generic `governed()` wrapper
binds each tool's exact act to its `execute` function.

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
1. **Order lookup** (low risk): current policy is evaluated and one action is recorded.
2. **Refund** (high risk): policy may require approval or block the callback.

The governance flow is real. The lookup and refund are simulated, so no LLM API
key is required and no external effect occurs. The demo invokes the tools'
`execute` functions directly, the same entry point used by `generateText`.

## The Governed Helper

1. Evaluate current policy against the exact tool act and persist one action.
2. Wait if policy requires approval.
3. Claim one protocol-1 execution attempt for the action, agent, and act.
4. Run the callback and report its outcome. Completion uncertainty is not reported as callback failure.
