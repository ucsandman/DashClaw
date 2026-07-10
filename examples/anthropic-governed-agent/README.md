# DashClaw + Anthropic Claude SDK: Deployment Agent

A governed AI agent that analyzes deployment readiness, checks service health, and deploys to production — but only after a human operator approves the action in DashClaw Approvals.

## What This Demonstrates

1. **Real Agent Reasoning** — Claude analyzes the deployment manifest, checks each service's health, identifies risks (degraded user-service), and decides whether to proceed
2. **Tool Use Loop** — The agent uses tools (`check_deployment_manifest`, `check_service_health`, `deploy_to_production`) in a multi-turn agentic conversation
3. **DashClaw Guard** — The `deploy_to_production` tool call is intercepted for policy evaluation
4. **Human-in-the-Loop** — The agent pauses and waits for operator approval via `waitForApproval()`
5. **Evidence Trail** — Intent, assumptions, and outcome are recorded in DashClaw

## Prerequisites

1. A running DashClaw instance (`npm run dev` in the project root)
2. A DashClaw API key (get one at `/settings`)
3. An Anthropic API key
4. Node.js 20+

## Quick Start

```bash
cd examples/anthropic-governed-agent
npm install
cp .env.example .env
# Edit .env with your API keys
node index.js
```

## Expected Flow

```
=== Deployment Agent ===

Let me check the deployment manifest first...
[Tool] check_deployment_manifest({})
  -> { build: "v2.1.0-rc3", target: "production", ... }

Now let me check the health of each affected service...
[Tool] check_service_health({"service_name":"api-gateway"})
  -> { status: "healthy", cpu: 45, memory: 62 }
[Tool] check_service_health({"service_name":"auth-service"})
  -> { status: "healthy", cpu: 30, memory: 48 }
[Tool] check_service_health({"service_name":"user-service"})
  -> { status: "degraded", cpu: 88, memory: 91 }

The user-service is degraded with high resource usage, but the
deployment includes a performance optimization fix. Proceeding.
[Tool] deploy_to_production({...})

--- DashClaw Governance ---

Checking deployment policy...
Decision: REQUIRE_APPROVAL

WAITING FOR HUMAN APPROVAL...
  Approve at: http://localhost:3000/approvals

Approved by operator!
Deploying...

Deployment agent complete.
```

## The Governance Loop

```
Agent Checks Manifest --> Agent Checks Health --> Agent Decides to Deploy
                                                          |
                                                   DashClaw Guard
                                                          |
                                        +-----------------+-----------+
                                        v                 v           v
                                     ALLOW          REQUIRE_APPROVAL BLOCK
                                        |                 |           |
                                        |         Human Approves?     x
                                        |           v         v
                                        |         Yes        No -> x
                                        v           |
                                   Deploy <---------+
                                        |
                                   Record Outcome
```
