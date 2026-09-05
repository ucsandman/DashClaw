# DashClaw: OpenAI Governed Agent Starter

Run a deployment simulation through DashClaw's canonical Node helper.

## The Goal
See one scrubbed deploy act stay bound to current policy, one persisted action,
optional approval, one execution claim, the callback, and outcome reporting.
The callback is a simulation. It does not deploy or write to an external system.

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
1. **Current policy before execution**: `runGoverned()` evaluates the exact deploy act and records it.
2. **One claimed attempt**: after any approval wait, protocol-1 execution authority is claimed immediately before the callback.
3. **Honest completion state**: callback failure and completion-report uncertainty are surfaced separately.

## Expected Outcome
- **Allowed**: The agent completes the flow and prints a Replay URL.
- **Blocked**: If you create a policy to block high-risk `deploy` actions, the callback will not run.
- **Approval**: If a policy matches with `require_approval`, the agent will poll until you approve it in the **Approvals** dashboard.

## Dashboard View
Open DashClaw at `http://localhost:3000` to see:
- **Activity**: The real-time stream of your agent's intents.
- **Replay**: Deep-dive into the reasoning and assumptions of any action.
- **Approvals**: The queue for high-risk actions requiring human review.
