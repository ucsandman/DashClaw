# DashClaw SDK Reference (V2)

Zero-dependency clients for Node.js and Python. Full v2 method catalogue lives in `sdk/README.md` (Node) and `sdk-python/README.md` (Python).

## Installation

```bash
# Node.js
npm install dashclaw

# Python
pip install dashclaw
```

## Constructor

### Node.js
```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,   // Required
  apiKey: process.env.DASHCLAW_API_KEY,      // Required
  agentId: 'my-agent'                        // Required
});
```

### Python
```python
from dashclaw import DashClaw

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="my-agent"
)
```

## Core Methods (5)

### 1. guard(context) — Check Policy

```javascript
const decision = await claw.guard({
  action_type: 'deploy',          // Required
  declared_goal: 'Deploy v2',     // Required — intent documentation
  risk_score: 85,                 // 0-100
  systems_touched: ['production'],// Array of system names
  reversible: false               // Is this undoable?
});
// Returns: { decision, action_id, reason, signals, risk_score, agent_risk_score }
```

```python
decision = claw.guard(
    action_type="deploy",
    declared_goal="Deploy v2",
    risk_score=85,
    systems_touched=["production"],
    reversible=False
)
```

**decision values:** `allow`, `warn`, `block`, `require_approval`

### 2. createAction(action) — Record Intent

```javascript
const action = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy build #402',
  risk_score: 85,
  reversible: false,
  systems_touched: ['production'],
  cost_estimate: 0.50,           // Optional
  parent_action_id: null         // Optional — for swarm/sub-actions
});
// Returns: { action_id, status, timestamp_start }
```

```python
action = claw.create_action(
    action_type="deploy",
    declared_goal="Deploy build #402",
    risk_score=85,
    reversible=False
)
```

### 3. recordAssumption(assumption) — Track Reasoning

```javascript
await claw.recordAssumption({
  action_id: 'ar_abc123',         // Required
  assumption: 'CI tests passed',  // Required
  source: 'ci-pipeline'           // Optional
});
```

```python
claw.record_assumption(
    action_id="ar_abc123",
    assumption="CI tests passed",
    source="ci-pipeline"
)
```

### 4. updateOutcome(actionId, outcome) — Record Result

```javascript
await claw.updateOutcome('ar_abc123', {
  status: 'completed',            // 'completed' or 'failed'
  output_summary: 'Deployed successfully',
  timestamp_end: new Date().toISOString()
});
```

```python
claw.update_outcome("ar_abc123", {
    "status": "completed",
    "output_summary": "Deployed successfully"
})
```

### 5. waitForApproval(actionId, options) — HITL Polling

```javascript
try {
  await claw.waitForApproval('ar_abc123', {
    timeout: 300000  // 5 minutes
  });
  // Approved — proceed
} catch (err) {
  if (err instanceof ApprovalDeniedError) {
    // Denied — abort
  }
}
```

```python
try:
    claw.wait_for_approval("ar_abc123", timeout=300000)
except ApprovalDeniedError as e:
    print(f"Denied: {e}")
```

## Additional Methods

### getAction(actionId)
```javascript
const action = await claw.getAction('ar_abc123');
```

### getPendingApprovals(options)
```javascript
const pending = await claw.getPendingApprovals({ limit: 50, offset: 0 });
```

### approveAction(actionId, decision, reasoning)
```javascript
await claw.approveAction('ar_abc123', 'approved', 'Reviewed and safe');
```

### registerOpenLoop(actionId, type, description)
```javascript
await claw.registerOpenLoop('ar_abc123', 'dependency', 'Waiting for DB migration');
```

### getSignals()
```javascript
const signals = await claw.getSignals();
```

### heartbeat(options)
```javascript
await claw.heartbeat({ status: 'online', metadata: { version: '1.0.0' } });
```

## Error Types

### GuardBlockedError
Thrown when guard blocks an action (guardMode='enforce'):
```javascript
try {
  await claw.guard({ ... });
} catch (err) {
  if (err instanceof GuardBlockedError) {
    console.log(err.decision);        // 'block'
    console.log(err.reasons);         // ['Risk too high']
    console.log(err.riskScore);       // 85
    console.log(err.matchedPolicies); // [{ name: 'high-risk-blocker' }]
  }
}
```

### ApprovalDeniedError
Thrown when an operator denies an action:
```javascript
try {
  await claw.waitForApproval(actionId);
} catch (err) {
  if (err instanceof ApprovalDeniedError) {
    console.log(err.message); // 'Action denied: Risk too high'
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DASHCLAW_BASE_URL` | Yes | DashClaw instance URL |
| `DASHCLAW_API_KEY` | Yes | API authentication key |
| `DASHCLAW_AGENT_ID` | No | Default agent identifier |

## Legacy SDK Access

For the full 187-method surface (v1):
```javascript
import { DashClaw } from 'dashclaw/legacy';
```

See `legacy-sdk-reference.md` for the complete v1 method inventory.
