# DashClaw SDK: Agent Decision Infrastructure

Full reference for the DashClaw SDK (Node.js). For Python, see the [Python SDK docs](../sdk-python/README.md).

DashClaw treats every agent action as a governed decision. The SDK provides decision recording, policy enforcement, evaluation, and compliance mapping. It proves what your agents decided and why.

Install, configure, and govern your AI agents with 178+ methods across 30+ categories including action recording, behavior guard, evaluation framework, scoring profiles, learning analytics, prompt management, feedback loops, behavioral drift, compliance exports, and more. Native adapters for **OpenClaw**, **CrewAI**, **AutoGen**, and **LangChain**.

---

## Quick Start

### 1. Copy the SDK
Install from npm, or copy the single-file SDK directly.
```bash
npm install dashclaw
```

### 2. Initialize the client
```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
  // Use http://localhost:3000 for local, or https://your-app.vercel.app for cloud
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  agentName: 'My Agent',
  hitlMode: 'wait', // Optional: automatically wait for human approval
});
```

### 3. Record your first action
```javascript
// Create an action before doing work
const { action_id } = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy authentication service',
  risk_score: 60,
});

// ... do the work ...

// Update when done
await claw.updateOutcome(action_id, {
  status: 'completed',
  output_summary: 'Auth service deployed to prod',
});
```

---

## Constructor

Create a DashClaw instance. Requires Node 18+ (native fetch).

```javascript
const claw = new DashClaw({
  baseUrl,
  apiKey,
  agentId,
  agentName,
  swarmId,
  guardMode,
  guardCallback,
  autoRecommend,
  recommendationConfidenceMin,
  recommendationCallback,
  hitlMode,
});
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| baseUrl | string | Yes | DashClaw dashboard URL (e.g. "http://localhost:3000" or "https://your-app.vercel.app") |
| apiKey | string | Yes | API key for authentication (determines which org\'s data you access) |
| agentId | string | Yes | Unique identifier for this agent |
| agentName | string | No | Human-readable agent name |
| swarmId | string | No | Swarm/group identifier if part of a multi-agent system |
| guardMode | string | No | Auto guard check before createAction/track: "off" (default), "warn" (log + proceed), "enforce" (throw on block) |
| guardCallback | Function | No | Called with guard decision object when guardMode is active |
| autoRecommend | string | No | Recommendation auto-adapt mode: "off" (default), "warn" (record override), "enforce" (apply safe hints) |
| recommendationConfidenceMin | number | No | Min recommendation confidence required for auto-adapt in enforce mode (default 70) |
| recommendationCallback | Function | No | Called with recommendation adaptation details when autoRecommend is active |
| hitlMode | string | No | HITL behavior: "off" (default - return 202 immediately), "wait" (automatically block and poll until approved/denied) |

### Guard Mode, Auto-Recommend, and HITL
When enabled, every call to `createAction()` can run recommendation adaptation and guard checks before submission.

```javascript
import { DashClaw, GuardBlockedError, ApprovalDeniedError } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  autoRecommend: 'enforce', // apply safe recommendation hints
  recommendationConfidenceMin: 80,
  guardMode: 'enforce', // throws GuardBlockedError on block
  hitlMode: 'wait',     // poll until approved or throw ApprovalDeniedError
});

try {
  await claw.createAction({ action_type: 'deploy', declared_goal: 'Ship v2' });
  // If a policy triggers 'require_approval', the SDK will pause here until an admin clicks 'Allow'
} catch (err) {
  if (err instanceof GuardBlockedError) {
    console.log('Blocked by policy:', err.reasons);
  } else if (err instanceof ApprovalDeniedError) {
    console.log('Denied by human operator');
  }
}
```

### Compliance & Governance Patterns

DashClaw's guard + action recording pipeline maps directly to compliance controls.

**SOC 2 CC6.1: Logical Access Controls**
```javascript
// Before any high-risk operation, enforce policy
const guardResult = await claw.guard({
  action_type: 'database_write',
  risk_score: 85,
  systems_touched: ['production_db'],
  reversible: false,
  declared_goal: 'Drop legacy user table'
});

if (guardResult.decision === 'block') {
  // SOC 2 control satisfied: unauthorized action prevented
  console.log('Policy blocked:', guardResult.reasons);
  return;
}

// Decision is governed. Record with full lineage
const { action_id } = await claw.createAction({
  action_type: 'database_write',
  declared_goal: 'Drop legacy user table',
  risk_score: 85,
  reversible: false,
  authorization_scope: 'admin-approved'
});

// Register the assumption this decision relies on
await claw.registerAssumption({
  action_id,
  assumption: 'Legacy table has zero active references',
  basis: 'Schema dependency scan completed 2h ago'
});
```

**EU AI Act Article 14: Human Oversight**
```javascript
// require_approval forces human-in-the-loop
const result = await claw.guard({
  action_type: 'customer_communication',
  risk_score: 60,
  declared_goal: 'Send pricing update to 500 customers'
});

if (result.decision === 'require_approval') {
  // Create action in pending state, wait for human approval
  const { action_id } = await claw.createAction({
    action_type: 'customer_communication',
    declared_goal: 'Send pricing update to 500 customers',
    status: 'pending'
  });
  // Approval queue at /approvals shows this to operators
}
```

**ISO 42001: AI Decision Accountability**
```javascript
// Full decision lineage: guard → action → assumptions → outcome
const { action_id } = await claw.createAction({
  action_type: 'data_processing',
  declared_goal: 'Rebuild customer segmentation model',
  risk_score: 45,
  systems_touched: ['ml-pipeline', 'customer-db']
});

await claw.registerAssumption({
  action_id,
  assumption: 'Customer data is current as of today',
  basis: 'CRM sync completed at 09:00 UTC'
});

// Later: validate or invalidate assumptions
await claw.validateAssumption(assumptionId, true);

// Decision integrity signals auto-detect when assumptions drift
const signals = await claw.getSignals();
// → Returns 'assumption_drift' if too many invalidated
```

---

## Action Recording

Create, update, and query action records. Every agent action is a governed decision with a full audit trail capturing intent, reasoning, and outcome for compliance and review.

### claw.createAction(action)
Create a new action record. The agent's agentId, agentName, and swarmId are automatically attached.

If `hitlMode` is set to `'wait'` and the action requires approval, this method will not return until the action is approved or denied (or it times out).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action_type | string | Yes | One of: build, deploy, post, apply, security, message, api, calendar, research, review, fix, refactor, test, config, monitor, alert, cleanup, sync, migrate, other |
| declared_goal | string | Yes | What this action aims to accomplish |
| action_id | string | No | Custom action ID (auto-generated act_ UUID if omitted) |
| reasoning | string | No | Why the agent decided to take this action |
| authorization_scope | string | No | What permissions were granted |
| trigger | string | No | What triggered this action |
| systems_touched | string[] | No | Systems this action interacts with |
| input_summary | string | No | Summary of input data |
| parent_action_id | string | No | Parent action if this is a sub-action |
| reversible | boolean | No | Whether this action can be undone (default: true) |
| risk_score | number | No | Risk score 0-100 (default: 0) |
| confidence | number | No | Confidence level 0-100 (default: 50) |

**Returns:** `Promise<{ action: Object, action_id: string }>`

**Example:**
```javascript
const { action_id } = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy auth service to production',
  risk_score: 70,
  systems_touched: ['kubernetes', 'auth-service'],
  reasoning: 'Scheduled release after QA approval',
});
```

### claw.waitForApproval(actionId, options?)
Manual poll for human approval. Only needed if `hitlMode` is `'off'`.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| actionId | string | Yes | The action_id to poll |
| options.timeout | number | No | Max wait time in ms (default: 300000 / 5 min) |
| options.interval | number | No | Poll interval in ms (default: 5000) |

**Returns:** `Promise<{ action: Object, action_id: string }>`
**Throws:** `ApprovalDeniedError` if denied.

### claw.updateOutcome(actionId, outcome)
Update the outcome of an existing action. Automatically sets timestamp_end if not provided.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| actionId | string | Yes | The action_id to update |
| status | string | No | New status: completed, failed, cancelled |
| output_summary | string | No | What happened |
| side_effects | string[] | No | Unintended consequences |
| artifacts_created | string[] | No | Files, records, etc. created |
| error_message | string | No | Error details if failed |
| duration_ms | number | No | How long it took in milliseconds |
| cost_estimate | number | No | Estimated cost in USD |

**Returns:** `Promise<{ action: Object }>`

### claw.track(actionDef, fn)
Helper that creates an action, runs your async function, and auto-updates the outcome. If fn throws, the action is marked as failed with the error message.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| actionDef | Object | Yes | Action definition (same params as createAction) |
| fn | Function | Yes | Async function to execute. Receives { action_id } as argument. |

**Returns:** `Promise<*> (the return value of fn)`

### claw.getActions(filters?)
Get a list of actions with optional filters. Returns paginated results with stats.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agent_id | string | No | Filter by agent |
| swarm_id | string | No | Filter by swarm |
| status | string | No | Filter by status (running, completed, failed, cancelled) |
| action_type | string | No | Filter by type |
| risk_min | number | No | Minimum risk score |
| limit | number | No | Max results (default: 50) |
| offset | number | No | Pagination offset (default: 0) |

**Returns:** `Promise<{ actions: Object[], total: number, stats: Object }>`

### claw.getAction(actionId)
Get a single action with its associated open loops and assumptions.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| actionId | string | Yes | The action_id to retrieve |

**Returns:** `Promise<{ action: Object, open_loops: Object[], assumptions: Object[] }>`

### claw.getActionTrace(actionId)
Get root-cause trace for an action, including its assumptions, open loops, parent chain, and related actions.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| actionId | string | Yes | The action_id to trace |

**Returns:** `Promise<{ action: Object, trace: Object }>`

---

## Evaluation Framework

Track output quality automatically with 5 built-in scorer types. No LLM required for most scorers.

### claw.createScorer({ name, scorerType, config, description })
Create a new evaluation scorer.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Scorer name |
| scorerType | string | Yes | regex, keywords, numeric_range, custom_function, or llm_judge |
| config | Object | Yes | Configuration for the scorer |
| description | string | No | Purpose of this scorer |

**Returns:** `Promise<Object>`

**Example:**
```javascript
await claw.createScorer({
  name: 'JSON Validator',
  scorerType: 'regex',
  config: { pattern: '^\\{.*\\}$' },
});
```

### claw.getScorers()
List all available scorers.

**Returns:** `Promise<{ scorers: Object[], llm_available: boolean }>`

### claw.getEvalRuns(filters?)
List evaluation runs with status and result summaries.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | running, completed, failed |
| limit | number | No | Max results |

**Returns:** `Promise<{ runs: Object[] }>`

### claw.getEvalStats(filters?)
Get aggregate evaluation statistics across scorers and agents.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agent_id | string | No | Filter by agent |
| scorer_name | string | No | Filter by scorer |
| days | number | No | Lookback period |

**Returns:** `Promise<Object>`

---

## Prompt Management

Version-controlled prompt templates with mustache variable rendering.

### claw.createPromptTemplate({ name, content, category })
Create a new prompt template.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Template name |
| content | string | Yes | Template content with {{variables}} |
| category | string | No | Optional grouping category |

**Returns:** `Promise<Object>`

### claw.getPromptTemplate(templateId)
Get a template by ID, including its current active version.

**Returns:** `Promise<Object>`

### claw.renderPrompt({ template_id, variables, action_id })
Render a template with variables on the server. Optionally link to an action for usage tracking.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| template_id | string | Yes | Template ID |
| variables | Object | Yes | Mustache variables |
| action_id | string | No | Link to an action |

**Returns:** `Promise<{ rendered: string }>`

### claw.listPromptVersions(templateId)
List all versions of a prompt template.

**Returns:** `Promise<Object[]>`

### claw.activatePromptVersion(templateId, versionId)
Set a specific version as the active one for a template.

**Returns:** `Promise<Object>`

---

## User Feedback

Collect and analyze human feedback on agent actions.

### claw.submitFeedback({ action_id, agent_id, rating, comment, category, tags })
Submit feedback for a specific action.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action_id | string | Yes | Action ID |
| agent_id | string | No | Agent ID |
| rating | number | Yes | Rating 1-5 |
| comment | string | No | Optional text feedback |
| category | string | No | Optional category |
| tags | string[] | No | Optional tags |

**Returns:** `Promise<Object>`

### claw.getFeedback(feedbackId)
Retrieve a single feedback entry.

**Returns:** `Promise<Object>`

### claw.getFeedbackStats({ agent_id })
Get feedback statistics, including average rating and sentiment trends.

**Returns:** `Promise<Object>`

---

## Behavioral Drift

Monitor agent behavior deviations from statistical baselines using z-scores.

### claw.computeDriftBaselines({ agent_id, lookback_days })
Establish statistical baselines for an agent's behavior metrics.

**Returns:** `Promise<Object>`

### claw.detectDrift({ agent_id, window_days })
Run drift detection against the established baselines.

**Returns:** `Promise<Object>`

### claw.listDriftAlerts(filters?)
List behavioral drift alerts with severity and status.

**Returns:** `Promise<Object[]>`

---

## Compliance Exports

Generate evidence packages for SOC 2, NIST AI RMF, EU AI Act, and ISO 42001.

### claw.createComplianceExport({ name, frameworks, format, window_days })
Generate a compliance export bundle.

**Returns:** `Promise<Object>`

### claw.getComplianceExport(exportId)
Get the status and details of a compliance export.

**Returns:** `Promise<Object>`

### claw.listComplianceExports({ limit })
List recent compliance exports.

**Returns:** `Promise<Object[]>`

---

## Learning Analytics

Track agent improvement velocity, maturity levels, and learning curves per skill.

### claw.getLearningVelocity({ agent_id })
Get agent improvement rate over time.

**Returns:** `Promise<Object>`

### claw.getMaturityLevels()
Get the 6-level maturity model distribution for the agent.

**Returns:** `Promise<Object>`

### claw.getLearningCurves({ agent_id, action_type })
Get performance improvement curves for a specific skill/action type.

**Returns:** `Promise<Object>`

---

## Scoring Profiles

User-defined weighted quality scoring with 3 composite methods, 8 data sources, risk templates, and auto-calibration. Zero LLM required.

### claw.createScoringProfile({ name, action_type, composite_method, dimensions })
Create a scoring profile with optional inline dimensions.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Profile name |
| action_type | string | No | Filter to specific action type (null = all) |
| composite_method | string | No | weighted_average (default), minimum, or geometric_mean |
| dimensions | Array | No | Inline dimension definitions (name, data_source, weight, scale) |

**Returns:** `Promise<Object>`

**Example:**
```javascript
const profile = await dc.createScoringProfile({
  name: 'deploy-quality',
  action_type: 'deploy',
  composite_method: 'weighted_average',
  dimensions: [
    { name: 'Speed', data_source: 'duration_ms', weight: 0.3,
      scale: [
        { label: 'excellent', operator: 'lt', value: 30000, score: 100 },
        { label: 'good', operator: 'lt', value: 60000, score: 75 },
        { label: 'poor', operator: 'gte', value: 60000, score: 20 },
      ]},
    { name: 'Reliability', data_source: 'confidence', weight: 0.7,
      scale: [
        { label: 'excellent', operator: 'gte', value: 0.9, score: 100 },
        { label: 'poor', operator: 'lt', value: 0.7, score: 25 },
      ]},
  ],
});
```

### claw.scoreWithProfile(profile_id, action)
Score a single action against a profile. Returns composite score + per-dimension breakdown.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| profile_id | string | Yes | Profile to score against |
| action | Object | Yes | Action data object |

**Returns:** `Promise<Object>`

### claw.batchScoreWithProfile(profile_id, actions)
Score multiple actions at once. Returns per-action results + summary.

**Returns:** `Promise<Object>`

### claw.createRiskTemplate({ name, base_risk, rules })
Create a rule-based risk template. Replaces hardcoded agent risk numbers.

**Returns:** `Promise<Object>`

### claw.autoCalibrate({ action_type, lookback_days })
Analyze historical action data to suggest scoring thresholds from percentile distribution.

**Returns:** `Promise<Object>`

---

## Agent Presence & Health

Monitor agent uptime and status in real-time. Use heartbeats to detect when an agent crashes or loses network connectivity.

### claw.heartbeat(options?)
Report agent presence and health to the dashboard.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| options.status | string | No | Agent status: 'online', 'busy', 'error' (default: 'online') |
| options.currentTaskId | string | No | The ID of the task currently being executed |
| options.metadata | Object | No | Optional key-value pairs for additional context |

**Returns:** `Promise<{ status: string, timestamp: string }>`

### claw.startHeartbeat(options?)
Start an automatic heartbeat timer that reports 'online' every minute.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| options.interval | number | No | Heartbeat interval in milliseconds (default: 60000 / 1 min) |
| options.status | string | No | Status to report |

**Example:**
```javascript
// Start reporting presence automatically
claw.startHeartbeat();

// Later, stop it
claw.stopHeartbeat();
```

### claw.stopHeartbeat()
Stop the automatic heartbeat timer.

---

## Real-Time Flight Recorder

Stream actions live to the dashboard as they happen.

### claw.track(actionDef, fn)
(Already documented above) - Use `track()` to automatically emit `running` events at start and `completed`/`failed` events at finish. These show up instantly on the "Flight Recorder" dashboard.

---

## Real-Time Events

Subscribe to server-sent events (SSE) for instant push notifications. Eliminates polling for approvals, policy changes, and task assignments.

### claw.events()

Open a persistent SSE connection. Returns a chainable handle with `.on(event, callback)` and `.close()`.

**Supported events:** `action.created`, `action.updated`, `message.created`, `policy.updated`, `task.assigned`, `task.completed`

```javascript
const stream = claw.events();

stream
  .on('action.created', (data) => console.log('New action:', data.action_id))
  .on('action.updated', (data) => {
    if (data.status === 'running') console.log('Approved:', data.action_id);
  })
  .on('policy.updated', (data) => console.log('Policy changed:', data.change_type))
  .on('task.assigned', (data) => console.log('Task routed:', data.task?.title))
  .on('task.completed', (data) => console.log('Task done:', data.task?.task_id))
  .on('error', (err) => console.error('Stream error:', err));

// When done:
stream.close();
```

### claw.waitForApproval(actionId, { useEvents: true })

SSE-powered approval waiting. Resolves instantly when the operator approves/denies instead of polling every 5 seconds.

```javascript
// SSE mode (instant, recommended)
const { action } = await claw.waitForApproval('act_abc', { useEvents: true });

// Polling mode (default, backward-compatible)
const { action } = await claw.waitForApproval('act_abc');
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| actionId | string | Yes | Action ID to watch |
| options.timeout | number | 300000 | Max wait time (ms) |
| options.interval | number | 5000 | Poll interval (polling mode only) |
| options.useEvents | boolean | false | Use SSE instead of polling |

---

## Token & Cost Analytics

Track token usage and estimated costs for every action. DashClaw automatically aggregates these into "Cost per Goal" metrics.

**Usage:**
Pass `tokens_in`, `tokens_out`, and `model` when creating or updating actions.

```javascript
await claw.createAction({
  action_type: 'generation',
  declared_goal: 'Generate blog post',
  model: 'gpt-4o',
  tokens_in: 1500,
  tokens_out: 400,
  // cost_estimate is auto-calculated on the server if model is known
});
```

**Supported Models for Auto-Pricing:**
- GPT-4o, GPT-4-Turbo
- Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- Llama 3 (70b, 8b)

---

## Loops & Assumptions

Track unresolved dependencies and log what your agents assume. Catch drift before it causes failures.

### claw.registerOpenLoop(loop)
Register an open loop (unresolved dependency, pending approval, etc.) for an action.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action_id | string | Yes | Parent action ID |
| loop_type | string | Yes | One of: followup, question, dependency, approval, review, handoff, other |
| description | string | Yes | What needs to be resolved |
| priority | string | No | One of: low, medium, high, critical (default: medium) |
| owner | string | No | Who is responsible for resolving this |

**Returns:** `Promise<{ loop: Object, loop_id: string }>`

### claw.resolveOpenLoop(loopId, status, resolution?)
Resolve or cancel an open loop.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| loopId | string | Yes | The loop_id to resolve |
| status | string | Yes | "resolved" or "cancelled" |
| resolution | string | No | Resolution description (required when resolving) |

**Returns:** `Promise<{ loop: Object }>`

### claw.registerAssumption(assumption)
Register an assumption made during an action. Track what your agent assumes so you can validate or invalidate later.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action_id | string | Yes | Parent action ID |
| assumption | string | Yes | The assumption being made |
| basis | string | No | Evidence or reasoning for the assumption |
| validated | boolean | No | Whether this has been validated (default: false) |

**Returns:** `Promise<{ assumption: Object, assumption_id: string }>`

### claw.getAssumption(assumptionId)
Get a single assumption by ID.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assumptionId | string | Yes | The assumption_id to retrieve |

**Returns:** `Promise<{ assumption: Object }>`

### claw.validateAssumption(assumptionId, validated, invalidated_reason?)
Validate or invalidate an assumption. When invalidating, a reason is required.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assumptionId | string | Yes | The assumption_id to update |
| validated | boolean | Yes | true to validate, false to invalidate |
| invalidated_reason | string | No | Required when invalidating (validated = false) |

**Returns:** `Promise<{ assumption: Object }>`

### claw.getOpenLoops(filters?)
Get open loops with optional filters. Returns paginated results with stats.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by status: open, resolved, cancelled |
| loop_type | string | No | Filter by loop type |
| priority | string | No | Filter by priority |
| limit | number | No | Max results (default: 50) |

**Returns:** `Promise<{ loops: Object[], total: number, stats: Object }>`

### claw.getDriftReport(filters?)
Get drift report for assumptions with risk scoring. Shows which assumptions are stale, unvalidated, or contradicted by outcomes.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action_id | string | No | Filter by action |
| limit | number | No | Max results (default: 50) |

**Returns:** `Promise<{ assumptions: Object[], drift_summary: Object }>`

---

## Signals

Automatic detection of problematic agent behavior. Seven signal types fire based on action patterns - no configuration required.

### claw.getSignals()
Get current risk signals across all agents. Returns 7 signal types: autonomy_spike, high_impact_low_oversight, repeated_failures, stale_loop, assumption_drift, stale_assumption, and stale_running_action.

**Returns:** `Promise<{ signals: Object[], counts: { red: number, amber: number, total: number } }>`

### Signal Types
- **autonomy_spike**: Agent taking too many actions without human checkpoints
- **high_impact_low_oversight**: Critical actions without sufficient review
- **repeated_failures**: Same action type failing multiple times
- **stale_loop**: Open loops unresolved past their expected timeline
- **assumption_drift**: Assumptions becoming stale or contradicted by outcomes
- **stale_assumption**: Assumptions not validated within expected timeframe
- **stale_running_action**: Actions stuck in running state for over 4 hours

---

## Behavior Guard

Guard is the heart of DashClaw. Every action can be checked against policies before execution. Returns allow, warn, block, or require_approval based on configured guard policies.

### claw.guard(context, options?)
Evaluate guard policies for a proposed action. Call this before risky operations to get a go/no-go decision. The agent_id is auto-attached from the SDK constructor.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| context.action_type | string | Yes | The type of action being proposed |
| context.risk_score | number | No | Risk score 0-100 |
| context.systems_touched | string[] | No | Systems this action will affect |
| context.reversible | boolean | No | Whether the action can be undone |
| context.declared_goal | string | No | What the action accomplishes |
| options.includeSignals | boolean | No | Also check live risk signals (adds latency) |

**Returns:** `Promise<{ decision: string, reasons: string[], warnings: string[], matched_policies: string[], evaluated_at: string }>`

### claw.getGuardDecisions(filters?)
Retrieve recent guard evaluation decisions for audit and review.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.decision | string | No | Filter by decision: allow, warn, block, require_approval |
| filters.limit | number | No | Max results (default 20, max 100) |
| filters.offset | number | No | Pagination offset |

**Returns:** `Promise<{ decisions: Object[], total: number, stats: Object }>`

---

## Dashboard Data

Push data from your agent directly to the DashClaw dashboard. All methods auto-attach the agent's agentId.

### claw.reportTokenUsage(usage)
Report a token usage snapshot for this agent.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tokens_in | number | Yes | Input tokens consumed |
| tokens_out | number | Yes | Output tokens generated |
| context_used | number | No | Context window tokens used |
| context_max | number | No | Context window max capacity |
| model | string | No | Model name |

**Returns:** `Promise<{snapshot: Object}>`

### claw.wrapClient(llmClient, options?)
Wrap an Anthropic or OpenAI client to auto-report token usage after every call. Returns the same client instance for fluent usage. Streaming calls (where response lacks `.usage`) are safely ignored.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| llmClient | Object | Yes | An Anthropic or OpenAI SDK client instance |
| options.provider | string | No | Force `'anthropic'` or `'openai'` if auto-detect fails |

**Returns:** The wrapped client (same instance)

**Example (Anthropic):**
```javascript
import Anthropic from '@anthropic-ai/sdk';
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({ baseUrl: 'http://localhost:3000', agentId: 'my-agent', apiKey: '...' });
const anthropic = claw.wrapClient(new Anthropic());

const msg = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
// Token usage auto-reported to DashClaw
```

**Example (OpenAI):**
```javascript
import OpenAI from 'openai';

const openai = claw.wrapClient(new OpenAI());

const chat = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
// Token usage auto-reported to DashClaw
```

### claw.recordDecision(entry)
Record a decision for the learning database. Track what your agent decides and why.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| decision | string | Yes | What was decided |
| context | string | No | Context around the decision |
| reasoning | string | No | Why this decision was made |
| outcome | string | No | "success", "failure", or "pending" |
| confidence | number | No | Confidence level 0-100 |

**Returns:** `Promise<{ decision: Object }>`

### claw.getRecommendations(filters?)
Get adaptive recommendations synthesized from scored historical episodes.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.action_type | string | No | Filter by action type |
| filters.agent_id | string | No | Override agent scope (defaults to SDK agent) |
| filters.include_inactive | boolean | No | Include disabled recommendations (admin/service only) |
| filters.track_events | boolean | No | Record fetched telemetry (default true) |
| filters.include_metrics | boolean | No | Include computed metrics in response |
| filters.lookback_days | number | No | Lookback window for include_metrics |
| filters.limit | number | No | Max results (default 50) |

**Returns:** `Promise<{ recommendations: Object[], metrics?: Object, total: number }>`

### claw.getRecommendationMetrics(filters?)
Get recommendation telemetry and effectiveness deltas.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.action_type | string | No | Filter by action type |
| filters.agent_id | string | No | Override agent scope (defaults to SDK agent) |
| filters.lookback_days | number | No | Lookback window (default 30) |
| filters.limit | number | No | Max recommendations to evaluate (default 100) |
| filters.include_inactive | boolean | No | Include disabled recommendations (admin/service only) |

**Returns:** `Promise<{ metrics: Object[], summary: Object, lookback_days: number }>`

### claw.recordRecommendationEvents(events)
Write recommendation telemetry events (single event or batch).

**Returns:** `Promise<{ created: Object[], created_count: number }>`

### claw.setRecommendationActive(recommendationId, active)
Enable or disable one recommendation.

**Returns:** `Promise<{ recommendation: Object }>`

### claw.rebuildRecommendations(options?)
Recompute recommendations from recent learning episodes.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| options.action_type | string | No | Restrict rebuild to one action type |
| options.lookback_days | number | No | Episode history window (default 30) |
| options.min_samples | number | No | Minimum samples per recommendation (default 5) |
| options.episode_limit | number | No | Episode scan cap (default 5000) |
| options.action_id | string | No | Score this action before rebuilding |

**Returns:** `Promise<{ recommendations: Object[], total: number, episodes_scanned: number }>`

### claw.recommendAction(action)
Apply top recommendation hints to an action payload without mutating the original object.

**Returns:** `Promise<{ action: Object, recommendation: Object|null, adapted_fields: string[] }>`

### claw.createGoal(goal)
Create a goal in the goals tracker.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | Yes | Goal title |
| category | string | No | Goal category |
| description | string | No | Detailed description |
| target_date | string | No | Target completion date (ISO string) |
| progress | number | No | Progress 0-100 |
| status | string | No | "active", "completed", or "paused" |

**Returns:** `Promise<{ goal: Object }>`

### claw.recordContent(content)
Record content creation (articles, posts, documents).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | Yes | Content title |
| platform | string | No | Platform (e.g., "linkedin", "twitter") |
| status | string | No | "draft" or "published" |
| url | string | No | Published URL |

**Returns:** `Promise<{ content: Object }>`

### claw.recordInteraction(interaction)
Record a relationship interaction (message, meeting, email).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| summary | string | Yes | What happened |
| contact_name | string | No | Contact name (auto-resolves to contact_id) |
| contact_id | string | No | Direct contact ID |
| direction | string | No | "inbound" or "outbound" |
| type | string | No | Interaction type (e.g., "message", "meeting", "email") |
| platform | string | No | Platform used |

**Returns:** `Promise<{ interaction: Object }>`

### claw.reportConnections(connections)
Report active connections/integrations for this agent.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| connections | Object[] | Yes | Array of connection objects |
| connections[].provider | string | Yes | Service name (e.g., "anthropic", "github") |
| connections[].authType | string | No | Auth method |
| connections[].planName | string | No | Plan name |
| connections[].status | string | No | Connection status |
| connections[].metadata | Object|string | No | Optional metadata |

**Returns:** `Promise<{ connections: Object[], created: number }>`

### claw.createCalendarEvent(event)
Create a calendar event.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| summary | string | Yes | Event title/summary |
| start_time | string | Yes | Start time (ISO string) |
| end_time | string | No | End time (ISO string) |
| location | string | No | Event location |
| description | string | No | Event description |

**Returns:** `Promise<{event: Object}>`

### claw.recordIdea(idea)
Record an idea or inspiration for later review.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | Yes | Idea title |
| description | string | No | Detailed description |
| category | string | No | Category |
| score | number | No | Priority/quality score 0-100 |
| status | string | No | "pending", "in_progress", "shipped", "rejected" |
| source | string | No | Where this idea came from |

**Returns:** `Promise<{idea: Object}>`

### claw.reportMemoryHealth(report)
Report a memory health snapshot with entities and topics.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| health | Object | Yes | Health metrics (must include `score` 0-100) |
| entities | Object[] | No | Key entities found in memory |
| topics | Object[] | No | Topics/themes found in memory |

**Returns:** `Promise<{snapshot: Object, entities_count: number, topics_count: number}>`

---

## Session Handoffs

### claw.createHandoff(handoff)
Create a session handoff document summarizing work done, decisions made, and next priorities.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| summary | string | Yes | Session summary |
| session_date | string | No | Date string (defaults to today) |
| key_decisions | string[] | No | Key decisions made this session |
| open_tasks | string[] | No | Tasks still open |
| mood_notes | string | No | User mood/energy observations |
| next_priorities | string[] | No | What to focus on next |

**Returns:** `Promise<{handoff: Object, handoff_id: string}>`

### claw.getHandoffs(filters?)
Get handoffs for this agent with optional date and limit filters.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| date | string | No | Filter by session_date |
| limit | number | No | Max results |

**Returns:** `Promise<{handoffs: Object[], total: number}>`

### claw.getLatestHandoff()
Get the most recent handoff for this agent. Useful for resuming context at the start of a new session.

**Returns:** `Promise<{handoff: Object|null}>`

**Example:**
```javascript
const { handoff } = await claw.getLatestHandoff();
if (handoff) {
  console.log('Last session:', handoff.summary);
  console.log('Next priorities:', handoff.next_priorities);
}
```

---

## Context Manager

Capture key points and organize context into threads for long-running topics.

### claw.captureKeyPoint(point)
Capture a key point from the current session for later recall.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| content | string | Yes | The key point content |
| category | string | No | decision, task, insight, question, general |
| importance | number | No | Importance 1-10 (default 5) |
| session_date | string | No | Date string (defaults to today) |

**Returns:** `Promise<{point: Object, point_id: string}>`

### claw.createThread(thread)
Create a context thread for tracking a topic across multiple entries.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Thread name (unique per agent per org) |
| summary | string | No | Initial summary |

**Returns:** `Promise<{thread: Object, thread_id: string}>`

### claw.getKeyPoints(filters?)
Get key points with optional filters.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| category | string | No | Filter by category: decision, task, insight, question, general |
| session_date | string | No | Filter by date (YYYY-MM-DD) |
| limit | number | No | Max results |

**Returns:** `Promise<{points: Object[], total: number}>`

### claw.addThreadEntry(threadId, content, entryType?)
Add an entry to an existing thread.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| threadId | string | Yes | The thread ID |
| content | string | Yes | Entry content |
| entryType | string | No | Entry type (default: "note") |

**Returns:** `Promise<{entry: Object, entry_id: string}>`

### claw.closeThread(threadId, summary?)
Close a context thread with an optional final summary.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| threadId | string | Yes | The thread ID to close |
| summary | string | No | Final summary for the thread |

**Returns:** `Promise<{thread: Object}>`

### claw.getThreads(filters?)
Get context threads with optional filters.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by status: active, closed |
| limit | number | No | Max results |

**Returns:** `Promise<{threads: Object[], total: number}>`

### claw.getContextSummary()
Get a combined context summary containing today's key points and all active threads. Convenience method that calls `getKeyPoints()` and `getThreads()` in parallel.

**Returns:** `Promise<{points: Object[], threads: Object[]}>`

**Example:**
```javascript
const { points, threads } = await claw.getContextSummary();
console.log(`${points.length} key points today, ${threads.length} active threads`);
```

---

## Automation Snippets

Save, search, and reuse code snippets across agent sessions.

### claw.saveSnippet(snippet)
Save or update a reusable code snippet. Upserts on name.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Snippet name (unique per org) |
| code | string | Yes | The snippet code |
| description | string | No | What this snippet does |
| language | string | No | Programming language |
| tags | string[] | No | Tags for categorization |

**Returns:** `Promise<{snippet: Object, snippet_id: string}>`

**Example:**
```javascript
await claw.saveSnippet({
  name: 'fetch-with-retry',
  code: 'async function fetchRetry(url, n = 3) { ... }',
  language: 'javascript',
  tags: ['fetch', 'retry'],
});
```

### claw.getSnippet(snippetId)
Fetch a single snippet by ID.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snippetId | string | Yes | The snippet ID |

**Returns:** `Promise<{snippet: Object}>`

**Example:**
```javascript
const { snippet } = await claw.getSnippet('sn_abc123');
console.log(snippet.name, snippet.language);
```

### claw.getSnippets(filters?)
Search and list snippets.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| search | string | No | Search name/description |
| tag | string | No | Filter by tag |
| language | string | No | Filter by language |
| limit | number | No | Max results |

**Returns:** `Promise<{snippets: Object[], total: number}>`

**Example:**
```javascript
const { snippets } = await claw.getSnippets({ language: 'javascript' });
```

### claw.useSnippet(snippetId)
Mark a snippet as used (increments use_count).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snippetId | string | Yes | Snippet ID |

**Returns:** `Promise<{snippet: Object}>`

**Example:**
```javascript
await claw.useSnippet('sn_abc123');
```

### claw.deleteSnippet(snippetId)
Delete a snippet.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| snippetId | string | Yes | Snippet ID |

**Returns:** `Promise<{deleted: boolean, id: string}>`

**Example:**
```javascript
await claw.deleteSnippet('sn_abc123');
```

---

## User Preferences

Track user observations, learned preferences, mood/energy, and approach effectiveness across sessions.

### claw.logObservation(obs)
Log a user observation (what you noticed about the user's behavior or preferences).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| observation | string | Yes | The observation text |
| category | string | No | Category tag |
| importance | number | No | Importance 1-10 |

**Returns:** `Promise<{observation: Object, observation_id: string}>`

**Example:**
```javascript
await claw.logObservation({
  observation: 'User prefers concise responses over detailed explanations',
  category: 'communication',
  importance: 8,
});
```

### claw.setPreference(pref)
Set a learned user preference. Use this to record patterns you detect about how the user likes to work.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| preference | string | Yes | The preference description |
| category | string | No | Category tag |
| confidence | number | No | Confidence 0-100 |

**Returns:** `Promise<{preference: Object, preference_id: string}>`

### claw.logMood(entry)
Log user mood/energy for a session. Helps track patterns in productivity and satisfaction.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| mood | string | Yes | Mood description (e.g., "focused", "frustrated") |
| energy | string | No | Energy level (e.g., "high", "low") |
| notes | string | No | Additional notes |

**Returns:** `Promise<{mood: Object, mood_id: string}>`

### claw.trackApproach(entry)
Track an approach and whether it succeeded or failed. Builds a knowledge base of what works.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| approach | string | Yes | The approach description |
| context | string | No | Context for when to use this approach |
| success | boolean | No | true = worked, false = failed, undefined = just recording |

**Returns:** `Promise<{approach: Object, approach_id: string}>`

### claw.getPreferenceSummary()
Get a summary of all user preference data including observations, preferences, moods, and approaches.

**Returns:** `Promise<{summary: Object}>`

### claw.getApproaches(filters?)
Get tracked approaches with success/fail counts.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | number | No | Max results |

**Returns:** `Promise<{approaches: Object[], total: number}>`

---

## Daily Digest

### claw.getDailyDigest(date?)
Get a daily activity digest aggregated from all data sources (actions, decisions, handoffs, context, etc.).

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| date | string | No | Date string YYYY-MM-DD (defaults to today) |

**Returns:** `Promise<{date: string, digest: Object, summary: Object}>`

**Example:**
```javascript
const { digest, summary } = await claw.getDailyDigest('2025-01-15');
console.log(`Actions: ${summary.actions_count}, Decisions: ${summary.decisions_count}`);
```

---

## Security Scanning

Scan text for sensitive data before sending it anywhere. The scanner detects API keys, tokens, PII, and other secrets.

### claw.scanContent(text, destination?)
Scan text for sensitive data. Returns findings and redacted text. Does NOT store the original content.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Yes | Text to scan |
| destination | string | No | Where this text is headed (for context) |

**Returns:** `Promise<{clean: boolean, findings_count: number, findings: Object[], redacted_text: string}>`

**Example:**
```javascript
const result = await claw.scanContent(
  'Deploy with key sk-abc123xyz to production',
  'slack'
);
if (!result.clean) {
  console.log(`Found ${result.findings_count} issues`);
  console.log('Safe version:', result.redacted_text);
}
```

### claw.reportSecurityFinding(text, destination?)
Scan text and store finding metadata for audit trails. The original content is never stored, only the finding metadata.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Yes | Text to scan |
| destination | string | No | Where this text is headed |

**Returns:** `Promise<{clean: boolean, findings_count: number, findings: Object[], redacted_text: string}>`

### claw.scanPromptInjection(text, options?)
Scan text for prompt injection attacks — role overrides, delimiter injection, instruction smuggling, data exfiltration attempts, and encoding evasion. Returns risk level and actionable recommendation.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Yes | Text to scan for injection attacks |
| options.source | string | No | Where this text came from (e.g. user_input, tool_output, retrieval) |

**Returns:** `Promise<{clean: boolean, risk_level: string, recommendation: string, findings_count: number, critical_count: number, categories: string[], findings: Object[]}>`

**Example:**
```javascript
const result = await claw.scanPromptInjection(userMessage, { source: 'user_input' });
if (result.recommendation === 'block') {
  console.error(`Blocked: ${result.findings_count} injection patterns detected`);
} else if (result.recommendation === 'warn') {
  console.warn(`Warning: ${result.categories.join(', ')} detected`);
}
```

---

## Agent Messaging

### claw.sendMessage(params)
Send a message to another agent or broadcast.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| to | string | No | Target agent ID (null = broadcast) |
| type | string | No | info, action, lesson, question, status |
| subject | string | No | Subject line (max 200 chars) |
| body | string | Yes | Message body (max 2000 chars) |
| threadId | string | No | Thread ID to attach to |
| urgent | boolean | No | Mark as urgent |
| docRef | string | No | Reference to a shared doc ID |
| attachments | Array<{filename, mime_type, data}> | No | File attachments (base64, max 3, max 5MB each) |

**Returns:** `Promise<{message: Object, message_id: string}>`

### claw.getInbox(params?)
Get inbox messages for this agent.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | No | Filter by message type |
| unread | boolean | No | Only unread messages |
| threadId | string | No | Filter by thread |
| limit | number | No | Max messages to return (default: 50) |

**Returns:** `Promise<{messages: Object[], total: number, unread_count: number}>`

### claw.markRead(messageIds)
Mark messages as read.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| messageIds | string[] | Yes | Array of message IDs to mark read |

**Returns:** `Promise<{updated: number}>`

### claw.archiveMessages(messageIds)
Archive messages.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| messageIds | string[] | Yes | Array of message IDs to archive |

**Returns:** `Promise<{updated: number}>`

### claw.broadcast(params)
Broadcast a message to all agents in the organization.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | No | Message type (default: "info") |
| subject | string | No | Subject line |
| body | string | Yes | Message body |
| threadId | string | No | Thread ID |

**Returns:** `Promise<{message: Object, message_id: string}>`

### claw.createMessageThread(params)
Create a new message thread for multi-turn conversations between agents.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Thread name |
| participants | string[] | No | Agent IDs (null = open to all) |

**Returns:** `Promise<{thread: Object, thread_id: string}>`

### claw.getMessageThreads(params?)
List message threads.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by status: open, resolved, archived |
| limit | number | No | Max threads to return (default: 20) |

**Returns:** `Promise<{threads: Object[], total: number}>`

### claw.resolveMessageThread(threadId, summary?)
Resolve (close) a message thread with an optional summary.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| threadId | string | Yes | Thread ID to resolve |
| summary | string | No | Resolution summary |

**Returns:** `Promise<{thread: Object}>`

### claw.saveSharedDoc(params)
Create or update a shared workspace document. Upserts by name.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Document name (unique per org) |
| content | string | Yes | Document content |

**Returns:** `Promise<{doc: Object, doc_id: string}>`

### claw.getAttachmentUrl(attachmentId)

Get a URL to download an attachment.

| Parameter | Type | Description |
|---|---|---|
| `attachmentId` | `string` | Attachment ID (`att_*`) |

**Returns:** `string`: URL to fetch the attachment binary

---

### claw.getAttachment(attachmentId)

Download an attachment as a Buffer.

| Parameter | Type | Description |
|---|---|---|
| `attachmentId` | `string` | Attachment ID (`att_*`) |

**Returns:** `Promise<{ data: Buffer, filename: string, mimeType: string }>`

```js
const inbox = await claw.getInbox();
for (const msg of inbox.messages) {
  for (const att of msg.attachments || []) {
    const { data, filename } = await claw.getAttachment(att.id);
    fs.writeFileSync(filename, data);
  }
}
```

---

## Agent Pairing

Pair agents with user accounts via public key registration and approval flow.

### claw.createPairing(options)
Create an agent pairing request. Returns a link the user can click to approve the pairing.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| publicKeyPem | string | Yes | PEM public key (SPKI format) to register for this agent |
| algorithm | string | No | Signing algorithm (default: "RSASSA-PKCS1-v1_5") |
| agentName | string | No | Agent name override |

**Returns:** `Promise<{pairing: Object, pairing_url: string}>`

### claw.createPairingFromPrivateJwk(privateJwk, options?)
Convenience method that derives the public PEM from a private JWK and creates a pairing request.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| privateJwk | Object | Yes | Private key in JWK format |
| options.agentName | string | No | Agent name override |

**Returns:** `Promise<{pairing: Object, pairing_url: string}>`

### claw.waitForPairing(pairingId, options?)
Poll a pairing request until it is approved or expired.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| pairingId | string | Yes | The pairing ID to poll |
| options.timeout | number | No | Max wait time in ms (default: 300000 / 5 min) |
| options.interval | number | No | Poll interval in ms (default: 2000) |

**Returns:** `Promise<Object>` (the approved pairing object)

**Throws:** `Error` if pairing expires or times out.

**Example:**
```javascript
const { pairing, pairing_url } = await claw.createPairing({
  publicKeyPem: myPublicKeyPem,
});
console.log('Approve pairing at:', pairing_url);

const approved = await claw.waitForPairing(pairing.id);
console.log('Pairing approved!', approved.status);
```

---

## Identity Binding

Register and manage agent public keys for cryptographic identity verification.

### claw.registerIdentity(identity)
Register or update an agent's public key for identity verification. Requires admin API key.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agent_id | string | Yes | Agent ID to register |
| public_key | string | Yes | PEM public key (SPKI format) |
| algorithm | string | No | Signing algorithm (default: "RSASSA-PKCS1-v1_5") |

**Returns:** `Promise<{identity: Object}>`

### claw.getIdentities()
List all registered agent identities for this organization.

**Returns:** `Promise<{identities: Object[]}>`

---

## Organization Management

Manage organizations and API keys. All methods require admin API key.

### claw.getOrg()
Get the current organization's details.

**Returns:** `Promise<{organizations: Object[]}>`

### claw.createOrg(org)
Create a new organization with an initial admin API key.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Organization name |
| slug | string | Yes | URL-safe slug (lowercase alphanumeric + hyphens) |

**Returns:** `Promise<{organization: Object, api_key: Object}>`

### claw.getOrgById(orgId)
Get organization details by ID.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| orgId | string | Yes | Organization ID |

**Returns:** `Promise<{organization: Object}>`

### claw.updateOrg(orgId, updates)
Update organization details.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| orgId | string | Yes | Organization ID |
| updates | Object | Yes | Fields to update (name, slug) |

**Returns:** `Promise<{organization: Object}>`

### claw.getOrgKeys(orgId)
List API keys for an organization.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| orgId | string | Yes | Organization ID |

**Returns:** `Promise<{keys: Object[]}>`

---

## Activity Logs

### claw.getActivityLogs(filters?)
Get activity/audit logs for the organization.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action | string | No | Filter by action type |
| actor_id | string | No | Filter by actor |
| resource_type | string | No | Filter by resource type |
| before | string | No | Before timestamp (ISO string) |
| after | string | No | After timestamp (ISO string) |
| limit | number | No | Max results (default: 50, max: 200) |
| offset | number | No | Pagination offset |

**Returns:** `Promise<{logs: Object[], stats: Object, pagination: Object}>`

---

## Webhooks

Subscribe to DashClaw events and receive real-time notifications.

### claw.getWebhooks()
List all webhooks for this organization.

**Returns:** `Promise<{webhooks: Object[]}>`

### claw.createWebhook(webhook)
Create a new webhook subscription.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | Webhook endpoint URL |
| events | string[] | No | Event types to subscribe to |

**Returns:** `Promise<{webhook: Object}>`

### claw.deleteWebhook(webhookId)
Delete a webhook.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| webhookId | string | Yes | Webhook ID |

**Returns:** `Promise<{deleted: boolean}>`

### claw.testWebhook(webhookId)
Send a test event to a webhook to verify connectivity.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| webhookId | string | Yes | Webhook ID |

**Returns:** `Promise<{delivery: Object}>`

### claw.getWebhookDeliveries(webhookId)
Get delivery history for a webhook.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| webhookId | string | Yes | Webhook ID |

**Returns:** `Promise<{deliveries: Object[]}>`

---

## Bulk Sync

### claw.syncState(state)
Push multiple data categories in a single request. Accepts connections, memory, goals, learning, content, inspiration, context_points, context_threads, handoffs, preferences, and snippets.

**Returns:** `Promise<{results: Object, total_synced: number, total_errors: number, duration_ms: number}>`

---

## Policy Testing

Run guardrails tests, generate compliance proof reports, and import policy packs.

### claw.testPolicies()
Run guardrails tests against all active policies. Returns pass/fail results per policy.

**Returns:** `Promise<{ results: Object[], total: number, passed: number, failed: number }>`

**Example:**
```javascript
const report = await claw.testPolicies();
console.log(`${report.passed}/${report.total} policies passed`);
for (const r of report.results.filter(r => !r.passed)) {
  console.log(`FAIL: ${r.policy}: ${r.reason}`);
}
```

### claw.getProofReport(options?)
Generate a compliance proof report summarizing guard decisions, policy evaluations, and audit evidence.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| format | string | No | Output format: "json" (default) or "md" |

**Returns:** `Promise<{ report: Object|string }>`

### claw.importPolicies({ pack?, yaml? })
Import a policy pack or raw YAML. Admin only. Replaces or merges into active policies.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| pack | string | No | Named policy pack: enterprise-strict, smb-safe, startup-growth, development |
| yaml | string | No | Raw YAML policy definition |

**Returns:** `Promise<{ imported: number, policies: Object[] }>`

---

## Compliance Engine

Map policies to regulatory frameworks, run gap analysis, and generate compliance reports.

### claw.mapCompliance(framework)
Map active policies to framework controls. Returns a control-by-control coverage matrix.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| framework | string | Yes | Target framework: soc2, iso27001, gdpr, nist-ai-rmf, imda-agentic |

**Returns:** `Promise<{ framework: string, controls: Object[], coverage_pct: number }>`

**Example:**
```javascript
const { controls, coverage_pct } = await claw.mapCompliance('soc2');
console.log(`SOC 2 coverage: ${coverage_pct}%`);
for (const ctrl of controls.filter(c => !c.covered)) {
  console.log(`Gap: ${ctrl.id}: ${ctrl.name}`);
}
```

### claw.analyzeGaps(framework)
Run gap analysis with remediation plan. Identifies missing controls and suggests policy changes.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| framework | string | Yes | Target framework: soc2, iso27001, gdpr, nist-ai-rmf, imda-agentic |

**Returns:** `Promise<{ framework: string, gaps: Object[], remediation_plan: Object[] }>`

### claw.getComplianceReport(framework, options?)
Generate a full compliance report and save a point-in-time snapshot.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| framework | string | Yes | Target framework |
| options.format | string | No | Output format: "json" (default) or "md" |

**Returns:** `Promise<{ report: Object|string, snapshot_id: string }>`

### claw.listFrameworks()
List all available compliance frameworks with metadata.

**Returns:** `Promise<{ frameworks: Object[] }>`

### claw.getComplianceEvidence(options?)
Get live guard decision evidence for compliance audits. Returns timestamped decision records.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| options.window | string | No | Time window: "7d" (default), "30d", "90d" |

**Returns:** `Promise<{ evidence: Object[], window: string, total: number }>`

---

## Task Routing

Route tasks to agents based on capabilities, availability, and workload. Manage the agent pool and monitor routing health.

### claw.listRoutingAgents(filters?)
List registered routing agents with optional status filter.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.status | string | No | Filter by status: available, busy, offline |

**Returns:** `Promise<{ agents: Object[], total: number }>`

### claw.registerRoutingAgent(agent)
Register a new agent in the routing pool.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Agent display name |
| capabilities | string[] | No | List of skills/capabilities |
| maxConcurrent | number | No | Max concurrent tasks (default: 1) |
| endpoint | string | No | Agent callback endpoint URL |

**Returns:** `Promise<{ agent: Object, agent_id: string }>`

### claw.getRoutingAgent(agentId)
Get a single routing agent with current metrics.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agentId | string | Yes | The routing agent ID |

**Returns:** `Promise<{ agent: Object, metrics: Object }>`

### claw.updateRoutingAgentStatus(agentId, status)
Update a routing agent's availability status.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agentId | string | Yes | The routing agent ID |
| status | string | Yes | New status: available, busy, offline |

**Returns:** `Promise<{ agent: Object }>`

### claw.deleteRoutingAgent(agentId)
Remove an agent from the routing pool.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| agentId | string | Yes | The routing agent ID |

**Returns:** `Promise<{ deleted: boolean, id: string }>`

### claw.listRoutingTasks(filters?)
List routing tasks with optional filters.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.status | string | No | Filter by status: pending, assigned, completed, failed |
| filters.agent_id | string | No | Filter by assigned agent |
| filters.limit | number | No | Max results (default: 50) |
| filters.offset | number | No | Pagination offset |

**Returns:** `Promise<{ tasks: Object[], total: number }>`

### claw.submitRoutingTask(task)
Submit a task for automatic routing to the best available agent.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | Yes | Task title |
| description | string | No | Detailed description |
| requiredSkills | string[] | No | Skills needed to handle this task |
| urgency | string | No | low, medium, high, critical (default: medium) |
| timeoutSeconds | number | No | Task timeout in seconds |
| maxRetries | number | No | Max retry attempts on failure |
| callbackUrl | string | No | URL to notify on completion |

**Returns:** `Promise<{ task: Object, task_id: string, assigned_agent: Object|null }>`

**Example:**
```javascript
const { task_id, assigned_agent } = await claw.submitRoutingTask({
  title: 'Analyze quarterly metrics',
  description: 'Pull Q4 data and generate summary report',
  requiredSkills: ['data-analysis', 'reporting'],
  urgency: 'high',
  timeoutSeconds: 600,
  callbackUrl: 'https://hooks.example.com/task-done',
});
console.log(`Task ${task_id} assigned to ${assigned_agent?.name ?? 'queue'}`);
```

### claw.completeRoutingTask(taskId, result?)
Mark a routing task as completed with optional result payload.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | The task ID |
| result | Object | No | Task result data |

**Returns:** `Promise<{ task: Object }>`

### claw.getRoutingStats()
Get aggregate routing statistics (throughput, latency, agent utilization).

**Returns:** `Promise<{ stats: Object }>`

### claw.getRoutingHealth()
Get routing system health status and diagnostics.

**Returns:** `Promise<{ healthy: boolean, agents: Object, tasks: Object, latency: Object }>`

---

## Agent Schedules

Define recurring tasks and cron-based schedules for agents.

### claw.listAgentSchedules(filters?)
List agent schedules, optionally filtered by agent.

```javascript
const { schedules } = await claw.listAgentSchedules({ agent_id: 'forge' });
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| filters.agent_id | string | No | Filter by agent ID |

**Returns:** `Promise<{ schedules: Object[] }>`

### claw.createAgentSchedule(schedule)
Create a new agent schedule entry.

```javascript
const { schedule } = await claw.createAgentSchedule({
  agent_id: 'forge',
  name: 'Build projects',
  cron_expression: '0 */6 * * *',
  description: 'Check for pending builds every 6 hours'
});
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| schedule.agent_id | string | Yes | Agent this schedule belongs to |
| schedule.name | string | Yes | Schedule name |
| schedule.cron_expression | string | Yes | Cron expression (e.g. `0 */6 * * *`) |
| schedule.description | string | No | Human-readable description |
| schedule.enabled | boolean | No | Whether schedule is active (default: true) |

**Returns:** `Promise<{ schedule: Object }>`

---

## Error Handling

All SDK methods throw on non-2xx responses. Errors include `status` (HTTP code) and `details` (when available).

```javascript
try {
  await claw.createAction({ ... });
} catch (err) {
  if (err.status === 401) {
    console.error('Invalid API key');
  } else {
    console.error(`Action failed: \${err.message}`);
  }
}
```
