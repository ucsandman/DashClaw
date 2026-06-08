---
name: manage-approvals
description: Human-in-the-loop approval workflows for governed agent actions
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: operations
---

# Manage Approvals

DashClaw's HITL (Human-in-the-Loop) system lets operators approve or deny agent actions before they execute. Three channels: dashboard, CLI, and SDK polling.

## When Approvals Trigger

Approvals are triggered when:
1. A guard policy returns `require_approval`
2. An action's risk score exceeds the org's approval threshold
3. The action touches systems flagged for mandatory review

The action enters `pending_approval` status and the agent waits.

## Approval Channels

### 1. Dashboard (Web UI)

Navigate to the DashClaw dashboard → Mission Control or Decisions view. Pending approvals show with:
- Action type and declared goal
- Agent ID
- Risk score (color-coded)
- Systems touched
- Replay link for full decision context

Click **Approve** or **Deny** with optional reasoning.

### 2. CLI (Terminal)

```bash
# Interactive inbox — live updates via SSE
dashclaw approvals

# Direct approve/deny
dashclaw approve act_abc123 --reason "Reviewed deployment plan"
dashclaw deny act_abc123 --reason "Missing staging verification"
```

The interactive inbox (`dashclaw approvals`) uses SSE for real-time push notifications. New approval requests appear immediately without polling.

**Keyboard shortcuts:**
- `A` — Approve selected
- `D` — Deny selected
- `R` — Refresh
- `O` — Open replay in browser
- `Q` — Quit

### 3. SDK Polling (Agent-Side)

```javascript
// Agent waits for approval after guard returns require_approval
try {
  await claw.waitForApproval(decision.action_id, {
    timeout: 300000  // 5 minutes
  });
  console.log('Approved — proceeding');
} catch (err) {
  if (err instanceof ApprovalDeniedError) {
    console.log('Denied:', err.message);
    return;
  }
  throw err;
}
```

```python
try:
    claw.wait_for_approval(decision["action_id"], timeout=300000)
    print("Approved — proceeding")
except ApprovalDeniedError as e:
    print(f"Denied: {e}")
    return
```

### 4. API Direct

```bash
# Approve
curl -X POST "$DASHCLAW_BASE_URL/api/approvals/act_abc123" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved", "reasoning": "Reviewed and safe"}'

# Deny
curl -X POST "$DASHCLAW_BASE_URL/api/approvals/act_abc123" \
  -H "x-api-key: $DASHCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"decision": "denied", "reasoning": "Risk too high"}'
```

## Full Approval Flow Architecture

```
Agent calls claw.guard({ action_type, risk_score, ... })
        ↓
Guard evaluates policies → returns require_approval
        ↓
Action created with status: pending_approval
        ↓
Agent calls claw.waitForApproval(actionId)
   (polls or uses SSE stream)
        ↓                              ↓
Operator sees in dashboard/CLI    Operator opens CLI inbox
        ↓                              ↓
Reviews: goal, risk, systems      Uses A/D keys or direct command
        ↓                              ↓
        └──────── Decision ────────────┘
                    ↓
           approved → agent continues
           denied → ApprovalDeniedError thrown
           timeout → blocked (enforce) or allowed (observe)
```

## Claude Code Hook Approval Flow

When using the pretool/posttool hooks with Claude Code:

1. Claude Code calls a tool (e.g., `Bash: git push origin main`)
2. Pretool classifies: action_type=deploy, risk=80, reversible=false
3. Pretool calls `POST /api/guard` → gets `require_approval`
4. Pretool creates action with `pending_approval` status
5. Pretool polls for approval (30-second timeout)
6. Operator approves via `dashclaw approvals` in another terminal
7. Pretool receives approval → exits 0 → tool executes
8. Posttool records outcome → `PATCH /api/actions/:id`

If approval times out or is denied, pretool exits 2 (enforce mode) and the tool is blocked.

## Listing Pending Approvals

```javascript
// SDK
const pending = await claw.getPendingApprovals({ limit: 50, offset: 0 });

// API
// GET /api/actions?status=pending_approval&limit=50
```

## Approval Best Practices

- **Use SSE for real-time**: The CLI inbox uses SSE streaming so approvals appear instantly
- **Set reasonable timeouts**: 5 minutes for interactive workflows, 30 seconds for hooks
- **Include reasoning**: Always provide reasoning when approving/denying — it's part of the audit trail
- **Don't skip in production**: HITL gates exist because the action is high-risk. Bypassing defeats the purpose.
- **Use the replay link**: Every action has a replay URL showing the full decision chain — use it to review context before approving
