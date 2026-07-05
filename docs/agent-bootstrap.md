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

### Step 2: Implement the Loop
Wrap your tool-calling or execution logic. **Always act on the guard decision
and check `action.status` after `createAction` — don't ignore either.**

```javascript
import { DashClaw, GuardBlockedError, ApprovalDeniedError } from 'dashclaw';

async function executeRiskyAction(intent) {
  // 1. GUARD: Ask policy before acting. Abort on hard block.
  const decision = await claw.guard({
    action_type: intent.type,
    declared_goal: intent.goal,
    risk_score: intent.estimatedRisk,
  });
  if (decision.decision === 'block') {
    throw new GuardBlockedError(decision);
  }

  // 2. RECORD: Create the action record. The server re-evaluates policy
  //    at this point and is the authoritative source for HITL gating —
  //    even if guard returned 'allow' above, the server may still set
  //    status='pending_approval' (e.g. if a capability requires approval).
  const { action, action_id } = await claw.createAction({
    action_type: intent.type,
    declared_goal: intent.goal,
    risk_score: intent.estimatedRisk,
  });

  // 3. HITL: If the server flagged this, wait for a human operator.
  //    Pass createAction's action_id — NOT guard's decision.action_id.
  if (action?.status === 'pending_approval') {
    try {
      await claw.waitForApproval(action_id);
    } catch (err) {
      if (err instanceof ApprovalDeniedError) return; // operator denied
      throw err;
    }
  }

  // 4. EXECUTE + OUTCOME
  try {
    await myExternalSystem.call(intent);
    await claw.updateOutcome(action_id, { status: 'completed' });
  } catch (err) {
    await claw.updateOutcome(action_id, { status: 'failed', error_message: err.message });
  }
}
```

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

1. **Trust `action.status`, not `decision.decision`.** The server's
   `createAction` response is the authoritative HITL signal.
2. **Call `waitForApproval(action_id)` with the ID from `createAction()`**,
   not the one from `guard()`. They point at different database tables.
3. `waitForApproval()` uses SSE with a polling fallback and resolves the
   instant an operator approves from the dashboard, CLI, mobile PWA, or
   (if configured) an inline Telegram Approve button.
   It throws `ApprovalDeniedError` on denial.

---

## 4. Legacy "Importing"
Feature sets related to importing memory, goals, and messaging were retired from the core runtime. The current system map — which surfaces are core, extension, and archived — is [`PROJECT_DETAILS.md`](../PROJECT_DETAILS.md); the messaging and memory-adjacent methods that remain live are catalogued in [`sdk/README.md`](../sdk/README.md) (Node) and [`sdk-python/README.md`](../sdk-python/README.md) (Python).
