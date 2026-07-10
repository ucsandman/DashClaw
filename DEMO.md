# DashClaw Demo: Market Intelligence Briefing

A full-stack demo that exercises every major DashClaw feature in one workflow execution.

> Looking for the **1-minute intro demo** instead? That's `npx dashclaw-demo` (Docker-based, no instance needed — blocks a simulated deploy and opens Decision Replay); see [QUICK-START.md](./QUICK-START.md). This page is the deeper walkthrough for a **running instance**: capabilities, policies, knowledge collections, and the workflow engine.

## What It Creates

| Feature | What's Seeded |
|---|---|
| Knowledge Collection | 3 strategy documents (roadmap, competitors, markets) |
| Capabilities | 5 real HTTP APIs at different risk levels |
| Policies | 3 guard policies (auto-allow, warn, require approval) |
| Model Strategy | Balanced analysis strategy (Claude Sonnet) |
| Workflow Template | 5-step "Daily Market Briefing" |

## Prerequisites

1. DashClaw running locally: `npm run dev`
2. API key configured (check `/setup` page)

## Run the Demo

### Step 1: Seed demo data

```bash
node scripts/seed-demo-capabilities.mjs
```

This creates the knowledge collection, 5 capabilities, 3 policies, a model strategy, and the workflow template. Safe to re-run (idempotent).

### Step 2: Execute the workflow

Open your DashClaw instance and navigate to **Workflows**. Find "Daily Market Briefing" and click **Run**.

Or execute via API:

```bash
curl -X POST http://localhost:3000/api/workflows/templates/<TEMPLATE_ID>/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"agent_id": "demo-agent"}'
```

### Step 3: Watch Approvals

Open `/approvals` and watch the operations feed in real-time as the five steps run:

1. **Knowledge Search** — Searches your strategy docs (internal, no governance)
2. **HN News Fetch** — Calls the real Hacker News API
3. **LLM Analysis** — Runs via model strategy, produces the briefing
4. **Team Notification** — Posts to the demo notification endpoint
5. **Publish Briefing** — Posts to the demo publish endpoint (`jsonplaceholder.typicode.com/posts`)

Governance here is **workflow-grained, not step-grained**: the execute route runs one
guard evaluation for the whole run (`action_type: workflow_execute`, risk 50) before
any step starts. A `block` decision stops the run with 403; `require_approval` holds
the entire run as a pending approval (202) before anything executes. Under the seeded
policies (allow ≥ 30, warn ≥ 55, require approval ≥ 75) the risk-50 run is allowed,
so all five steps execute and each step's output is recorded as an action with its
artifacts. Per-step guard evaluation inside a workflow run is not implemented yet —
the honest map of what is enforced where is
[`docs/architecture/enforcement-boundary.md`](docs/architecture/enforcement-boundary.md).

### Step 4: See the approval gate fire (direct capability invoke)

Per-capability governance *is* step-grained on the direct invoke path. The seeded
**Publish Briefing** capability is `risk_level: high` (risk 75), which meets the
seeded "Require Approval for Publishing" policy (threshold 75):

```bash
# capability id printed by the seed script, or copy it from /capabilities
curl -X POST http://localhost:3000/api/capabilities/<CAPABILITY_ID>/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"agent_id": "demo-agent", "input": {"title": "Demo briefing", "body": "hello"}}'
```

The call returns `202 pending_approval` and the action appears in **Approvals**:

- **Approve**, then run the same invoke again — a HITL approval covers an identical
  re-invoke (same agent, goal, and action type) for 15 minutes, so the retry passes
  and the capability executes.
- **Deny** — the action resolves as denied; nothing executes.

### Step 5: Review the trail

Open **Decisions** to see the full audit trail: the workflow-level guard evaluation, the held-then-approved capability invoke, every action record, and every artifact captured from each workflow step.

## What This Exercises

| DashClaw Feature | How |
|---|---|
| Knowledge Collections | Semantic search in Step 1 |
| Capability Registry | 5 HTTP APIs at different risk levels |
| Capability Invoke | Steps 2, 4, 5 call real external APIs |
| Workflow Engine | All 3 step types (knowledge_search, capability_invoke, prompt) |
| Workflow Variables | `${steps.search_strategy.output}` in Step 3 |
| Guard Evaluation | One workflow-level evaluation (risk 50 → allow); block/require_approval gate the whole run |
| HITL Approvals | Direct invoke of the high-risk publish capability holds at 202 for human decision |
| Model Strategies | Step 3 uses configured analysis strategy |
| Artifacts | Each step output auto-captured |
| Policies | 3 threshold policies at different levels |
| continue_on_failure | Workflow completes even if publish denied |
| Approvals | Real-time operations feed |
| Decisions Ledger | Full audit trail |

## Troubleshooting

**"Cannot reach DashClaw"** — Make sure `npm run dev` is running and the URL is correct.

**Knowledge search returns empty** — Embeddings require an OpenAI key configured in org settings. The workflow still runs; the analysis step just won't have strategy context.

**"Model strategy execution failed"** — The prompt step requires a BYOK provider key (Anthropic or OpenAI) in org settings. Configure at `/settings`.
