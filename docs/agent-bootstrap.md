# Agent Instrumentation (v2)

Instead of "importing" agent state, DashClaw v2 focuses on **instrumenting** agent behavior. You don't push your agent's history to DashClaw; you connect your agent's future actions to the DashClaw governance runtime.

---

## 1. Installation

Add the zero-dependency SDK to your agent project:

```bash
npm install dashclaw
# or
pip install dashclaw
```

---

## 2. Core Instrumentation (The Golden Path)

To govern an agent, you must wrap its sensitive actions in the **Governance Loop**.

### Step 1: Initialize the Client
```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-production-agent'
});
```

### Step 2: Use the governed helper
`runGoverned()` performs guard, recording, approval wait, a fresh protocol-1
execution claim, callback execution, and terminal outcome reporting. It refuses
to call the callback if claim confirmation is missing or ambiguous.

```javascript
import { DashClaw } from 'dashclaw';

async function executeRiskyAction(intent) {
  const act = { kind: 'http', method: 'POST', url: intent.url };
  return claw.runGoverned(act, {
    action_type: intent.type,
    declared_goal: intent.goal,
    risk_score: intent.estimatedRisk,
  }, () => myExternalSystem.call(intent));
}
```

The claim authorizes one recorded attempt. It does not make the external call
exactly once. If callback success or outcome confirmation is uncertain,
reconcile the target system before retrying and use the target's idempotency
primitive where available.

---

## 3. Advanced Instrumentation

### Assumption Tracking
Use `recordAssumption()` to document *why* an agent believes an action is safe. This is critical for detecting reasoning drift.

```javascript
await claw.recordAssumption({
  action_id,
  assumption: 'User is authenticated and has valid billing on file.'
});
```

### Human-in-the-Loop (HITL)

See the canonical HITL flow and action-ID rules in
[`sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow](../sdk/README.md#human-in-the-loop-hitl-approval-flow).
The short version:

1. Prefer `runGoverned()` / `run_governed()` for callback execution; both
   require the current execution-claim contract.
2. For a manual low-level loop, call `waitForApproval(action_id)` with the ID
   from `createAction()`, then `claimExecution(action_id, act)` immediately
   before the act. A guard `decision_id` is not an action ID.
3. SSE is a latency hint. `waitForApproval()` reconciles authoritative action
   state and throws `ApprovalDeniedError` on denial.

---

## 4. Legacy "Importing"
Feature sets related to importing memory, goals, and messaging were retired from the core runtime. The current system map — which surfaces are core, extension, and archived — is [`PROJECT_DETAILS.md`](../PROJECT_DETAILS.md); the messaging and memory-adjacent methods that remain live are catalogued in [`sdk/README.md`](../sdk/README.md) (Node) and [`sdk-python/README.md`](../sdk-python/README.md) (Python).
