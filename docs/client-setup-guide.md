# DashClaw: Complete Setup & Usage Guide

> **What is DashClaw?** AI agent decision infrastructure. It gives you a control plane to prove what your agents decided, enforce policies before they act, and track every assumption and risk signal. Think of it as the governance layer for your agent fleet.
>
> **Live Demo (fake data):** https://dashclaw.io/demo
> **Your Dashboard (self-host):** http://localhost:3000 (or `https://YOUR_DASHCLAW_HOST`)
> **SDK Docs:** `/docs` on any DashClaw instance (or https://dashclaw.io/docs)
> **npm Package:** `dashclaw`

---

## Table of Contents

1. [Getting Started (First 5 Minutes)](#1-getting-started-first-5-minutes)
2. [Installing the SDK](#2-installing-the-sdk)
3. [Recording Your First Action](#3-recording-your-first-action)
4. [Core Concepts](#4-core-concepts)
5. [SDK Method Reference](#5-sdk-method-reference)
6. [Dashboard Pages Guide](#6-dashboard-pages-guide)
7. [Behavior Guard (Controlling Agent Actions)](#7-behavior-guard-controlling-agent-actions)
8. [Risk Signals (Automatic Signal Detection)](#8-risk-signals-automatic-signal-detection)
9. [Agent Workspace](#9-agent-workspace)
10. [Agent-to-Agent Messaging](#10-agent-to-agent-messaging)
11. [Bootstrap an Existing Agent](#11-bootstrap-an-existing-agent)
12. [Team Management](#12-team-management)
13. [Webhooks & Email Alerts](#13-webhooks--email-alerts)
14. [Usage & Plans](#14-usage--plans)
15. [Token & Cost Analytics](#15-token--cost-analytics)
16. [CLI Tools](#16-cli-tools)
17. [Security Best Practices](#17-security-best-practices)
18. [FAQ & Troubleshooting](#18-faq--troubleshooting)

---

## 1. Getting Started (First 5 Minutes)

### Step 1: Open The Right Dashboard

If you just want to see what DashClaw looks like, open the demo: **https://dashclaw.io/demo**.
In the demo, there is **no login** and all data/actions are fake.

If you want to connect your real agents, you must run your own dashboard (self-host) and use **your** base URL (example: **http://localhost:3000**).

Go to your dashboard:
- Visit `YOUR_BASE_URL/dashboard`
- If auth is enabled, you will be redirected to `YOUR_BASE_URL/login`.

Local dev note (current): the dashboard UI uses NextAuth (OAuth) on localhost. Configure at least one provider callback URL:

- GitHub: `http://localhost:3000/api/auth/callback/github`
- Google: `http://localhost:3000/api/auth/callback/google`

If you see "redirect_uri is not associated with this application", your OAuth app is missing the callback URL above.

If you only want to preview the UI without login, use the demo sandbox: `YOUR_BASE_URL/demo` (fake data, read-only).

You can sign in with:
- **GitHub** (recommended for developers)
- **Google**

After signing in, you'll land on the **Dashboard** with a guided onboarding checklist.

### Step 2: Create Your Workspace

The onboarding checklist walks you through 4 steps. First, create a workspace:

1. Enter a **workspace name** (e.g., "Acme AI Agents")
2. Click **Create Workspace**

This creates an isolated organization for your data. You become the **admin**.

### Step 3: Generate an API Key

Click the **Generate API Key** button. You'll see a key like:

```
oc_live_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

**Save this key immediately.** It is shown only once. Store it as an environment variable:

```bash
# Add to your agent's .env file
DASHCLAW_API_KEY=oc_live_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

### Step 4: Install the SDK

```bash
npm install dashclaw
```

Requirements: **Node.js 20+** recommended (uses native `fetch`).

### Step 5: Send Your First Action

Add this to your agent's code:

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  // Tip: scripts/init-self-host-env.mjs prints DASHCLAW_BASE_URL for your agents.
  baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',          // unique ID for this agent
  agentName: 'My First Agent',  // human-readable name (optional)
});

// Record an action
const { action_id } = await claw.createAction({
  action_type: 'build',
  declared_goal: 'Hello from my agent!',
  risk_score: 10,
});

console.log('Action created:', action_id);
```

Run your agent. The onboarding checklist detects the action within 5 seconds and completes automatically.

**You're set up.** The rest of this guide covers everything DashClaw can do.

---

## 2. Installing the SDK

### Node.js (npm)

```bash
npm install dashclaw
```

### Python (pip)

```bash
# From the sdk-python directory (until published to PyPI)
pip install sdk-python/
```

Current Python SDK parity coverage includes `actions`, `approvals`, `guard`, `webhooks`, `context`, `memory`, and `messages`.
See `docs/sdk-parity.md` for the live gap matrix.

---

## 3. SDK Integration

### Node.js (ESM)

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
});
```

### One-Click Agent Pairing (Recommended)

If you want **verified agents** (signed actions), pair each agent once and approve it in the dashboard.

From the agent process, create a pairing request and print the link:

```javascript
// privateKeyJwk is the agent's private RSA key (JWK)
const { pairing, pairing_url } = await claw.createPairingFromPrivateJwk(privateKeyJwk);
console.log('Click to approve this agent:', pairing_url);

// Optional: wait for approval before sending signed actions
await claw.waitForPairing(pairing.id);
```

In the dashboard:
- Click the link to approve, or
- Approve many agents at once from `/pairings` (Pairings inbox)

### Node.js (CommonJS)

```javascript
const { create } = require('dashclaw');
const claw = await create({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
});
```

### Python

```python
from dashclaw import DashClaw

claw = DashClaw(
    base_url='http://localhost:3000',
    api_key='your-api-key',
    agent_id='my-python-agent'
)
```

---

## 4. Recording Your First Action

### Node.js (track wrapper)

```javascript
const result = await claw.track(
  { action_type: 'build', declared_goal: 'Compile assets' },
  async () => {
    // ... work ...
    return 'done';
  }
);
```

### Python (context manager)

```python
with claw.track(action_type='build', declared_goal='Compile assets'):
    # ... work ...
    print("Working...")
```

### Action Types

| Type | Use For |
|------|---------|
| `build` | Compilation, bundling, asset generation |
| `deploy` | Shipping to production, staging, etc. |
| `post` | Publishing content, sending messages |
| `apply` | Applying changes, patches, configs |
| `security` | Security scans, audits, key rotation |
| `message` | Sending emails, notifications, alerts |
| `api` | API calls, webhook triggers |
| `calendar` | Scheduling events, reminders |
| `research` | Web searches, data gathering |
| `review` | Code review, PR review, auditing |
| `fix` | Bug fixes, patches |
| `refactor` | Code cleanup, restructuring |
| `test` | Running tests, validation |
| `config` | Configuration changes |
| `monitor` | Health checks, status verification |
| `alert` | Sending alerts, escalations |
| `cleanup` | Deleting temp files, pruning data |
| `sync` | Syncing data between systems |
| `migrate` | Database migrations, data moves |
| `other` | Anything else |

---

## 4. Core Concepts

### Actions

An **action** is anything your agent does that's worth tracking. Each action has:
- **Identity**: who did it (`agent_id`), what it is (`action_type`), why (`declared_goal`, `reasoning`)
- **Risk**: `risk_score` (0-100), `reversible`, `confidence`, `authorization_scope`
- **Context**: `systems_touched`, `trigger`, `input_summary`
- **Outcome**: `status`, `output_summary`, `side_effects`, `artifacts_created`, `error_message`
- **Timing**: `timestamp_start`, `timestamp_end`, `duration_ms`
- **Hierarchy**: `parent_action_id` links sub-actions to parent actions

### Open Loops

An **open loop** is something unresolved â€" a pending follow-up, a question waiting for an answer, a dependency that hasn't been met. Track them to prevent things falling through the cracks.

Types: `followup`, `question`, `dependency`, `approval`, `review`, `handoff`, `other`
Priorities: `low`, `medium`, `high`, `critical`

### Assumptions

An **assumption** is something your agent believes to be true. Log assumptions so they can be validated or invalidated later. When assumptions go wrong, you have a paper trail for root-cause analysis.

### Risk Signals

DashClaw automatically detects 7 risk patterns (see [Section 8](#8-risk-signals-automatic-signal-detection)). No configuration needed â€" signals fire automatically based on your agent's behavior data.

### Guard Policies

Guard policies let you control what agents can do before they do it. Set risk thresholds, require approvals, block certain action types, or call external webhooks for custom logic.

### Multi-Tenancy

Each workspace is fully isolated. API keys are scoped to an organization. Agents only see their org's data. Multiple workspaces can run on the same DashClaw instance.

---

## 5. SDK Method Reference

The SDK has **60+ methods** across 13+ categories. Every method returns a Promise.

### Action Recording (7 methods)

```javascript
// Create an action
const { action_id } = await claw.createAction({
  action_type: 'build',         // required
  declared_goal: 'Build X',     // required
  risk_score: 30,               // optional, 0-100
  systems_touched: ['api'],     // optional
  reversible: true,             // optional
  confidence: 80,               // optional, 0-100
  reasoning: 'Weekly build',    // optional
  trigger: 'schedule',          // optional
  authorization_scope: 'read',  // optional
  input_summary: '...',         // optional
  parent_action_id: 'act_xxx',  // optional
});

// Update outcome
await claw.updateOutcome(action_id, {
  status: 'completed',
  output_summary: 'Done',
  side_effects: ['Cache invalidated'],
  artifacts_created: ['bundle.js'],
  error_message: null,
  duration_ms: 12000,
  cost_estimate: 0.05,
});

// List actions
const { actions, total, stats } = await claw.getActions({
  agent_id: 'my-agent',  // optional filter
  status: 'running',     // optional filter
  action_type: 'deploy', // optional filter
  risk_min: 50,          // optional, min risk score
  limit: 50,             // optional, default 50
  offset: 0,             // optional, pagination
});

// Get single action (with loops + assumptions)
const { action, open_loops, assumptions } = await claw.getAction('act_xxx');

// Get root-cause trace
const { trace } = await claw.getActionTrace('act_xxx');

// Wait for human-in-the-loop approval when action enters pending state
const approvalResult = await claw.waitForApproval(action_id, {
  timeout: 300000, // optional, default 5 minutes
  interval: 5000,  // optional poll interval
});

// Track: auto-wrap action creation + outcome
const result = await claw.track(
  { action_type: 'test', declared_goal: 'Run suite' },
  async ({ action_id }) => { /* your work */ return 'passed'; }
);
```

### Loops & Assumptions (7 methods)

```javascript
// Register an open loop
const { loop_id } = await claw.registerOpenLoop({
  action_id: 'act_xxx',       // required
  loop_type: 'dependency',     // required
  description: 'Need API key', // required
  priority: 'high',            // optional: low|medium|high|critical
  owner: 'human-ops',          // optional
});

// Resolve or cancel a loop
await claw.resolveOpenLoop(loop_id, 'resolved', 'Got the key from admin');
await claw.resolveOpenLoop(loop_id, 'cancelled');

// List loops
const { loops, stats } = await claw.getOpenLoops({
  status: 'open',       // optional
  loop_type: 'approval', // optional
  priority: 'critical',  // optional
  limit: 50,            // optional
});

// Register an assumption
const { assumption_id } = await claw.registerAssumption({
  action_id: 'act_xxx',                      // required
  assumption: 'API supports batch mode',      // required
  basis: 'Saw it in the docs 2 months ago',  // optional
});

// Get a single assumption
const { assumption } = await claw.getAssumption(assumption_id);

// Validate or invalidate
await claw.validateAssumption(assumption_id, true);  // confirmed correct
await claw.validateAssumption(assumption_id, false, 'API removed batch mode in v3');

// Get drift report (assumptions with risk scoring)
const { assumptions: driftList, drift_summary } = await claw.getDriftReport({
  action_id: 'act_xxx', // optional
  limit: 50,            // optional
});
```

### Signals (1 method)

```javascript
const { signals, counts } = await claw.getSignals();
// counts = { red: 2, amber: 5, total: 7 }
```

### Dashboard Data (12 methods)

```javascript
// Report token usage/cost snapshot
await claw.reportTokenUsage({
  tokens_in: 1200,
  tokens_out: 800,
  model: 'gpt-4o',
});

// Record a decision (learning database)
await claw.recordDecision({
  decision: 'Use JWT for auth',           // required
  context: 'Evaluating session strategies', // optional
  reasoning: 'Edge-compatible, no DB',     // optional
  outcome: 'success',                      // optional: success|failure|pending
  confidence: 90,                          // optional, 0-100
});

// Get adaptive recommendations from scored episodes
const { recommendations } = await claw.getRecommendations({
  action_type: 'deploy', // optional
  limit: 10,             // optional
});

// Rebuild recommendation set (admin/service role required by API)
await claw.rebuildRecommendations({
  lookback_days: 30,
  min_samples: 5,
});

// Apply top recommendation hints to an action payload
const { action: adaptedAction, adapted_fields } = await claw.recommendAction({
  action_type: 'deploy',
  declared_goal: 'Ship v1.6',
  risk_score: 85,
});

// Create a goal
await claw.createGoal({
  title: 'Ship v2 by March',  // required
  category: 'milestone',       // optional
  description: '...',          // optional
  target_date: '2026-03-01',  // optional, ISO string
  progress: 40,                // optional, 0-100
  status: 'active',           // optional: active|completed|paused
});

// Record content
await claw.recordContent({
  title: 'API Migration Guide',  // required
  platform: 'docs',             // optional
  status: 'published',          // optional: draft|published
  url: 'https://...',           // optional
});

// Record a relationship interaction
await claw.recordInteraction({
  summary: 'Discussed deployment plan',  // required
  contact_name: 'Jane Smith',            // optional (auto-resolves to contact_id)
  direction: 'outbound',                 // optional: inbound|outbound
  type: 'meeting',                       // optional
  platform: 'zoom',                      // optional
});

// Create a calendar event
await claw.createCalendarEvent({
  summary: 'Sprint Review',             // required
  start_time: '2026-02-15T14:00:00Z',  // required, ISO string
  end_time: '2026-02-15T15:00:00Z',    // optional
  location: 'Conference Room A',        // optional
});

// Record an idea
await claw.recordIdea({
  title: 'Real-time signal streaming',  // required
  description: 'WebSocket push...',     // optional
  category: 'feature',                  // optional
  score: 85,                            // optional, 0-100
  status: 'pending',                    // optional
});

// Report memory health
await claw.reportMemoryHealth({
  health: { score: 82, total_files: 12, total_lines: 450 },
  entities: [{ name: 'auth-service', type: 'system', mention_count: 15 }],
  topics: [{ name: 'deployment', mention_count: 8 }],
});

// Report active connections/integrations
await claw.reportConnections([
  { provider: 'github', authType: 'oauth', status: 'active' },
  { provider: 'anthropic', authType: 'api_key', planName: 'Pro', status: 'active' },
]);
```

### Session Handoffs (3 methods)

```javascript
// Create a handoff (end-of-session summary)
await claw.createHandoff({
  summary: 'Finished auth refactor, tests passing',  // required
  session_date: '2026-02-11',                         // optional (defaults to today)
  key_decisions: ['Switched to JWT', 'Dropped sessions table'],
  open_tasks: ['Update SDK docs', 'Run load tests'],
  mood_notes: 'Productive session, no blockers',
  next_priorities: ['Deploy to staging', 'Update changelog'],
});

// Get handoffs
const { handoffs } = await claw.getHandoffs({ date: '2026-02-11', limit: 10 });

// Get latest handoff
const { handoff } = await claw.getLatestHandoff();
```

### Context Manager (7 methods)

```javascript
// Capture a key point
await claw.captureKeyPoint({
  content: 'Users prefer dark theme by 4:1 ratio',  // required
  category: 'insight',    // optional: decision|task|insight|question|general
  importance: 8,          // optional: 1-10 (default 5)
  session_date: '2026-02-11',  // optional
});

// Get key points
const { points } = await claw.getKeyPoints({
  category: 'decision',
  session_date: '2026-02-11',
  limit: 20,
});

// Create a thread (tracks a topic across entries)
const { thread_id } = await claw.createThread({
  name: 'Auth Architecture',  // required (unique per agent per org)
  summary: 'Tracking auth design decisions',
});

// Add entries to a thread
await claw.addThreadEntry(thread_id, 'Decided on JWT over sessions', 'note');
await claw.addThreadEntry(thread_id, 'JWT refresh token rotation added', 'note');

// Close a thread
await claw.closeThread(thread_id, 'Auth shipped to production');

// Get threads
const { threads } = await claw.getThreads({ status: 'active', limit: 20 });

// Get combined context summary (today's points + active threads)
const { points, threads } = await claw.getContextSummary();
```

### Automation Snippets (4 methods)

```javascript
// Save a reusable snippet (upserts on name)
await claw.saveSnippet({
  name: 'api-error-handler',          // required (unique per org)
  code: 'try { ... } catch (e) { }',  // required
  description: 'Standard error handler',
  language: 'javascript',
  tags: ['error', 'api', 'pattern'],
});

// Search snippets
const { snippets } = await claw.getSnippets({
  search: 'error',    // optional
  tag: 'api',         // optional
  language: 'javascript',
  limit: 20,
});

// Mark a snippet as used (increments use_count)
await claw.useSnippet('sn_xxx');

// Delete a snippet
await claw.deleteSnippet('sn_xxx');
```

### User Preferences (6 methods)

```javascript
// Log an observation about the user
await claw.logObservation({
  observation: 'User prefers concise responses',  // required
  category: 'communication',                      // optional
  importance: 8,                                   // optional, 1-10
});

// Set a learned preference
await claw.setPreference({
  preference: 'Always use TypeScript',  // required
  category: 'coding',                   // optional
  confidence: 95,                       // optional, 0-100
});

// Log mood/energy
await claw.logMood({
  mood: 'focused',    // required
  energy: 'high',     // optional
  notes: 'Morning session, no distractions',
});

// Track an approach (success/fail)
await claw.trackApproach({
  approach: 'Plan before coding',  // required
  context: 'Feature development',   // optional
  success: true,                    // optional boolean
});

// Get preference summary
const { summary } = await claw.getPreferenceSummary();

// Get tracked approaches
const { approaches } = await claw.getApproaches({ limit: 20 });
```

### Prompt Management (12 methods)

```javascript
// List prompt templates
const { templates } = await claw.listPromptTemplates({ category: 'agent' });

// Create a template
const template = await claw.createPromptTemplate({
  name: 'Code Reviewer',
  description: 'Prompt for reviewing PRs',
  category: 'agent',
});

// Get template details
const t = await claw.getPromptTemplate('pt_xxx');

// Update template
await claw.updatePromptTemplate('pt_xxx', { description: 'Updated desc' });

// Delete template
await claw.deletePromptTemplate('pt_xxx');

// List versions for a template
const { versions } = await claw.listPromptVersions('pt_xxx');

// Create a new immutable version
const version = await claw.createPromptVersion('pt_xxx', {
  content: 'Review this code: {{code}}',
  model_hint: 'gpt-4o',
  changelog: 'Initial version',
});

// Get a specific version
const v = await claw.getPromptVersion('pt_xxx', 'pv_yyy');

// Activate a version (sets is_active=true, deactivates others)
await claw.activatePromptVersion('pt_xxx', 'pv_yyy');

// Render a prompt with variables
const { rendered, run_id } = await claw.renderPrompt({
  template_id: 'pt_xxx',
  variables: { code: 'console.log("hello")' },
  record: true, // optionally track this usage
});

// List usage runs
const { runs } = await claw.listPromptRuns({ template_id: 'pt_xxx', limit: 50 });

// Get usage stats
const stats = await claw.getPromptStats({ template_id: 'pt_xxx' });
```

### Daily Digest (1 method)

```javascript
const { date, digest, summary } = await claw.getDailyDigest('2026-02-11');
// Aggregates: actions, decisions, lessons, content, ideas, interactions, goals
```

### Security Scanning (2 methods)

```javascript
// Scan text for sensitive data (18 regex patterns: API keys, tokens, PII, etc.)
const { clean, findings_count, findings, redacted_text } = await claw.scanContent(
  'My API key is sk-1234567890abcdef',
  'slack-message'  // optional destination context
);

// Scan + store finding metadata (never stores original content)
await claw.reportSecurityFinding('Text to audit', 'email');
```

### Agent Messaging (9 methods)

```javascript
// Send a message to another agent
await claw.sendMessage({
  to: 'other-agent',           // omit for broadcast
  type: 'question',            // info|action|lesson|question|status
  subject: 'Need API schema',
  body: 'Can you share the latest schema?',
  urgent: true,                // optional
});

// Broadcast to all agents
await claw.broadcast({
  type: 'status',
  subject: 'Deployment complete',
  body: 'API v2.1 is live.',
});

// Get inbox
const { messages, unread_count } = await claw.getInbox({
  type: 'question',  // optional filter
  unread: true,       // optional
  limit: 50,
});

// Mark read / archive
await claw.markRead(['msg_xxx', 'msg_yyy']);
await claw.archiveMessages(['msg_xxx']);

// Threads (multi-turn conversations)
const { thread_id } = await claw.createMessageThread({
  name: 'Deployment Coordination',
  participants: ['agent-a', 'agent-b'],  // null = open to all
});
const { threads } = await claw.getMessageThreads({ status: 'open' });
await claw.resolveMessageThread(thread_id, 'Deployment completed');

// Shared documents
await claw.saveSharedDoc({
  name: 'API Schema v2',   // unique per org, upserts on conflict
  content: '{ "endpoints": [...] }',
});
```

### Behavior Guard (2 methods)

```javascript
// Check policies before a risky action
const result = await claw.guard({
  action_type: 'deploy',
  risk_score: 85,
  systems_touched: ['production-api'],
  reversible: false,
  declared_goal: 'Deploy auth service v2',
});

if (result.decision === 'block') {
  console.log('Blocked:', result.reasons);
  return; // don't proceed
}

// Get recent guard decisions (audit log)
const { decisions, stats } = await claw.getGuardDecisions({
  decision: 'block',
  limit: 20,
});
```

### Bulk Sync (1 method)

Push all agent state in a single API call:

```javascript
await claw.syncState({
  connections: [{ provider: 'github', auth_type: 'oauth', status: 'active' }],
  memory: { health: { score: 82 }, entities: [], topics: [] },
  goals: [{ title: 'Ship v2', status: 'active' }],
  learning: [{ decision: 'Use JWT', reasoning: 'Edge compat' }],
  content: [{ title: 'API Docs', platform: 'docs' }],
  inspiration: [{ title: 'Real-time signals', category: 'feature' }],
  context_points: [{ content: 'Users prefer dark theme', category: 'insight', importance: 8 }],
  context_threads: [{ name: 'Auth Decisions', summary: 'Tracking auth choices' }],
  handoffs: [{ summary: 'Finished auth refactor', key_decisions: ['JWT'] }],
  preferences: {
    observations: [{ observation: 'Prefers dark mode' }],
    preferences: [{ preference: 'Concise responses', confidence: 90 }],
    moods: [{ mood: 'focused', energy: 'high' }],
    approaches: [{ approach: 'Plan first', success: true }],
  },
  snippets: [{ name: 'api-pattern', code: '...', language: 'javascript' }],
});
```

---

## 6. Dashboard Pages Guide

After signing in, you have access to these pages via the sidebar:

### Dashboard (`/dashboard`)

Your operational overview. Contains 12 widget cards:

- **Onboarding Checklist** â€" 4-step guided setup (auto-hides when complete)
- **Risk Signals** â€" Active signal count with severity breakdown
- **Open Loops** â€" Unresolved loops by priority
- **Recent Actions** â€" Latest agent actions with status badges
- **Projects** â€" Systems touched across all actions
- **Goals Chart** â€" Goal completion progress (visual chart)
- **Learning Stats** â€" Decisions and lessons counts
- **Follow-ups** â€" Action items and pending tasks
- **Calendar** â€" Upcoming events
- **Context** â€" Recent decisions snapshot
- **Integrations** â€" Active connections per agent
- **Memory Health** â€" Memory file health score
- **Inspiration** â€" Ideas tracker

### Actions (`/actions`)

Table of all action records. Click any action to open the **Post-Mortem Page** which shows:
- Key metrics (risk score, confidence, reversible, duration, cost)
- **Trace Graph** â€" visual SVG diagram of parent chain, assumptions, loops
- Root cause analysis (for failed/completed actions)
- Interactive assumptions (validate/invalidate with reasons)
- Interactive loops (resolve/cancel with resolution text)
- Timeline of all events
- Identity card (IDs, agent, timestamps)

### Security (`/security`)

Real-time decision integrity signals. Auto-refreshes every 30 seconds.
- Stats: Active Signals, High-Risk (24h), Unscoped Actions, Invalidated Assumptions (7d)
- Signal feed sorted by severity (dismiss individual signals or clear all)
- High-risk actions list (risk >= 70 or unscoped + irreversible)
- Click any signal/action for detail panel

### Policies (`/policies`)

Create and manage guard policies. 5 policy types available â€" see [Section 7](#7-behavior-guard-controlling-agent-actions).

### Messages (`/messages`)

Agent-to-agent communication hub with 4 tabs:
- **Inbox** â€" Received messages with read/unread status
- **Sent** â€" Outgoing messages
- **Threads** â€" Multi-turn conversations
- **Docs** â€" Shared workspace documents

### Workspace (`/workspace`)

Multi-tab agent workspace â€" see [Section 9](#9-agent-workspace).

### Content (`/content`)

Content items tracked by agents (blog posts, docs, social media).

### Relationships (`/relationships`)

Mini-CRM: contacts and interaction history.

### Learning (`/learning`)

Decisions, lessons learned, and adaptive recommendations.
`POST /api/learning/recommendations` (rebuild) requires admin/service role.

### Goals (`/goals`)

Goal tracking with milestones and progress.

### Integrations (`/integrations`)

View and configure integration credentials. Supports per-agent overrides. Shows both credential-based settings and agent-reported connections (blue dot).

### API Keys (`/api-keys`)

Manage API keys for your workspace. Admins can generate and revoke keys. The **Copy Agent Prompt** button generates a markdown prompt you can paste into any AI agent session (Claude Code, Cursor, etc.) to self-configure a connection to your dashboard. The API key is never included in the prompt.

### Team (`/team`)

Manage workspace members. Admins can invite (7-day link expiry), change roles, and remove members. See [Section 12](#12-team-management).

### Usage (`/usage`)

Usage meters for actions/agents/members/api keys. See [Section 14](#14-usage--plans).

### Activity (`/activity`)

Audit log of all admin actions (key creation, invites, role changes, billing events, etc.). 17 event types tracked.

### Webhooks (`/webhooks`)

Manage webhook endpoints for signal notifications. Max 10 per org. Auto-disabled after 10 consecutive failures.

### Notifications (`/notifications`)

Per-user email alert preferences. Choose which signal types trigger email notifications.

### Workflows (`/workflows`)

Define and track workflow/SOP definitions.

---

## 7. Behavior Guard (Controlling Agent Actions)

The Guard system lets you set rules that agents check **before** taking risky actions.

### How It Works

1. Admin creates **policies** on the Policies page
2. Agent calls `claw.guard(context)` or uses `guardMode` in constructor
3. DashClaw evaluates all active policies
4. Returns: `allow`, `warn`, `block`, or `require_approval`

### 5 Policy Types

#### Risk Threshold
Block or warn when risk score exceeds a threshold.

```
Example: Any action with risk >= 80 â†' block
```

#### Require Approval
Require human approval for specific action types.

```
Example: deploy, security â†' require_approval
```

#### Block Action Type
Unconditionally block specific action types.

```
Example: deploy â†' block (no deploys allowed)
```

#### Rate Limit
Warn or block when an agent exceeds action frequency.

```
Example: Max 20 actions per 60 minutes â†' warn
```

#### Webhook Check
Call an external HTTPS endpoint for custom decision logic. Your endpoint receives the context and preliminary decision, and can escalate (but never downgrade) the severity.

```
Example: POST to https://your-api.com/guard â†' returns { decision: 'block', reasons: ['...'] }
```

Webhook check features:
- HTTPS required (SSRF protection blocks private IPs)
- Configurable timeout (1-10 seconds, default 5s)
- Fail-open or fail-closed on timeout
- Customer can only make decisions more restrictive, never less

### Automatic Guard (guardMode)

Instead of calling `guard()` manually, enable automatic checks:

```javascript
import { DashClaw, GuardBlockedError } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  guardMode: 'enforce',  // auto-check before every createAction/track
});

try {
  await claw.createAction({
    action_type: 'deploy',
    declared_goal: 'Deploy to production',
    risk_score: 90,
  });
} catch (err) {
  if (err instanceof GuardBlockedError) {
    console.log('Blocked!', err.decision);   // 'block'
    console.log('Reasons:', err.reasons);     // ['Risk score 90 >= threshold 80']
    console.log('Policies:', err.matchedPolicies); // ['gp_xxx']
  }
}
```

| Mode | Behavior |
|------|----------|
| `'off'` | No guard check (default, backward compatible) |
| `'warn'` | Logs `console.warn` if blocked, **proceeds anyway** |
| `'enforce'` | Throws `GuardBlockedError` if blocked or requires approval |

Guard API failures are **fail-open** (logged, proceeds) in all modes.

---

## 8. Risk Signals (Automatic Signal Detection)

DashClaw automatically detects 7 risk patterns. No configuration needed.

| # | Signal | Trigger | Severity |
|---|--------|---------|----------|
| 1 | **Autonomy Spike** | Agent performs >10 actions/hour | Red if >20, amber if 10-20 |
| 2 | **High Impact, Low Oversight** | Irreversible + risk >= 70 + no authorization_scope | Red if risk >= 90, amber if 70-89 |
| 3 | **Repeated Failures** | >3 failed actions in 24 hours | Red if >5, amber if 3-5 |
| 4 | **Stale Open Loop** | Loop unresolved >48 hours | Red if >96h, amber if 48-96h |
| 5 | **Assumption Drift** | >= 2 invalidated assumptions in 7 days | Red if >= 4, amber if 2-3 |
| 6 | **Stale Assumption** | Assumption not validated >14 days | Red if >30d, amber if 14-30d |
| 7 | **Stale Running Action** | Action stuck in 'running' >4 hours | Red if >24h, amber if 4-24h |

### What to Do When Signals Fire

- **Autonomy Spike**: Review recent actions. Consider adding rate_limit guard policies.
- **High Impact, Low Oversight**: Add `authorization_scope` to high-risk actions. Set risk_threshold policies.
- **Repeated Failures**: Check error messages. Your agent may be retrying a broken operation.
- **Stale Loop**: Resolve or cancel the loop. Someone needs to respond.
- **Assumption Drift**: Validate your agent's assumptions. Conditions may have changed.
- **Stale Assumption**: Validate or invalidate. Stale assumptions cause bad decisions.
- **Stale Running**: Update the action status or investigate. The agent may be stuck.

### Notification Options

Signals can trigger:
- **Dashboard alerts** (always on)
- **Webhook deliveries** (configure on Webhooks page)
- **Email alerts** (configure on Notifications page, requires Resend API key)

---

## 9. Agent Workspace

The Workspace page (`/workspace`) is a tabbed interface for agent operational state.

### Tab 1: Overview (Daily Digest)
Aggregated daily summary with date picker. Shows action/decision/lesson/content/idea/interaction/goal counts and details.

### Tab 2: Context
Two-column view: key points (with category badges and importance scores) on the left, context threads on the right. Add new points and create threads inline.

### Tab 3: Handoffs
Timeline of session handoff documents. Each shows summary, key decisions, open tasks, mood notes, and next priorities. Perfect for agent-to-agent continuity.

### Tab 4: Snippets
Searchable library of reusable code snippets. Copy or "Use" (increments counter) snippets. Filter by language or search by name.

### Tab 5: Preferences
Grid of learned user preferences, observations, mood tracking, and approach success rates.

### Tab 6: Memory
Memory health visualization with score (color-coded), 8 health metrics, entities, and topics.

---

## 10. Agent-to-Agent Messaging

Agents can communicate asynchronously through DashClaw's messaging system.

### Direct Messages

```javascript
await claw.sendMessage({
  to: 'agent-b',
  type: 'question',
  subject: 'Deploy readiness',
  body: 'Are integration tests passing?',
});
```

### Broadcasts

```javascript
await claw.broadcast({
  type: 'status',
  body: 'Database migration complete. All agents can resume.',
});
```

### Shared Documents

Agents can collaboratively maintain shared documents (upserts by name):

```javascript
await claw.saveSharedDoc({
  name: 'Current API Schema',
  content: JSON.stringify(schema, null, 2),
});
```

### Message Types

| Type | Use For |
|------|---------|
| `info` | General information |
| `action` | Action requests |
| `lesson` | Lessons learned |
| `question` | Questions needing answers |
| `status` | Status updates |

---

## 10.5 Real-Time Events & SSE Listener

DashClaw emits real-time events via Server-Sent Events (SSE) whenever actions, messages, policies, or tasks change. Your agent can subscribe to these events to react immediately instead of polling.

### Available Events

| Event | Fires When |
|-------|-----------|
| `message.created` | A new message is sent (direct or broadcast) |
| `action.created` | A new action is logged |
| `policy.created` | A new policy is created |
| `policy.updated` | A policy is updated |
| `task.created` | A new task is created |
| `task.updated` | A task status changes |

### Using the SDK

The `events()` method returns an async iterator of SSE events:

```js
const DashClaw = require('dashclaw');

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
});

// Subscribe to real-time events
for await (const event of claw.events()) {
  console.log(`[${event.type}]`, event.data);

  if (event.type === 'message.created') {
    const msg = event.data;
    if (msg.to_agent_id === 'my-agent' || !msg.to_agent_id) {
      console.log(`New message from ${msg.from_agent_id}: ${msg.body}`);
      // Handle the message...
    }
  }
}
```

### Building a Persistent Listener

For production use, wrap the listener with automatic reconnection:

```js
const DashClaw = require('dashclaw');

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
});

async function listen() {
  while (true) {
    try {
      console.log('Connecting to SSE stream...');
      for await (const event of claw.events()) {
        switch (event.type) {
          case 'message.created':
            await handleMessage(event.data);
            break;
          case 'task.created':
            await handleTask(event.data);
            break;
        }
      }
    } catch (err) {
      console.error('SSE disconnected:', err.message);
      await new Promise(r => setTimeout(r, 5000)); // Reconnect after 5s
    }
  }
}

listen();
```

### Agent Prompt for SSE Listener Setup

Copy this prompt into your agent to have it build its own SSE listener:

```
You need to set up a real-time event listener for DashClaw. Here's what to do:

1. Install the DashClaw SDK: npm install dashclaw
2. Create a file called `listener.js` with the following pattern:
   - Initialize DashClaw with DASHCLAW_URL, DASHCLAW_API_KEY, and your agent ID
   - Call `claw.events()` which returns an async iterator of SSE events
   - Handle `message.created` events to process incoming messages
   - Handle `task.created` and `task.updated` events for task assignments
   - Wrap in a while(true) loop with try/catch for automatic reconnection
   - Add a 5-second delay before reconnecting on errors
3. Run it as a background process: node listener.js

Environment variables needed:
- DASHCLAW_URL: Your DashClaw instance URL
- DASHCLAW_API_KEY: Your API key

The events() method connects to /api/events/stream via SSE and yields
{type, data} objects. Events include: message.created, action.created,
policy.created, policy.updated, task.created, task.updated.
```

---

## 11. Bootstrap an Existing Agent

If you already have an agent running, you can import its existing state into DashClaw using three approaches:

### Option A: Bulk Sync (Fastest)

Push all state in a single API call:

```javascript
await claw.syncState({
  connections: [...],
  memory: { health: { score: 82 }, entities: [...], topics: [...] },
  goals: [...],
  learning: [...],
  // ... all categories optional
});
```

### Option B: CLI Scanner

Mechanically scans an agent's workspace directory and pushes structured data:

```bash
# PowerShell (Windows) - preview (dry run)
node scripts/bootstrap-agent.mjs --dir "C:\\path\\to\\agent\\workspace" --agent-id "my-agent" --agent-name "My Agent" --local --dry-run

# PowerShell (Windows) - push to local dashboard
node scripts/bootstrap-agent.mjs --dir "C:\\path\\to\\agent\\workspace" --agent-id "my-agent" --agent-name "My Agent" --local

# macOS/Linux - push to a remote dashboard
node scripts/bootstrap-agent.mjs --dir "/path/to/agent/workspace" --agent-id "my-agent" --agent-name "My Agent" --base-url "https://your-host" --api-key "oc_live_xxx"
```

The scanner detects:
1. **Connections** - environment key names (not values) + `package.json` dependency names
2. **Memory** - `MEMORY.md`, `.claude/**/*.md`, `memory/**/*.md` (entities/topics + health snapshot)
3. **Goals** - OpenClaw-style `projects.md` + checkbox task lists, plus common TODO formats when present
4. **Learning** - OpenClaw-style `memory/decisions/*.md` tables and other curated learning notes when present
5. **Context Points** - extracted sections/summaries from curated markdown docs
6. **Snippets** - fenced code blocks from a curated set of markdown files

### Option C: Copy Agent Prompt (One-Click)

On the **API Keys** page or the onboarding checklist, click **Copy Agent Prompt**. This copies a markdown prompt to your clipboard that you can paste into any AI agent session (Claude Code, Cursor, etc.). The prompt includes your dashboard URL, SDK install instructions, and a smoke test. It never includes your API key. The agent will ask you to set `DASHCLAW_API_KEY` in your environment.

### Option D: Self-Discovery Prompt

Paste the contents of `scripts/bootstrap-prompt.md` directly to your agent. The agent introspects its own workspace and pushes state via the SDK. Useful for agents that can execute code.

---

## 12. Team Management

### Inviting Team Members

1. Go to **Team** in the sidebar
2. Click **Invite Member**
3. Optionally enter an email, select a role (admin/member)
4. Copy the invite link (valid for 7 days)
5. Share the link - recipient signs in and joins your workspace

### Roles

| Capability | Admin | Member |
|-----------|-------|--------|
| View all data | Yes | Yes |
| Use all APIs (SDK) | Yes | Yes |
| Generate/revoke API keys | Yes | No |
| Invite team members | Yes | No |
| Change roles | Yes | No |
| Remove members | Yes | No |
| Configure integrations | Yes | No |
| Manage webhooks | Yes | No |
| Rebuild learning recommendations | Yes | No |
| Upgrade plan | Yes | No |

### Leaving a Workspace

Members can leave via the Team page. The last admin cannot leave (transfer admin role first).

---

## 13. Webhooks & Email Alerts

### Webhooks

Set up webhook endpoints to receive signal notifications:

1. Go to **Webhooks** in the sidebar
2. Click **Add Webhook**
3. Enter your endpoint URL
4. Select which signal types to subscribe to (or "all")
5. Save - you'll see a **webhook secret** (shown once)

Webhooks include an `X-DashClaw-Signature` header (HMAC-SHA256) for verification.

**Limits:** Max 10 webhooks per org. Auto-disabled after 10 consecutive failures.

### Email Alerts

1. Set the `RESEND_API_KEY` environment variable (get one at [resend.com](https://resend.com))
2. Go to **Notifications** in the sidebar
3. Enable email alerts for specific signal types
4. Emails fire every 10 minutes via cron when new signals are detected

---

## 14. Usage & Plans

DashClaw is designed to be self-hosted.

In this open-source/self-host edition:
- The **Usage** page (`/usage`) shows usage meters.
- Quotas are **unlimited by default** (you should not see HTTP 402 unless you add your own quota enforcement).
- Stripe configuration is optional and not required to run the dashboard.
---

## 15. Token & Cost Analytics

DashClaw provides real-time financial tracking for your AI agents. You can monitor token usage, see estimated costs per model, and track the total cost of achieving specific goals.

### Automatic Cost Calculation

When you create an action, you can include token usage and the model name. DashClaw will automatically estimate the cost based on current provider pricing.

```javascript
// Node.js
await claw.createAction({
  action_type: 'research',
  declared_goal: 'Scan latest market trends',
  tokens_in: 1200,
  tokens_out: 850,
  model: 'claude-3-5-sonnet-20240620'
});
```

```python
# Python
claw.create_action(
    action_type='research',
    declared_goal='Scan latest market trends',
    tokens_in=1200,
    tokens_out=850,
    model='gpt-4o'
)
```

### Manual Token Reporting

For fine-grained tracking (e.g., periodic snapshots of context window usage), use the manual reporting method:

```javascript
await claw.reportTokenUsage({
  tokens_in: 5000,
  tokens_out: 2000,
  context_used: 150000,
  context_max: 200000,
  model: 'claude-3-opus'
});
```

### Dashboard Visuals

- **Token Usage Card**: Shows current hourly/weekly budget remaining and today's total cost.
- **Token Chart**: Visualizes token consumption and financial "burn rate" over the last 7 days.
- **Goal Efficiency**: Hover over any goal in the Goal Progress chart to see the total USD spent to achieve it.

---

## 16. CLI Tools

### Claude Code Skill: Platform Intelligence

If you use Claude Code, the `dashclaw-platform-intelligence` skill provides guided workflows for agent instrumentation, troubleshooting, SDK generation, and more. It activates automatically when you mention DashClaw-related tasks.

The skill also includes companion scripts:

```bash
# Validate an agent's DashClaw integration
node .claude/skills/dashclaw-platform-intelligence/scripts/validate-integration.mjs \
  --base-url http://localhost:3000 --api-key $DASHCLAW_API_KEY --full

# Diagnose connection or auth issues
node .claude/skills/dashclaw-platform-intelligence/scripts/diagnose.mjs \
  --base-url http://localhost:3000 --api-key $DASHCLAW_API_KEY --error "403"

# Quick-bootstrap an agent workspace
node .claude/skills/dashclaw-platform-intelligence/scripts/bootstrap-agent-quick.mjs \
  --dir "/path/to/agent" --agent-id "my-agent" --validate
```

### Report an Action (from terminal)

```bash
# Create a new action
node scripts/report-action.mjs \
  --agent-id my-agent \
  --type build \
  --goal "Deploy feature X" \
  --risk 75 \
  --systems "api,database"

# Update an existing action
node scripts/report-action.mjs \
  --update act_abc123 \
  --status completed \
  --output "Deployed successfully"

# Create + complete in one shot
node scripts/report-action.mjs \
  --agent-id my-agent \
  --type deploy \
  --goal "Ship v2" \
  --status completed \
  --output "All tests passing"

# Dry run (preview without sending)
node scripts/report-action.mjs \
  --agent-id my-agent \
  --type test \
  --goal "Run CI" \
  --dry-run

# Use local dev server
node scripts/report-action.mjs \
  --agent-id my-agent \
  --type build \
  --goal "Test locally" \
  --local
```

### Clean Up Stale Actions

```bash
# Preview what would be deleted
node scripts/cleanup-actions.mjs --before "2026-01-01" --dry-run

# Delete actions + their loops and assumptions
node scripts/cleanup-actions.mjs \
  --before "2026-01-01" \
  --include-loops \
  --include-assumptions
```

Requires `DATABASE_URL` environment variable (direct DB access).

### Create an Organization (admin)

```bash
node scripts/create-org.mjs --name "Acme AI" --slug "acme"
```

### Run Database Migration

```bash
DATABASE_URL=... node scripts/migrate-multi-tenant.mjs
```

Idempotent â€" safe to run multiple times.

---

## 16. Security Best Practices

### API Key Management

- **Never commit API keys to git.** Store in `.env` files or secret managers.
- **Set ENCRYPTION_KEY**: In production, ensure the `ENCRYPTION_KEY` (32 characters) environment variable is set. This key is used to encrypt all sensitive settings (AI provider keys, etc.) at rest in your database.
- **Rotate keys** if compromised. Revoke from the API Keys page; revocation is instant.
- **Use separate keys** for each agent or environment.
- **Key format:** `oc_live_{32_hex_chars}` â€" stored as SHA-256 hash server-side.

### Scan Content Before Sending

Use the security scanner to catch leaked secrets:

```javascript
const { clean, findings } = await claw.scanContent(textBeingSent, 'slack');
if (!clean) {
  console.warn('Sensitive data detected:', findings);
  // Use redacted_text instead
}
```

The scanner detects: API keys, AWS credentials, JWT tokens, private keys, email addresses, phone numbers, SSNs, credit cards, and more (18 pattern types).

### Authorization Scope

Always set `authorization_scope` on high-risk actions. This prevents "High Impact, Low Oversight" signals:

```javascript
await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Deploy to production',
  risk_score: 85,
  reversible: false,
  authorization_scope: 'deploy:production approved by ops-team',
});
```

### Guard Policies

Set up guard policies to enforce boundaries:

1. **Risk Threshold** â€" block anything above risk 90
2. **Require Approval** â€" require approval for `deploy`, `security` actions
3. **Rate Limit** â€" max 30 actions per hour per agent
4. **Webhook Check** â€" call your own endpoint for custom business rules

---

## 17. FAQ & Troubleshooting

### "My signed actions are not verified / how do I register an agent public key?"

If your agent is signing actions (you configured a private key), DashClaw needs the matching public key to verify signatures.

Recommended: use **one-click pairing** (it registers the public key automatically).

1. In your agent, create a pairing request (from the private JWK) and print the link.
2. Open the link (or use `/pairings` to approve many agents).
3. Re-try sending a signed action.

Advanced/manual fallback: register the public key PEM directly (easy to mess up if you grab the wrong keypair):

1. Generate a keypair (see `node scripts/generate-agent-keys.mjs <agent-id>`).
2. Configure your agent with the private key (so it can sign).
3. Register the public key:
   - `POST /api/identities`
   - Headers:
     - `x-api-key: <your admin DashClaw API key>`
     - `Content-Type: application/json`
   - Body:
     ```json
     {
       "agent_id": "cinder",
       "algorithm": "RSASSA-PKCS1-v1_5",
       "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
     }
     ```
4. Confirm it worked with `GET /api/identities`.

If you get `403 Admin access required`, you are using a non-admin API key, or the server is not treating `/api/identities` as a protected route (see `docs/lessons/2026-02-14-identity-registration.md`).

### "My action isn't showing up"

- Check that your API key is valid and not revoked
- Verify `baseUrl` points to the correct DashClaw instance
- Check the agent filter dropdown in the dashboard header (may be filtered to a different agent)

### "I get a 401 error"

- API key may be revoked or incorrect
- Check that the `x-api-key` header is being sent
- Try generating a new key from the API Keys page

### "I get a 402 error"

- In the open-source/self-host edition, quotas are unlimited. A `402` usually means you are running a modified build, a hosted edition, or you added your own quota enforcement.
- If you expected quotas to apply, check `app/lib/usage.js` and your org plan record in the database.

### "Guard is blocking my actions"

- Check the Policies page to see which policies are active
- If using `guardMode: 'enforce'`, catch `GuardBlockedError` and handle it
- Switch to `guardMode: 'warn'` during development

### "I don't see any signals"

- Signals require data to analyze. Record some actions first.
- Signals are computed on-demand when you visit the Security page
- Some signals need multiple data points (e.g., "Repeated Failures" needs >3 failures in 24h)

### "How do I connect multiple agents?"

Each agent uses the **same API key** but a **different `agentId`**:

```javascript
// Agent A
const agentA = new DashClaw({
  baseUrl: '...', apiKey: '...', agentId: 'agent-a', agentName: 'Agent A',
});

// Agent B
const agentB = new DashClaw({
  baseUrl: '...', apiKey: '...', agentId: 'agent-b', agentName: 'Agent B',
});
```

Both agents share the same org data but are tracked separately. Use the global **agent filter dropdown** in the dashboard to view data per-agent.

### "How do I run DashClaw locally?"

```bash
git clone git@github.com:ucsandman/DashClaw.git
cd DashClaw
npm install
cp .env.example .env.local
# Fill in DATABASE_URL (get a free Neon DB at neon.tech)
# Fill in NEXTAUTH_URL=http://localhost:3000
# Fill in NEXTAUTH_SECRET (run: openssl rand -hex 32)
npm run dev
```

Then point your SDK at `http://localhost:3000`:

```javascript
const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'test-agent',
});
```

### "What data does the SDK send?"

The SDK sends **only what you explicitly pass** to each method. It never:
- Reads your filesystem
- Sends environment variables
- Accesses code or memory automatically
- Tracks anything without an explicit method call

The `bootstrap-agent.mjs` scanner does not transmit `.env` values, but it *does* transmit extracted text and code blocks when importing snippets/context/goals/learning. Use `--dry-run` to preview exactly what will be sent.

---

## Quick Reference Card

```
INSTALL:    npm install dashclaw
IMPORT:     import { DashClaw, GuardBlockedError } from 'dashclaw';
DASHBOARD:  http://localhost:3000
DOCS:       http://localhost:3000/docs

CONSTRUCTOR:
  new DashClaw({ baseUrl, apiKey, agentId, agentName?, swarmId?, guardMode?, guardCallback? })

MOST USED METHODS:
  claw.createAction({ action_type, declared_goal, risk_score, ... })
  claw.updateOutcome(actionId, { status, output_summary, ... })
  claw.track(actionDef, asyncFn)
  claw.registerOpenLoop({ action_id, loop_type, description })
  claw.registerAssumption({ action_id, assumption, basis })
  claw.guard({ action_type, risk_score, ... })
  claw.getSignals()
  claw.recordDecision({ decision, reasoning })
  claw.heartbeat({ status?, currentTaskId? })
  claw.startHeartbeat({ interval? })
  claw.getRecommendations({ action_type? })
  claw.rebuildRecommendations({ lookback_days?, min_samples? })
  claw.recommendAction({ action_type, declared_goal, ... })
  claw.createHandoff({ summary, key_decisions, open_tasks })
  claw.renderPrompt({ template_id, variables, record: true })
  claw.syncState({ connections, memory, goals, learning, ... })

GUARD MODES:
  'off'     â†' no auto-check (default)
  'warn'    â†' console.warn + proceed
  'enforce' â†' throw GuardBlockedError on block

PLAN LIMITS (FREE):
  100 actions/mo, 1 agent, 2 members, 2 keys
```

