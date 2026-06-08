---
name: instrument-agent
description: Integrate DashClaw SDK into any agent using the 4-step governance loop
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: integration
---

# Instrument Your Agent with DashClaw

Help developers add DashClaw governance to any AI agent. Walk through the 4-step governance loop with working code.

## The 4-Step Governance Loop

Every governed decision follows this deterministic flow:

```
1. Guard  → "Can I do this?"           (POST /api/guard)
2. Record → "I am doing this."         (POST /api/actions)
3. Verify → "I believe this is true."  (POST /api/assumptions)
4. Outcome → "This was the result."    (PATCH /api/actions/:id)
```

## Step 0: Install & Initialize

### Node.js
```bash
npm install dashclaw
```

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
});
```

### Python
```bash
pip install dashclaw
```

```python
from dashclaw import DashClaw

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="my-agent"
)
```

## Step 0.5: Session Lifecycle (Optional but Recommended)

Create a session to track the full lifecycle of your agent's work. Sessions enable monitoring, recovery, and continuity across restarts.

```javascript
// Create a session at agent startup
const session = await fetch(`${baseUrl}/api/sessions`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agent_id: 'my-agent', metadata: { task: 'deploy-pipeline' } })
}).then(r => r.json());

// Report status during execution
await fetch(`${baseUrl}/api/sessions/${session.id}`, {
  method: 'PATCH',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'running', checkpoint: { step: 'guard-check' } })
});
```

Session lifecycle is optional — all governance loop steps work without it — but it provides visibility into long-running agent tasks and enables automatic recovery when sessions are interrupted.

## Step 1: Guard — Check Policy Before Acting

```javascript
const decision = await claw.guard({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  risk_score: 85,
  systems_touched: ['production', 'database'],
  reversible: false
});

// decision.decision: 'allow' | 'warn' | 'block' | 'require_approval'
if (decision.decision === 'block') {
  console.log('Blocked:', decision.reason);
  return;
}
```

```python
decision = claw.guard(
    action_type="deploy",
    declared_goal="Deploy build #402 to production",
    risk_score=85,
    systems_touched=["production", "database"],
    reversible=False
)

if decision["decision"] == "block":
    print(f"Blocked: {decision['reason']}")
    return
```

**Guard response shape:**
```json
{
  "decision": "require_approval",
  "action_id": "act_gd_abc123",
  "reason": "Risk score exceeds org threshold",
  "signals": ["Production access", "High risk score"],
  "risk_score": 75,
  "agent_risk_score": 85,
  "recovery_recipes": [
    { "action": "reduce_scope", "description": "Deploy to staging first" }
  ]
}
```

### Guard Policy Types to Handle

The guard may enforce these policy types — your agent should be prepared to respond to each:

- **`permission_escalation`** — The action requires a higher `permission_level` than currently granted. Re-request with elevated permissions or abort.
- **`green_contract`** — The action requires test verification before execution (e.g., tests must pass before deploying). Run tests and include evidence in the guard request.
- **`branch_freshness`** — The action targets a stale branch. Pull latest changes or rebase before retrying.

When the guard blocks an action, check the `recovery_recipes` array in the response for actionable remediation steps.

## Step 2: Record — Log the Action

```javascript
const action = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402 to production',
  risk_score: 85,
  reversible: false,
  systems_touched: ['production']
});
// action.action_id: 'ar_abc123'
```

```python
action = claw.create_action(
    action_type="deploy",
    declared_goal="Deploy build #402 to production",
    risk_score=85,
    reversible=False,
    systems_touched=["production"]
)
```

## Step 3: Verify — Record Assumptions

```javascript
await claw.recordAssumption({
  action_id: action.action_id,
  assumption: 'Staging tests passed successfully',
  source: 'ci-pipeline'
});
```

```python
claw.record_assumption(
    action_id=action["action_id"],
    assumption="Staging tests passed successfully",
    source="ci-pipeline"
)
```

## Step 4: Outcome — Record the Result

```javascript
await claw.updateOutcome(action.action_id, {
  status: 'completed',        // or 'failed'
  output_summary: 'Build #402 deployed successfully to production',
  timestamp_end: new Date().toISOString(),
  // Optional — populates Analytics cost/token charts. When tokens + model
  // are supplied without an explicit cost_estimate, the server derives
  // cost from the configured pricing table.
  tokens_in: result.usage?.input_tokens,
  tokens_out: result.usage?.output_tokens,
  model: result.model,
});
```

```python
claw.update_outcome(action["action_id"],
    status="completed",
    output_summary="Build #402 deployed successfully to production",
    # Optional — populates Analytics cost/token charts.
    tokens_in=response.usage.input_tokens,
    tokens_out=response.usage.output_tokens,
    model=response.model,
)
```

## Complete Example

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'deploy-agent'
});

async function governedDeploy(buildId) {
  // 1. Guard
  const decision = await claw.guard({
    action_type: 'deploy',
    declared_goal: `Deploy build #${buildId} to production`,
    risk_score: 85,
    systems_touched: ['production'],
    reversible: false
  });

  if (decision.decision === 'block') {
    console.log('Blocked:', decision.reason);
    return;
  }

  // 2. Record
  const action = await claw.createAction({
    action_type: 'deploy',
    declared_goal: `Deploy build #${buildId} to production`,
    risk_score: 85,
    reversible: false
  });

  // 3. Verify assumptions
  await claw.recordAssumption({
    action_id: action.action_id,
    assumption: 'All CI checks passed'
  });

  // 4. Execute and record outcome
  try {
    await actualDeploy(buildId);
    await claw.updateOutcome(action.action_id, {
      status: 'completed',
      output_summary: `Build #${buildId} deployed successfully`
    });
  } catch (err) {
    await claw.updateOutcome(action.action_id, {
      status: 'failed',
      output_summary: err.message
    });
  }
}
```

## Action Type & Risk Score Guide

| Action Type | Risk Score | Reversible | Example |
|------------|-----------|------------|---------|
| deploy | 75-90 | false | Production deployment |
| api_call | 20-40 | true | External API request |
| file_write | 15-30 | true | Local file modification |
| database | 50-80 | false | Schema migration, data deletion |
| security | 80-95 | false | Key rotation, permission changes |
| build | 10-25 | true | npm install, compilation |
| notify | 5-15 | true | Send email, Slack message |

**Risk scoring rule:** DashClaw uses the HIGHER of computed risk and agent-reported risk. Always report honestly — inflating risk is better than under-reporting.

## HITL Approval Flow

When guard returns `require_approval`:

```javascript
if (decision.decision === 'require_approval') {
  console.log('Waiting for human approval...');
  await claw.waitForApproval(decision.action_id, {
    timeout: 300000  // 5 minutes
  });
  // Continues after approval, throws ApprovalDeniedError if denied
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DASHCLAW_BASE_URL` | Yes | DashClaw instance URL |
| `DASHCLAW_API_KEY` | Yes | API authentication key |
| `DASHCLAW_AGENT_ID` | No | Default agent identifier |

## Validation

After instrumenting, drive a real end-to-end check against your DashClaw instance with the live SDK smoke test:

```bash
# Node SDK round-trip (guard → createAction → updateOutcome)
node scripts/_run-with-env.mjs scripts/test-sdk-live.mjs

# Python equivalent
node scripts/_run-with-env.mjs scripts/run-sdk-live-python.mjs

# Or just confirm the instance is reachable
curl -sf "$DASHCLAW_BASE_URL/api/health" | jq '.status'
```

Then refresh `/decisions` on your DashClaw instance — your most recent governed action should appear within seconds.
