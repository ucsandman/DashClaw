# Agent Fleet Management

DashClaw provides real-time visibility into your agent fleet's status and health via the **Fleet Presence** card on the dashboard.

> For a full legend of every status-bar badge, counter, and status, see the [Global Status Bar Reference](./mission-control-reference.md).

## Fleet Presence Logic

The dashboard classifies agents into three states based on their last known activity:

1.  **Online** 🟢
    *   **Criteria:** Last heartbeat or activity within the last **10 minutes** (configurable).
    *   **Meaning:** The agent is active and communicating with DashClaw.

2.  **Stale** 🟡
    *   **Criteria:** Last heartbeat was between **10 minutes** and **30 minutes** ago.
    *   **Meaning:** The agent might be hung, paused, or experiencing network issues.

3.  **Offline** ⚪
    *   **Criteria:** No heartbeat for **30+ minutes**, or explicitly reported as `offline`.
    *   **Meaning:** The agent is disconnected or stopped.

### Configuration

The "Online" window defaults to **10 minutes**. You can adjust this by setting an environment variable on your DashClaw instance:

```bash
# Set online window to 5 minutes (in milliseconds)
AGENT_ONLINE_WINDOW_MS=300000
```

### Data Sources

Presence is derived from two sources, in priority order:

1.  **Heartbeats:** Explicit `claw.heartbeat()` calls from the SDK. This is the most accurate signal.
2.  **Activity:** Timestamp of the last recorded action (`createAction`, `track`, etc.). Used as a fallback if no heartbeats are present.

## Org Scoping & Troubleshooting

Agents are scoped to an **Organization** via their API Key. If an agent appears missing from your dashboard:

1.  **Check the API Key:** Ensure the agent is using an API Key that belongs to the same organization you are viewing.
    *   Go to **Settings > API Keys** to verify your keys.
2.  **Verify Heartbeats:** Ensure your agent is calling `claw.startHeartbeat()` or `claw.heartbeat()` regularly.
3.  **Check for "Unknown" Status:** If an agent appears but has "Unknown" status, it may have never sent a heartbeat or action.

### Debugging

If you suspect heartbeats are being sent but not received:

1.  **Server Logs:** Check the DashClaw server logs for `[Heartbeat]` entries. They will show exactly which agent ID and Org ID received the heartbeat.
    ```
    [Heartbeat] Received from agent=moltfire for org=org_home (status=online)
    ```
2.  **API Inspection:** Admins can append `?debug=true` to the `/api/agents` endpoint to see server-side metadata:
    *   `_debug.org_id`: The organization ID the request was authenticated against.
    *   `_debug.heartbeat_source`: Confirmation that the `agent_presence` table is being read.
    *   `_debug.online_window_ms`: The currently configured timeout window.

## Manual Approval Workflow

Agents can request human approval for sensitive actions by explicitly setting the action status.

**Requirements:**
1.  **Status:** Must be set to `pending_approval`.
2.  **Risk Score:** Must be **below** the blocking threshold (default: 80). If the score is too high, the Guard will block the action (403) before it can be queued.

**Example (Node.js SDK):**

```javascript
await claw.createAction({
  action_type: 'cleanup',
  declared_goal: 'Delete production database backup',
  status: 'pending_approval', // explicit request
  risk_score: 50, // moderate risk (safe enough to queue)
  metadata: { filename: 'backup.sql' }
});
```

This action will appear in the Dashboard with a "Pending Approval" status, allowing an operator to Review and Approve/Reject it.

## SDK Best Practices

To ensure accurate fleet visibility, configure your agents to send heartbeats.

### Node.js SDK

```javascript
// Start an automatic heartbeat loop (default: every 1 minute)
// This runs in the background and keeps the agent "Online".
const stopHeartbeat = claw.startHeartbeat({ 
  interval: 60000, // 1 minute (recommended)
  status: 'online',
  metadata: { version: '1.0.0', environment: 'production' }
});

// Update status during long-running tasks
await claw.heartbeat({
  status: 'busy',
  current_task_id: 'task_123'
});

// When shutting down
stopHeartbeat();
await claw.heartbeat({ status: 'offline' });
```

### Python SDK

```python
// Start background heartbeat
claw.start_heartbeat(interval_seconds=60)

// Update status
claw.heartbeat(status="busy", current_task_id="task_123")

// Shutdown
claw.stop_heartbeat()
claw.heartbeat(status="offline")
```
