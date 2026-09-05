# OpenAI Deploy Pipeline

An OpenAI-powered agent simulating a CI/CD pipeline. It runs pre-flight checks, evaluates deployment readiness with GPT-4o-mini, and attempts to trigger a production deploy. The deploy step has `risk_score: 85` and `reversible: false`, so your policies may require approval or block it.

This is the "terminal-first DevOps" governance scenario. The entire approval flow happens in the terminal without opening a browser.

> **Trust boundary:** The source uses lower-level cooperative SDK calls and does
> not claim protocol-1 execution authority. The rolling deploy stays simulated.
> Put any real deployment inside `runGoverned(act, params, callback)`.

## What happens

1. Pre-flight checks run (hardcoded pass: 847 tests, 94.2% coverage, 0 CVEs)
2. An AI readiness assessment evaluates whether to proceed
3. DashClaw guard check fires on the deploy action (risk 85, irreversible)
4. An action record is created with a replay link
5. If `require_approval`, the agent prints the approval block and waits up to 120 seconds
6. On approval, a simulated rolling deploy runs with pod-by-pod progress output
7. The final outcome is recorded in DashClaw

## Prerequisites

- Node.js 20+
- A running DashClaw instance (local or cloud)
- `DASHCLAW_API_KEY` from your instance
- (Optional) `OPENAI_API_KEY` for real GPT-4o-mini assessments. Without it, the agent uses simulated output.

## Setup

```bash
cd examples/openai-deploy-pipeline
cp .env.example .env
# Edit .env with your keys
npm install
```

## Run

```bash
node index.js
```

## Two-terminal demo

This is the recommended way to demonstrate the cooperative approval and evidence loop:

**Terminal 1** (the agent):
```bash
cd examples/openai-deploy-pipeline
node index.js
# Agent runs pre-flight, hits the gate, prints approval block, and waits
```

**Terminal 2** (the operator):
```bash
# Copy the action ID from the approval block in Terminal 1
dashclaw approve act_<id> --reason "Reviewed, safe to deploy"
```

Terminal 1 detects the approval within 3 seconds, runs the simulated deploy, and prints the audit trail URL.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| DASHCLAW_BASE_URL | Yes | http://localhost:3000 | Your DashClaw instance |
| DASHCLAW_API_KEY | Yes | none | Operator API key |
| OPENAI_API_KEY | No | none | Enables real GPT-4o-mini assessment |
| TARGET_ENV | No | production | Deploy target environment |
| SERVICE_NAME | No | auth-service-v2 | Service being deployed |

## Replay

Every governed action gets a permanent replay URL:

```
http://localhost:3000/replay/<actionId>
```

This page shows the guard policy, pre-flight results, AI assessment, risk score, and deploy outcome.
