# DashClaw + OpenAI Agents SDK: PII Cleanup Agent

A governed AI agent that scans a database for personally identifiable information and deletes it — but only after a human operator approves the action in DashClaw Approvals.

## What This Demonstrates

1. **Real Agent Reasoning** — The OpenAI Agents SDK drives multi-step tool use (scan, analyze, propose, delete)
2. **DashClaw Guard** — Policy evaluation gates the destructive action before it executes
3. **Human-in-the-Loop** — The agent pauses and waits for operator approval via `waitForApproval()`
4. **Evidence Trail** — Every step (intent, assumptions, outcome) is recorded in DashClaw

## Prerequisites

1. A running DashClaw instance (`npm run dev` in the project root)
2. A DashClaw API key (get one at `/settings`)
3. An OpenAI API key
4. Node.js 20+

## Quick Start

```bash
cd examples/openai-agents-governed
npm install
cp .env.example .env
# Edit .env with your API keys
node index.js
```

## Expected Flow

```
=== PII Cleanup Agent ===

Phase 1: Agent scanning database...

Agent Analysis:
  Found 2 records with SSN data (rec_001: Jane Doe, rec_003: Bob Smith)

--- DashClaw Governance ---

Checking deletion policy via DashClaw Guard...
Decision: REQUIRE_APPROVAL

Action recorded: act_xxxxx

WAITING FOR HUMAN APPROVAL...
  Approve at: http://localhost:3000/approvals

Approved by operator! Proceeding with deletion...

Deleting PII records...
  Deleted 2 records. 2 clean records remaining.

Cleanup complete. Evidence recorded in DashClaw.
```

## The Governance Loop

```
Agent Scans DB ──> DashClaw Guard ──> Policy Check
                                          |
                        +-----------------+-----------------+
                        v                 v                 v
                     ALLOW          REQUIRE_APPROVAL      BLOCK
                        |                 |                 |
                        |         Human Approves?           x
                        |           v         v
                        |         Yes        No -> x
                        v           |
                   Execute <--------+
                        |
                   Record Outcome
```
