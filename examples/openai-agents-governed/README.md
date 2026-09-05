# DashClaw + OpenAI Agents SDK: PII Cleanup Agent

An OpenAI Agents SDK example showing DashClaw policy, approval, and audit calls
around a simulated PII cleanup.

> **Trust boundary:** The source uses lower-level cooperative SDK calls and does
> not claim protocol-1 execution authority. Keep deletion simulated, or move a
> real effect into `runGoverned(act, params, callback)`.

## What This Demonstrates

1. **Real Agent Reasoning** — The OpenAI Agents SDK drives multi-step tool use (scan, analyze, propose, delete)
2. **DashClaw Guard** — The cooperative loop checks policy before the simulated deletion
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
              Simulated delete <----+
                        |
                   Record Outcome
```
