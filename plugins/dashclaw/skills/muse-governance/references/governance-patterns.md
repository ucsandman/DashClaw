# Governance patterns (REST)

Base URL and auth are runtime-specific; every example below assumes `BASE` is
your DashClaw instance and the request carries your credential. With the
reference CLI (`cli/dc`), auth is handled for you.

## 1. Guard before a risky act

```bash
curl -s -X POST "$BASE/api/guard?record=true" \
  -H 'Content-Type: application/json' \
  -d '{
    "action_type": "shell",
    "declared_goal": "Restart the staging API after config change",
    "agent_id": "my-agent",
    "agent_name": "My Agent",
    "systems_touched": ["staging"],
    "reversible": false,
    "confidence": 80
  }'
```

Decision lattice: `allow < warn < allow_contained < require_approval < block`.
With `?record=true`, use the returned `action_id` for everything downstream.

Or with the CLI:

```bash
dc guard --action-type shell \
  --goal "Restart the staging API after config change" \
  --systems staging --no-reversible --confidence 80 --record
# exit 2 on block
```

## 2. Record and close out

```bash
# record (or reuse the action_id from ?record=true)
ACTION=$(curl -s -X POST "$BASE/api/actions" \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"my-agent","action_type":"deploy",
       "declared_goal":"Deploy v2.3.1 to staging after all tests passed",
       "idempotency_key":"sha256:<...>" }' | jq -r .action_id)

# ... do the work ...

# outcome (one-shot: first call wins)
curl -s -X POST "$BASE/api/actions/$ACTION/outcome" \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed"}'
```

CLI equivalent: `dc action ...`, `dc outcome <id> --status completed|partial|failed`.

## 3. Wait for a human

When the verdict is `require_approval`, the action parks with
`status: pending_approval`. Poll until it resolves:

```bash
dc pending                       # what is waiting across the org
# poll one action:
while true; do
  S=$(curl -s "$BASE/api/actions/$ACTION" | jq -r .action.status)
  case "$S" in approved) break;; denied|expired|cancelled) exit 1;; esac
  sleep 10
done
```

The operator approves from the dashboard (`/approvals`), the CLI
(`dashclaw approve <id>`), the mobile PWA (`/approve`), Telegram, or Discord.
Approvals are only approvable while they can still release something; overdue
rows flip to `expired` (acting on one returns `410`).

## 4. SDKs (when you manage the credential yourself)

```javascript
import { DashClaw } from 'dashclaw';
const claw = new DashClaw({ baseUrl: process.env.DASHCLAW_BASE_URL,
                            apiKey: process.env.DASHCLAW_API_KEY,
                            agentId: 'my-agent' });
const decision = await claw.guard({ action_type: 'deploy', risk_score: 85,
                                    declared_goal: 'Deploy v2.3.1 to staging' });
if (decision.decision === 'block') throw new Error('blocked: ' + decision.reason);
```

```python
from dashclaw import DashClaw
claw = DashClaw(base_url=..., api_key=..., agent_id='my-agent')
plan = claw.submit_plan("Nightly deploy", steps=[
    {"action_type": "deploy", "step_goal": "Deploy v2.3.1 to staging"},
])
```

`run_governed()` / `runGoverned()` need a server advertising execution-claim
protocol 1; upgrade server and SDK together before using them.

## 5. Sessions

```bash
curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' \
  -d '{"agent_id":"my-agent","metadata":{"task":"nightly deploy run"}}'
# ... PATCH status / checkpoint as the run progresses ...
```

## 6. Assumptions

When an action depends on a belief ("staging tests passed"), record it so an
operator can invalidate it later:

```bash
curl -s -X POST "$BASE/api/assumptions" -H 'Content-Type: application/json' \
  -d '{"agent_id":"my-agent","action_id":"'"$ACTION"'",
       "assumption":"staging tests passed on build 402"}'
```

Invalidated assumptions ride back on your next guard calls as
`assumption_alerts` until acknowledged.
