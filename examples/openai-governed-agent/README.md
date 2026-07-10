# DashClaw: OpenAI Governed Agent Starter

Connect your first real agent to DashClaw and govern its actions in under 5 minutes.

## The Goal
See DashClaw intercept, govern, and record evidence for a "Real World" agent operation: **Sending a customer refund notification.**

## Prerequisites
1. A running DashClaw instance (Run `npm run dev` in the root).
2. A DashClaw API Key (Get one at `/settings` in your local instance).
3. Node.js 18+.

## Quick Start

```bash
# 1. Enter the starter directory
cd examples/openai-governed-agent

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env
# Edit .env and add your DASHCLAW_API_KEY
```

## Run the Agent

```bash
node index.js
```

## What This Proves
1. **Governance Before Execution**: `claw.guard()` checks policies *before* the email is sent.
2. **Permissioned Autonomy**: If a policy requires approval, the agent pauses until a human operator unblocks it.
3. **Verifiable Evidence**: Every step (intent, assumptions, outcomes) is recorded in DashClaw for debugging and compliance.

## Expected Outcome
- **Allowed**: The agent completes the flow and prints a Replay URL.
- **Blocked**: If you create a policy in DashClaw to block `email_customer` actions with high risk, the agent will stop.
- **Approval**: If a policy matches with `require_approval`, the agent will poll until you approve it in the **Approvals** dashboard.

## Dashboard View
Open DashClaw at `http://localhost:3000` to see:
- **Activity**: The real-time stream of your agent's intents.
- **Replay**: Deep-dive into the reasoning and assumptions of any action.
- **Approvals**: The queue for high-risk actions requiring human review.
