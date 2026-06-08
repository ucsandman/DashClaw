---
name: create-policies
description: Create and test DashClaw guard policies for agent governance
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: configuration
---

# Create Guard Policies

Help developers define, import, and test guard policies that control what agents can and cannot do.

## Policy Types

| Type | Purpose | Example |
|------|---------|---------|
| `risk_threshold` | Block/warn when risk score exceeds limit | Block actions with risk > 80 |
| `action_type_restriction` | Allow/deny specific action types | Block `security` actions without approval |
| `approval_gate` | Require human approval for matching actions | Require approval for deploys |
| `webhook_check` | Call external endpoint for policy decision | Check Jira ticket status before deploy |
| `semantic_guardrail` | LLM-based content analysis | Block PII in action metadata |

## Guard Modes

- **`off`** — No policy enforcement (development only)
- **`warn`** — Log policy violations but allow execution
- **`enforce`** — Block policy violations (production recommended)

## Defining Policies in YAML

### Risk Threshold Policy
```yaml
name: high-risk-blocker
type: risk_threshold
mode: enforce
conditions:
  risk_score_min: 80
  reversible: false
action: block
reason: "Irreversible actions with risk >= 80 require manual execution"
```

### Action Type Restriction
```yaml
name: no-unattended-deploys
type: action_type_restriction
mode: enforce
conditions:
  action_types:
    - deploy
    - database
action: require_approval
reason: "Deploy and database actions require human approval"
```

### Approval Gate
```yaml
name: production-approval-gate
type: approval_gate
mode: enforce
conditions:
  systems_touched:
    - production
  risk_score_min: 50
action: require_approval
reason: "Production access with risk >= 50 requires approval"
```

### Cost Ceiling
```yaml
name: cost-ceiling
type: risk_threshold
mode: enforce
conditions:
  cost_estimate_max: 100.00
action: block
reason: "Actions exceeding $100 estimated cost are blocked"
```

### Content Filter
```yaml
name: no-secrets-in-metadata
type: semantic_guardrail
mode: enforce
conditions:
  scan_fields:
    - declared_goal
    - output_summary
  patterns:
    - "password"
    - "api_key"
    - "secret"
action: block
reason: "Sensitive data detected in action metadata"
```

## Importing Policies

### Via API
```javascript
// POST /api/policies
const response = await fetch(`${baseUrl}/api/policies`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.DASHCLAW_API_KEY
  },
  body: JSON.stringify({
    name: 'high-risk-blocker',
    type: 'risk_threshold',
    mode: 'enforce',
    conditions: { risk_score_min: 80, reversible: false },
    action: 'block',
    reason: 'Irreversible high-risk actions are blocked'
  })
});
```

### Via Legacy SDK Policy Packs
```javascript
import { DashClaw } from 'dashclaw/legacy';

const claw = new DashClaw({ baseUrl, apiKey, agentId });

// Import a preset pack
await claw.importPolicies({ pack: 'enterprise-strict' });
// Available packs: enterprise-strict, smb-safe, startup-growth, development
```

## Testing Policies

### Test a Single Policy
```javascript
// POST /api/policies/test
const result = await fetch(`${baseUrl}/api/policies/test`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.DASHCLAW_API_KEY
  },
  body: JSON.stringify({
    action_type: 'deploy',
    risk_score: 85,
    reversible: false,
    systems_touched: ['production']
  })
});

// Response: which policies would trigger and what decisions they'd produce
```

### Test All Policies (Legacy SDK)
```javascript
const results = await claw.testPolicies();
// Returns pass/fail for each policy with explanation
```

### Generate Proof Report
```javascript
const report = await claw.getProofReport({ format: 'md' });
// Generates compliance-ready report showing all policies and their test results
```

## Common Policy Patterns

### Development Environment
```yaml
# Permissive — warn only, don't block
- name: dev-risk-warning
  type: risk_threshold
  mode: warn
  conditions: { risk_score_min: 50 }
  action: warn
  reason: "High risk action detected (dev mode — not blocked)"
```

### Production Environment
```yaml
# Strict — enforce everything
- name: prod-risk-gate
  type: risk_threshold
  mode: enforce
  conditions: { risk_score_min: 70 }
  action: require_approval

- name: prod-deploy-gate
  type: action_type_restriction
  mode: enforce
  conditions: { action_types: [deploy, database, security] }
  action: require_approval

- name: prod-irreversible-block
  type: risk_threshold
  mode: enforce
  conditions: { risk_score_min: 90, reversible: false }
  action: block
```

## Scoping Policies

Policies can be scoped to specific agents or apply org-wide:

```json
{
  "name": "deploy-agent-only",
  "agent_id": "deploy-agent-1",
  "type": "approval_gate",
  "conditions": { "action_types": ["deploy"] },
  "action": "require_approval"
}
```

If `agent_id` is omitted, the policy applies to all agents in the org.

## Listing Active Policies

```bash
# GET /api/policies
curl -H "x-api-key: $DASHCLAW_API_KEY" $DASHCLAW_BASE_URL/api/policies
```

Response includes all active policies with their type, mode, conditions, and scope.
