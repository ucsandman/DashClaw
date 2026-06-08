# DashClaw API Reference

## Authentication

All protected routes require `x-api-key` header:
```
x-api-key: your-api-key
```

**Not** Bearer token. Not Authorization header. The `x-api-key` header.

Auth chain: middleware strips client-sent `x-org-id`/`x-org-role`/`x-user-id` → rate limit check → API key validation (timing-safe compare, then hash lookup) → org context injection.

---

## Core Routes (7 Mandatory)

### POST /api/guard — Policy Evaluation

**Request:**
```json
{
  "action_type": "deploy",
  "declared_goal": "Deploy build #402 to production",
  "risk_score": 85,
  "agent_id": "deploy-agent-1",
  "systems_touched": ["production", "database"],
  "reversible": false,
  "cost_estimate": 0.50
}
```

**Response:**
```json
{
  "decision": "require_approval",
  "action_id": "act_gd_abc123",
  "reason": "Risk score exceeds org threshold",
  "signals": ["Production access", "High risk score"],
  "risk_score": 75,
  "agent_risk_score": 85
}
```

**Decisions:** `allow`, `warn`, `block`, `require_approval`

**Risk scoring:** Server computes risk from structured fields. Uses the HIGHER of computed and agent-reported score.

---

### POST /api/actions — Create Action Record

**Request:**
```json
{
  "action_type": "deploy",
  "agent_id": "deploy-agent-1",
  "declared_goal": "Deploy build #402 to production",
  "risk_score": 85,
  "reversible": false,
  "systems_touched": ["production"],
  "cost_estimate": 0.50,
  "parent_action_id": null
}
```

**Response:**
```json
{
  "action_id": "ar_abc123def456",
  "status": "running",
  "timestamp_start": "2026-03-17T10:30:00.000Z"
}
```

---

### PATCH /api/actions/:id — Update Outcome

**Request:**
```json
{
  "status": "completed",
  "output_summary": "Build #402 deployed successfully",
  "timestamp_end": "2026-03-17T10:31:45.000Z",
  "cost_estimate": 0.45
}
```

**Status values:** `running`, `completed`, `failed`, `pending_approval`

---

### GET /api/actions — List Actions

**Query params:** `status`, `action_type`, `agent_id`, `risk_min`, `risk_max`, `limit`, `offset`

**Response:**
```json
{
  "actions": [
    {
      "action_id": "ar_abc123",
      "action_type": "deploy",
      "agent_id": "deploy-agent-1",
      "declared_goal": "Deploy build #402",
      "risk_score": 85,
      "status": "completed",
      "reversible": false,
      "timestamp_start": "...",
      "timestamp_end": "...",
      "approved_by": "operator@company.com",
      "approved_at": "..."
    }
  ],
  "total": 42
}
```

---

### POST /api/assumptions — Record Assumption

**Request:**
```json
{
  "action_id": "ar_abc123",
  "assumption": "Staging tests passed successfully",
  "source": "ci-pipeline",
  "agent_id": "deploy-agent-1"
}
```

**Response:**
```json
{
  "assumption_id": "as_xyz789",
  "validated": null
}
```

---

### POST /api/approvals/:actionId — Submit Approval Decision

**Request:**
```json
{
  "decision": "approved",
  "reasoning": "Reviewed deployment plan — safe to proceed"
}
```

**Decision values:** `approved`, `denied`

---

### GET /api/signals — Risk Signals

**Response:**
```json
{
  "signals": [
    {
      "type": "autonomy_spike",
      "severity": "warning",
      "description": "12 ungoverned actions in the last hour",
      "agent_id": "deploy-agent-1",
      "threshold": 10,
      "current_value": 12
    }
  ]
}
```

**8 signal types:** autonomy_spike, high_impact_low_oversight, repeated_failures, stale_open_loops, assumption_drift, stale_assumptions, stale_running_actions, agent_silent

---

### GET /api/policies — List Policies

**Response:**
```json
{
  "policies": [
    {
      "id": "pol_abc123",
      "name": "high-risk-blocker",
      "type": "risk_threshold",
      "mode": "enforce",
      "conditions": { "risk_score_min": 80 },
      "action": "block",
      "agent_id": null,
      "reason": "Irreversible high-risk actions are blocked"
    }
  ]
}
```

---

### GET /api/health — System Health

**Response:**
```json
{
  "status": "ok",
  "database": "connected",
  "version": "2.x.x"
}
```

---

## Extension Routes

### Compliance
- `POST /api/compliance/exports` — Create compliance export
- `GET /api/compliance/exports` — List exports
- `GET /api/compliance/exports/:id` — Get export details
- `GET /api/compliance/exports/:id/download` — Download export
- `GET /api/compliance/evidence` — Get live compliance evidence

### Drift Detection
- `POST /api/drift/:agentId/baselines` — Compute drift baselines
- `POST /api/drift/:agentId/detect` — Run drift detection
- `GET /api/drift/:agentId/alerts` — List drift alerts
- `GET /api/drift/:agentId/stats` — Get drift statistics

### Evaluations
- `POST /api/evaluations/scorers` — Create scorer
- `GET /api/evaluations/scorers` — List scorers
- `POST /api/evaluations/scores` — Create score
- `POST /api/evaluations/runs` — Create eval run
- `GET /api/evaluations/stats` — Get eval statistics

### Scoring
- `POST /api/scoring/profiles` — Create scoring profile
- `POST /api/scoring/:profileId/score` — Score action with profile
- `POST /api/scoring/:profileId/calibrate` — Auto-calibrate profile

### Prompts
- `POST /api/prompts/templates` — Create prompt template
- `POST /api/prompts/render` — Render prompt with variables
- `POST /api/prompts/templates/:id/versions` — Create version
- `POST /api/prompts/templates/:id/versions/:vid/activate` — Activate version

### Learning
- `POST /api/learning/velocity` — Compute learning velocity
- `POST /api/learning/curves` — Compute learning curves
- `GET /api/learning/summary` — Get analytics summary

### Webhooks
- `POST /api/webhooks` — Create webhook subscription
- `GET /api/webhooks` — List webhooks
- `POST /api/webhooks/:id/test` — Send test event

### Agents
- `POST /api/agents` — Register agent
- `POST /api/agents/heartbeat` — Send heartbeat

---

## ID Prefix Table

| Prefix | Entity |
|--------|--------|
| `ar_` | Action records |
| `oc_live_`, `oc_test_` | API keys |
| `as_` | Assumptions |
| `act_gd_` | Guard decisions |
| `pol_` | Policies |
| `sn_` | Snippets |
| `mt_` | Message threads |
| `ct_` | Context threads |
| `es_`, `sc_`, `er_` | Evaluation (scorers, scores, runs) |
| `pt_`, `pv_` | Prompt (templates, versions) |
| `fb_` | Feedback |
| `ce_`, `cs_` | Compliance (exports, schedules) |
| `da_`, `db_`, `ds_` | Drift (alerts, baselines, snapshots) |
| `sp_`, `sd_`, `ps_` | Scoring (profiles, dimensions, scores) |
| `rt_` | Risk templates |

## Rate Limits

- Production: 100 requests/minute per IP
- Development: 1000 requests/minute per IP
- Body size limit: 2MB
- Set `DASHCLAW_DISABLE_RATE_LIMIT=true` for local dev
