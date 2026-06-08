---
name: register-on-dashclaw
description: Register any agent (including this one) as a governed agent on a DashClaw instance
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: meta
---

# Register on DashClaw

Register any AI agent as a governed entity on a DashClaw instance. This includes the meta act of registering this very agent on DashClaw.

## Register an Agent

### Via API

```bash
curl -X POST "$DASHCLAW_BASE_URL/api/agents" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my-agent",
    "agent_name": "My Agent",
    "description": "What this agent does",
    "capabilities": ["deploy", "api_call", "file_write"]
  }'
```

### Via SDK

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
});

// Agent is auto-registered on first guard call or action creation
// Explicit registration is optional but recommended for metadata
```

## Set Up Heartbeat

Heartbeats let DashClaw know your agent is alive. Missing heartbeats trigger the "Agent Silent" signal (>10 min).

```javascript
// Single heartbeat
await claw.heartbeat({ status: 'online', metadata: { version: '1.0.0' } });

// Auto-heartbeat (v1 SDK)
import { DashClaw } from 'dashclaw/legacy';
const claw = new DashClaw({ baseUrl, apiKey, agentId: 'my-agent' });
claw.startHeartbeat({ interval: 60000 }); // Every 60 seconds

// Stop when shutting down
claw.stopHeartbeat();
```

```python
# Python
claw.heartbeat(status="online", metadata={"version": "1.0.0"})
```

## Configure Agent-Specific Policies

Scope guard policies to a specific agent:

```bash
curl -X POST "$DASHCLAW_BASE_URL/api/policies" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent-deploy-gate",
    "agent_id": "my-agent",
    "type": "approval_gate",
    "mode": "enforce",
    "conditions": {
      "action_types": ["deploy"],
      "risk_score_min": 50
    },
    "action": "require_approval",
    "reason": "All deploys by my-agent require approval"
  }'
```

## Agent Identity & Signatures

For production, register your agent's public key for action signing:

```javascript
// V1 SDK — register identity
import { DashClaw } from 'dashclaw/legacy';
const claw = new DashClaw({ baseUrl, apiKey, agentId: 'my-agent' });

await claw.registerIdentity({
  publicKeyPem: myPublicKey,
  algorithm: 'Ed25519',
  agentName: 'My Agent'
});

// Revoke an identity when agent is decommissioned
await claw.revokeIdentity('my-agent');
```

Signature enforcement is runtime-toggleable from `/settings?tab=identity`. When enabled, all actions must be signed with the registered key.

## Closed Enrollment Mode

If the DashClaw instance has `DASHCLAW_CLOSED_ENROLLMENT=true`, agents must be pre-registered before they can call guard or create actions. Register first, then instrument.

---

## The Meta Moment: Register This Agent on DashClaw

This agent — dashclaw-agent — can be registered on DashClaw as a governed agent. Here's how:

### 1. Set Up Environment

```bash
export DASHCLAW_BASE_URL=http://localhost:3000
export DASHCLAW_API_KEY=your-api-key
export DASHCLAW_AGENT_ID=dashclaw-agent
```

### 2. Register

```bash
curl -X POST "$DASHCLAW_BASE_URL/api/agents" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "dashclaw-agent",
    "agent_name": "DashClaw Agent",
    "description": "The definitive DashClaw expert. Helps developers integrate, configure, troubleshoot, and build DashClaw. Governs itself on DashClaw.",
    "capabilities": ["sdk-integration", "policy-creation", "troubleshooting", "codebase-contribution", "compliance", "drift-detection"]
  }'
```

### 3. Create Self-Governance Policies

```bash
# The agent that governs agents should govern itself
curl -X POST "$DASHCLAW_BASE_URL/api/policies" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dashclaw-agent-self-governance",
    "agent_id": "dashclaw-agent",
    "type": "risk_threshold",
    "mode": "enforce",
    "conditions": { "risk_score_min": 70 },
    "action": "require_approval",
    "reason": "DashClaw agent practices what it preaches — high-risk actions require approval"
  }'
```

### 4. Install Claude Code Hooks

If running this agent in Claude Code, install the pretool/posttool hooks (see `setup-dashclaw` skill) so every tool call is governed by DashClaw.

### 5. Start Heartbeat

```javascript
const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'dashclaw-agent'
});

// Report presence
await claw.heartbeat({ status: 'online', metadata: {
  version: '1.0.0',
  type: 'gitagent',
  skills: 8,
  meta: 'I govern myself on the platform I help build'
}});
```

An agent that governs agents, governed by the platform it represents. That's DashClaw.
