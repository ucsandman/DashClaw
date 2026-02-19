# DashClaw — Complete AI Context Document

> **Generated:** 2026-02-17
> **Purpose:** Give any AI model full context about the DashClaw platform in a single file.
> **Source of truth:** `PROJECT_DETAILS.md`, `CLAUDE.md`, `sdk/README.md`, `docs/client-setup-guide.md`

---

## 1. What Is DashClaw?

DashClaw is an **AI agent decision infrastructure platform**. It is a Next.js 15 JavaScript application that serves as a governance and control plane for AI agent fleets. It provides:

- **Action recording** — every agent action logged with intent, risk, and outcome
- **Behavior guard** — policy enforcement before agents act (allow / warn / block / require_approval)
- **Risk signals** — automatic detection of 7 dangerous behavior patterns
- **Assumption tracking** — log what agents believe; validate or invalidate later
- **Open loop tracking** — track unresolved dependencies across sessions
- **Compliance mapping** — SOC 2, ISO 27001, GDPR, NIST AI RMF, IMDA Agentic
- **Agent messaging** — async inbox, threads, shared docs, broadcasts
- **Agent workspace** — handoffs, context points/threads, snippets, user preferences, memory health
- **Task routing** — intelligent task dispatch to available agents
- **Multi-tenancy** — isolated organizations, each with their own API keys and data
- **Real-time events** — SSE stream for instant push notifications

### Deployment Model

DashClaw ships as one codebase serving two roles via `DASHCLAW_MODE`:

| Mode | Value | Behavior |
|------|-------|----------|
| Marketing/demo site | `DASHCLAW_MODE=demo` + `NEXT_PUBLIC_DASHCLAW_MODE=demo` | No login, API returns fixtures |
| Self-hosted (default) | `DASHCLAW_MODE=self_host` | GitHub/Google OAuth + real Postgres DB |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Next.js 15 (App Router) |
| Language | JavaScript (no TypeScript) |
| Styling | Tailwind CSS 3 + dark-only design tokens |
| Database | PostgreSQL via Neon (`@neondatabase/serverless`) or TCP (`postgres`) |
| Auth (UI) | NextAuth v4 (GitHub + Google OAuth, JWT strategy) |
| Auth (agents) | `x-api-key` header (DashClaw API keys) |
| ORM | Drizzle ORM (schema management only; raw SQL for queries) |
| Icons | lucide-react (no emoji in UI) |
| Testing | Vitest + jsdom |
| CI | GitHub Actions |
| Deployment | Vercel (Washington DC region, auto-deploys on push to main) |
| Email | Resend SDK (optional) |
| SDK (Node) | `dashclaw` npm package — zero deps, ESM + CJS |
| SDK (Python) | `dashclaw` pip package — zero deps, urllib-based |

---

## 3. Architecture Overview

```
app/
├── page.js                    # Public landing page
├── layout.js                  # Root layout (Inter font, SessionWrapper)
├── globals.css                # CSS design tokens + Tailwind
├── dashboard/page.js          # Main dashboard (draggable/resizable widget grid)
├── mission-control/page.js    # Fleet overview (signals, loops, cost, timeline)
├── security/                  # Security dashboard (signals, guard decisions)
├── policies/                  # Guard policy CRUD + import + test runner
├── routing/                   # Task routing (agent registry, task queue, health)
├── compliance/                # Compliance mapping (frameworks, gap analysis, reports)
├── messages/                  # Agent messaging hub (inbox, threads, docs, SSE)
├── workspace/                 # Agent workspace (6 tabs)
├── actions/                   # ActionRecord list + post-mortem detail
├── api-keys/                  # API key management
├── team/                      # Team management + invites
├── invite/[token]/            # Invite accept page
├── activity/                  # Audit trail
├── webhooks/                  # Webhook management
├── notifications/             # Email alert preferences
├── tokens/                    # Token usage analytics
├── workflows/                 # Workflow/SOP definitions
├── learning/                  # Decision database + recommendations
├── goals/                     # Goal tracking
├── content/                   # Content tracker
├── relationships/             # Mini-CRM
├── calendar/                  # Calendar events
├── inspiration/               # Ideas tracker
├── docs/page.js               # Public SDK docs page (no auth)
├── login/page.js              # OAuth login page
│
├── lib/
│   ├── auth.js                # NextAuth config (providers, JWT, user upsert)
│   ├── db.js                  # DB connection utility
│   ├── org.js                 # Multi-tenant helpers (getOrgId, getOrgRole, getUserId)
│   ├── guard.js               # Guard evaluation engine
│   ├── signals.js             # Signal computation (computeSignals)
│   ├── security.js            # DLP / sensitive data scanning (18 regex patterns)
│   ├── embeddings.js          # Vector embedding generation (OpenAI)
│   ├── maintenance.js         # Memory health engine
│   ├── billing.js             # Token → USD cost estimation
│   ├── usage.js               # Usage meters + quota checks
│   ├── audit.js               # Fire-and-forget activity logging
│   ├── webhooks.js            # HMAC signing, delivery, dispatch
│   ├── notifications.js       # Email alerts via Resend
│   ├── connectPrompt.js       # Agent connect prompt generator
│   └── colors.js              # Agent color hashing, action type icon map
│
├── lib/repositories/          # All SQL queries live here (route-SQL guardrail)
│
└── api/                       # All API routes (see Section 5)

sdk/
├── dashclaw.js                # Node SDK (98+ methods, 23 categories, ESM)
├── index.cjs                  # CJS wrapper

sdk-python/
├── dashclaw/client.py         # Python SDK (98+ methods, zero deps)
├── dashclaw/__init__.py       # Exports: DashClaw, OpenClawAgent, ApprovalDeniedError

middleware.js                  # Auth + rate limiting + org context injection
```

### Key Invariants

1. **No direct SQL in route files.** All queries go in `app/lib/repositories/*.repository.js`. CI blocks violations via `npm run route-sql:check`.
2. **Org context headers** (`x-org-id`, `x-org-role`, `x-user-id`) are injected by middleware only — never accepted from clients.
3. **Default-deny** for all `/api/*` routes — only explicit `PUBLIC_ROUTES` skip auth.
4. **Thread system duality**: context threads (`ct_*` via `/api/context/threads`) are different from message threads (`mt_*` via `/api/messages/threads`).

---

## 4. Auth & Multi-Tenancy

### Auth Flow (Browser)
1. `/login` → GitHub or Google OAuth
2. OAuth callback → NextAuth JWT cookie
3. Redirect to `/dashboard`
4. Every page route: `middleware.js` calls `getToken()` (Edge-compatible)
5. Session includes `user.role` (`admin` | `member`)

### Auth Flow (SDK / API Keys)
1. Agent sends `x-api-key: oc_live_xxx` header
2. Middleware resolves org:
   - Key matches `DASHCLAW_API_KEY` env → `org_default` (admin, fast path)
   - Otherwise → SHA-256 hash → `api_keys` table lookup (5-min cache)
   - No key + browser dashboard request → `org_default` (admin)
   - No key + dev mode (no `DASHCLAW_API_KEY`) → `org_default` (admin)
   - No key + production → 503
   - Bad key → 401
3. Middleware injects `x-org-id` and `x-org-role` headers
4. Every route calls `getOrgId(request)` from `app/lib/org.js`

### Public Routes (no auth required)
- `GET /api/health`
- `GET /api/setup/status`
- `POST /api/waitlist`
- `/api/auth/*` (NextAuth)
- `/api/webhooks/stripe`
- `/api/cron/*` (requires `Authorization: Bearer CRON_SECRET`)

### Admin-Only API Routes (return 403 for members)
- `POST/DELETE /api/keys`
- `POST/DELETE /api/settings`
- All `/api/team/invite`
- `PATCH/DELETE /api/team/[userId]`
- All `/api/orgs`
- `POST/DELETE /api/webhooks`
- `POST /api/identities` (register public keys)

### Role Capabilities

| Capability | Admin | Member |
|-----------|-------|--------|
| View all data | ✓ | ✓ |
| Use all APIs (SDK) | ✓ | ✓ |
| Generate/revoke API keys | ✓ | — |
| Invite team members | ✓ | — |
| Change roles | ✓ | — |
| Remove members | ✓ | — |
| Configure integrations | ✓ | — |
| Manage webhooks | ✓ | — |
| Rebuild recommendations | ✓ | — |

### Key Format
`oc_live_{32_hex_chars}` — stored as SHA-256 hash in `api_keys.key_hash`. First 8 chars in `key_prefix` for display. Shown raw only once on creation.

### ID Prefixes

| Entity | Prefix | Example |
|--------|--------|---------|
| Organization | `org_` | `org_default` |
| API Key | `key_` | `key_abc` |
| Action | `act_` | `act_abc123` |
| User | `usr_` | `usr_abc` |
| Open Loop | `ol_` | `ol_abc` |
| Assumption | `as_` | `as_abc` |
| Handoff | `ho_` | `ho_abc` |
| Context Point | `cp_` | `cp_abc` |
| Context Thread | `ct_` | `ct_abc` |
| Context Entry | `ce_` | `ce_abc` |
| Snippet | `sn_` | `sn_abc` |
| User Observation | `uo_` | `uo_abc` |
| User Preference | `up_` | `up_abc` |
| User Mood | `um_` | `um_abc` |
| User Approach | `ua_` | `ua_abc` |
| Security Finding | `sf_` | `sf_abc` |
| Message | `msg_` | `msg_abc` |
| Message Thread | `mt_` | `mt_abc` |
| Attachment | `att_` | `att_abc` |
| Shared Doc | `sd_` | `sd_abc` |
| Guard Policy | `gp_` | `gp_abc` |
| Guard Decision | `gd_` | `gd_abc` |
| Webhook | `wh_` | `wh_abc` |
| Webhook Delivery | `wd_` | `wd_abc` |
| Invite | `inv_` | `inv_abc` |
| Notification Pref | `np_` | `np_abc` |
| Agent Connection | `conn_` | `conn_abc` |
| Agent Capability | `ac_` | `ac_abc` |
| Activity Log | `al_` | `al_abc` |

---

## 5. Complete API Route Inventory

### ActionRecord Control Plane

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/actions` | GET, POST | List/create action records. Stats respect all filters. |
| `/api/actions/[actionId]` | GET, PATCH | Single action + update outcome |
| `/api/actions/[actionId]/trace` | GET | Root-cause trace (assumptions, loops, parent chain, related actions) |
| `/api/actions/[actionId]/approve` | POST | HITL approval decision |
| `/api/actions/assumptions` | GET, POST | List/create assumptions (`?drift=true` for drift scoring) |
| `/api/actions/assumptions/[assumptionId]` | GET, PATCH | Single assumption + validate/invalidate |
| `/api/actions/loops` | GET, POST | List/create open loops |
| `/api/actions/loops/[loopId]` | GET, PATCH | Single loop + resolve/cancel |
| `/api/actions/signals` | GET | 7 risk signal types |

### Guard & Policies

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/guard` | GET, POST | Evaluate policies (POST) / recent decisions (GET) |
| `/api/policies` | GET, POST, PATCH, DELETE | Guard policy CRUD (POST/PATCH/DELETE admin only) |
| `/api/policies/test` | POST | Run guardrails tests against active policies |
| `/api/policies/proof` | GET | Generate compliance proof report |
| `/api/policies/import` | POST | Import policy pack or raw YAML (admin only) |

### Workspace

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/handoffs` | GET, POST | Session handoffs (`?latest=true`, `?agent_id`, `?date`) |
| `/api/context/points` | GET, POST | Key points (`?agent_id`, `?category`, `?session_date`) |
| `/api/context/threads` | GET, POST | Context threads (upserts on org+agent+name) |
| `/api/context/threads/[threadId]` | GET, PATCH | Thread detail + update (summary, status) |
| `/api/context/threads/[threadId]/entries` | POST | Add entry to thread |
| `/api/snippets` | GET, POST, DELETE | Snippets CRUD (`?search`, `?tag`, `?language`) |
| `/api/snippets/[snippetId]` | GET | Single snippet by ID |
| `/api/snippets/[snippetId]/use` | POST | Increment use_count |
| `/api/preferences` | GET, POST | User preferences (`?type=summary|observations|preferences|moods|approaches`) |
| `/api/digest` | GET | Daily digest aggregation (`?date`, `?agent_id`) |

### Agent Messaging

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/messages` | GET, POST, PATCH | Messages (GET: inbox/sent/all; POST: send; PATCH: batch read/archive) |
| `/api/messages/threads` | GET, POST, PATCH | Message threads (POST: create; PATCH: resolve/update) |
| `/api/messages/attachments` | GET | Download attachment binary by ID |
| `/api/messages/docs` | GET, POST | Shared workspace documents (upsert by name) |

### Security

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/security/scan` | POST | Content security scanning (18 regex patterns) |
| `/api/security/prompt-injection` | GET, POST | Prompt injection detection (POST: scan; GET: recent scans) |

### Compliance

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/compliance/map` | GET | Map policies to compliance framework |
| `/api/compliance/gaps` | GET | Gap analysis with remediation plan |
| `/api/compliance/report` | GET | Full compliance report + snapshot |
| `/api/compliance/frameworks` | GET | List available frameworks |
| `/api/compliance/evidence` | GET | Live compliance evidence (guard decisions) |

### Task Routing

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/routing/agents` | GET, POST | List/register routing agents |
| `/api/routing/agents/[id]` | GET, PATCH, DELETE | Single agent + update status |
| `/api/routing/tasks` | GET, POST | List/submit routing tasks |
| `/api/routing/tasks/[id]/complete` | POST | Complete a routing task |
| `/api/routing/stats` | GET | Aggregate routing statistics |
| `/api/routing/health` | GET | Routing system health |
| `/api/agent-schedules` | GET, POST | Agent schedule management |

### Dashboard Data APIs

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/agents` | GET | List agents (from action records + other tables; `?include_connections=true`) |
| `/api/agents/connections` | GET, POST | Self-reported agent connections (upsert via `ON CONFLICT`) |
| `/api/learning` | GET, POST | Decisions + lessons |
| `/api/learning/recommendations` | GET, POST | Adaptive recommendations (POST: rebuild, admin only) |
| `/api/learning/recommendations/metrics` | GET | Recommendation telemetry + effectiveness deltas |
| `/api/learning/recommendations/[id]` | GET, PATCH, DELETE | Single recommendation management |
| `/api/learning/recommendations/events` | POST | Log recommendation acceptance/override events |
| `/api/goals` | GET, POST | Goals + milestones |
| `/api/content` | GET, POST | Content items |
| `/api/relationships` | GET, POST | Contacts + interactions |
| `/api/calendar` | GET, POST | Calendar events |
| `/api/inspiration` | GET, POST | Ideas/inspiration |
| `/api/memory` | GET, POST | Memory snapshots, entities, topics |
| `/api/settings` | GET, POST, DELETE | Integration credentials (per-agent override support) |
| `/api/settings/test` | GET | Test API connectivity |
| `/api/tokens` | GET, POST | Token snapshots (exists but disabled in UI) |
| `/api/tokens/budget` | GET | Token budget analytics |
| `/api/usage` | GET | Usage meters and quota checks |
| `/api/swarm/graph` | GET | Swarm visualization graph (agent nodes + connection links) |

### Org & Team Management

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/orgs` | GET, POST | List/create orgs (admin only) |
| `/api/orgs/[orgId]` | GET, PATCH | Get/update org |
| `/api/orgs/[orgId]/keys` | GET, POST, DELETE | Manage org API keys |
| `/api/keys` | GET, POST, DELETE | Workspace API key management |
| `/api/team` | GET | List members + org info (rejects `org_default`) |
| `/api/team/invite` | GET, POST, DELETE | Invite CRUD (admin only) |
| `/api/team/[userId]` | PATCH, DELETE | Role change + remove member |
| `/api/invite/[token]` | GET, POST | Invite details (public GET) + accept |
| `/api/identities` | GET, POST | Agent public key registration (POST admin only) |

### System

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth OAuth handler |
| `/api/health` | GET | DB connectivity check (public) |
| `/api/setup/status` | GET | Setup status (public) |
| `/api/waitlist` | GET, POST | Waitlist signups (public) |
| `/api/activity` | GET | Activity log (paginated, filtered) |
| `/api/webhooks` | GET, POST, DELETE | Webhook CRUD |
| `/api/webhooks/[webhookId]/test` | POST | Send test webhook |
| `/api/webhooks/[webhookId]/deliveries` | GET | Delivery history (last 20) |
| `/api/notifications` | GET, POST | Email alert preferences |
| `/api/onboarding/status` | GET | Onboarding progress |
| `/api/onboarding/workspace` | POST | Create workspace |
| `/api/onboarding/api-key` | POST | Generate first API key |
| `/api/sync` | POST | Bulk sync (all categories in one request) |
| `/api/cron/signals` | GET | Cron: detect signals + fire webhooks + send emails |
| `/api/cron/memory-maintenance` | GET | Cron: memory health cleanup |
| `/api/cron/routing-maintenance` | POST | Cron: route pending tasks + check timeouts |
| `/api/cron/learning-episodes-backfill` | GET | Cron: backfill learning episodes |
| `/api/cron/learning-recommendations` | GET | Cron: rebuild learning recommendations |
| `/api/docs/raw` | GET | Serves `sdk/README.md` (powers "Copy as Markdown" button) |
| `/api/prompts/server-setup/raw` | GET | Server setup prompt (markdown) |
| `/api/prompts/agent-connect/raw` | GET | Agent connection prompt (markdown) |
| `/api/pairings` | GET | List pairing requests (`?status`) |
| `/api/pairings/[pairingId]` | GET, POST | Pairing details + approve decision |
| `/api/stream` | GET | SSE stream for real-time events |

---

## 6. Database Schema (All Tables)

All 33+ data tables have `org_id TEXT NOT NULL DEFAULT 'org_default'` + index.

### Core Tables

```sql
-- Organizations
organizations (id TEXT PK `org_`, name, slug UNIQUE, plan)

-- API Keys
api_keys (id TEXT PK `key_`, org_id FK, key_hash SHA-256, key_prefix, label, role, revoked_at)

-- Users
users (id TEXT PK `usr_`, org_id, email, name, image, provider, provider_account_id, role, created_at, last_login_at)
-- UNIQUE: (provider, provider_account_id)

-- Invites
invites (id TEXT PK `inv_`, org_id, email NULLABLE, role, token UNIQUE 64hex, invited_by, status, accepted_by, expires_at, created_at)
```

### ActionRecord Tables

```sql
-- Actions
action_records (id `act_`, org_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning,
  authorization_scope, trigger, systems_touched JSON, input_summary, parent_action_id, reversible,
  risk_score 0-100, confidence, status, output_summary, side_effects JSON, artifacts_created JSON,
  error_message, timestamp_start TEXT, timestamp_end TEXT, duration_ms, cost_estimate,
  tokens_in, tokens_out, model, signature TEXT, verified BOOLEAN)

-- Open Loops
open_loops (id, org_id, action_id FK, agent_id, loop_type, description, priority, owner,
  status [open|resolved|cancelled], resolution, created_at, resolved_at)

-- Assumptions
assumptions (id, org_id, action_id FK, agent_id, assumption, basis, validated BOOLEAN,
  invalidated_reason, invalidated_at TEXT, created_at)
```

### Security & Guard Tables

```sql
-- Guard Policies
guard_policies (id `gp_`, org_id, name, policy_type, rules JSON, active 0/1, created_by, created_at, updated_at)
-- UNIQUE: (org_id, name)
-- policy_type: risk_threshold | require_approval | block_action_type | rate_limit | webhook_check

-- Guard Decisions
guard_decisions (id `gd_`, org_id, agent_id, decision, reason, matched_policies JSON,
  context JSON, risk_score, action_type, created_at)

-- Security Findings (metadata only, never raw content)
security_findings (id `sf_`, org_id, agent_id, content_hash SHA-256, findings_count, critical_count,
  categories JSON, scanned_at)
```

### Workspace Tables

```sql
-- Handoffs
handoffs (id `ho_`, org_id, agent_id, session_date, summary, key_decisions JSON, open_tasks JSON,
  mood_notes, next_priorities JSON, created_at)

-- Context Points
context_points (id `cp_`, org_id, agent_id, content, category [decision|task|insight|question|general],
  importance 1-10, session_date, compressed, created_at)

-- Context Threads (UNIQUE: org_id + COALESCE(agent_id,'') + name)
context_threads (id `ct_`, org_id, agent_id, name, summary, status [active|closed], created_at, updated_at)

-- Context Entries
context_entries (id `ce_`, thread_id FK, org_id, content, entry_type, created_at)

-- Snippets (UNIQUE: org_id + name)
snippets (id `sn_`, org_id, agent_id, name, description, code, language, tags JSON, use_count, created_at, last_used)
```

### User Preferences Tables

```sql
user_observations (id `uo_`, org_id, agent_id, observation, category, importance, created_at)
user_preferences (id `up_`, org_id, agent_id, preference, category, confidence, created_at)
user_moods (id `um_`, org_id, agent_id, mood, energy, notes, created_at)
-- UNIQUE: (org_id, COALESCE(agent_id,''), approach)
user_approaches (id `ua_`, org_id, agent_id, approach, context, success_count, fail_count, created_at)
```

### Agent Messaging Tables

```sql
-- Message Threads
message_threads (id `mt_`, org_id, name, participants JSON, status [open|resolved|archived],
  summary, created_by, created_at, updated_at, resolved_at)

-- Agent Messages
agent_messages (id `msg_`, org_id, thread_id FK, from_agent_id, to_agent_id NULLABLE,
  message_type [action|info|lesson|question|status], subject, body, urgent BOOLEAN,
  status [sent|read|archived], doc_ref, read_by JSON, created_at, read_at, archived_at)

-- Message Attachments
message_attachments (id `att_`, org_id, message_id, filename, mime_type, size_bytes, data BASE64, created_at)

-- Shared Docs (UNIQUE: org_id + name)
shared_docs (id `sd_`, org_id, name, content, created_by, last_edited_by, version, created_at, updated_at)
```

### System Tables

```sql
-- Activity Logs
activity_logs (id `al_`, org_id, actor_id, actor_type [user|system|api_key|cron],
  action, resource_type, resource_id, details JSON, ip_address, created_at)

-- Webhooks
webhooks (id `wh_`, org_id, url, events JSON, secret, active, failure_count, created_by, created_at)
webhook_deliveries (id `wd_`, org_id, webhook_id, event_type, status, response_status,
  response_body TRUNCATED-2000, duration_ms, delivered_at)

-- Notification Preferences (UNIQUE: org_id + user_id + channel)
notification_preferences (id `np_`, org_id, user_id, channel [email], enabled, signal_types JSON, updated_at)
signal_snapshots (org_id, signal_hash, type, agent_id, action_id, loop_id, assumption_id, first_seen_at, last_seen_at)

-- Usage Meters (UNIQUE: org_id + period + resource)
usage_meters (id SERIAL, org_id, period, resource [actions_per_month|agents|members|api_keys],
  count, last_reconciled_at, updated_at)

-- Agent Connections (UNIQUE: org_id + agent_id + provider)
agent_connections (id `conn_`, org_id, agent_id, provider, auth_type [api_key|subscription|oauth|pre_configured|environment],
  plan_name, status [active|inactive|error], metadata JSON, reported_at, updated_at)

-- Agent Capabilities (UNIQUE: org_id + agent_id + name + capability_type)
agent_capabilities (id `ac_`, org_id, agent_id, name, capability_type [skill|tool], description,
  source_path, file_count, metadata JSONB, created_at, updated_at)

-- Identity Binding
agent_identities (org_id, agent_id, public_key PEM, algorithm)

-- Memory Health
health_snapshots (id, org_id, agent_id, score 0-100, total_files, total_lines, ..., created_at)
entities (id, org_id, agent_id, name, type, mention_count, created_at)
topics (id, org_id, agent_id, name, mention_count, created_at)

-- Token Tracking (disabled in UI)
token_snapshots, daily_totals

-- Waitlist (global, no org_id)
waitlist (id SERIAL, email UNIQUE, signed_up_at, signup_count, source, notes)
```

### Standard Data Tables (all have agent_id + org_id)

```sql
content, contacts, interactions, goals, milestones, workflows, executions,
learning_decisions, learning_lessons, recommendations, recommendation_events,
calendar_events, inspiration, relationships
```

---

## 7. Key Code Patterns

### Neon Driver Usage

```js
// Tagged template (static queries)
const rows = await sql`SELECT * FROM foo WHERE id = ${id}`;

// Dynamic query (variable column names, etc.)
const rows = await sql.query("SELECT * FROM foo WHERE id = $1", [id]);

// NEVER: sql(query, params) — throws tagged-template error
// NOTE: timestamp_start is TEXT, use ::timestamptz for comparisons
```

### API Route Pattern

```js
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getOrgId, getOrgRole } from '@/app/lib/org';
import { FooRepository } from '@/app/lib/repositories/foo.repository';

export async function GET(request) {
  const orgId = getOrgId(request);
  // Use repository, never raw SQL here
  const items = await FooRepository.findAll(orgId);
  return Response.json({ items });
}
```

### Guard Evaluation Pattern

```js
import { evaluateGuard } from '@/app/lib/guard';

const result = await evaluateGuard(orgId, {
  action_type: 'deploy',
  risk_score: 85,
  agent_id: 'my-agent',
}, sql, { includeSignals: false });
// result.decision: 'allow' | 'warn' | 'block' | 'require_approval'
```

---

## 8. SDK — Complete Method Reference

### Constructor

```javascript
import { DashClaw, GuardBlockedError, ApprovalDeniedError } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',   // required
  apiKey: process.env.DASHCLAW_API_KEY, // required
  agentId: 'my-agent',               // required
  agentName: 'My Agent',             // optional
  swarmId: 'my-swarm',               // optional
  guardMode: 'enforce',              // optional: 'off' | 'warn' | 'enforce'
  guardCallback: (decision) => {},   // optional
  autoRecommend: 'enforce',          // optional: 'off' | 'warn' | 'enforce'
  recommendationConfidenceMin: 80,   // optional (default 70)
  recommendationCallback: (r) => {}, // optional
  hitlMode: 'wait',                  // optional: 'off' | 'wait'
});
```

### Action Recording (7 methods)

| Method | Description |
|--------|-------------|
| `createAction(action)` | Create action record. If `hitlMode: 'wait'`, blocks until approved. |
| `waitForApproval(actionId, opts?)` | Poll for HITL approval. `opts.useEvents` for SSE mode. |
| `updateOutcome(actionId, outcome)` | Update status, output, side_effects, cost, etc. |
| `track(actionDef, asyncFn)` | Wrapper: creates action, runs fn, auto-updates outcome. |
| `getActions(filters?)` | List actions with filters (agent_id, status, action_type, risk_min). |
| `getAction(actionId)` | Single action + loops + assumptions. |
| `getActionTrace(actionId)` | Root-cause trace: assumptions, loops, parent chain, related actions. |

**Action type enum:** `build | deploy | post | apply | security | message | api | calendar | research | review | fix | refactor | test | config | monitor | alert | cleanup | sync | migrate | other`

**createAction fields:** `action_type*`, `declared_goal*`, `action_id?`, `reasoning?`, `authorization_scope?`, `trigger?`, `systems_touched[]?`, `input_summary?`, `parent_action_id?`, `reversible?`, `risk_score 0-100?`, `confidence 0-100?`, `tokens_in?`, `tokens_out?`, `model?`

### Loops & Assumptions (7 methods)

| Method | Description |
|--------|-------------|
| `registerOpenLoop(loop)` | Register unresolved dependency. `loop_type`: followup|question|dependency|approval|review|handoff|other |
| `resolveOpenLoop(loopId, status, resolution?)` | status: 'resolved' or 'cancelled' |
| `getOpenLoops(filters?)` | List loops (status, loop_type, priority, limit) |
| `registerAssumption(assumption)` | Log what agent believes (action_id, assumption, basis) |
| `getAssumption(assumptionId)` | Single assumption |
| `validateAssumption(assumptionId, validated, reason?)` | Validate (true) or invalidate (false + required reason) |
| `getDriftReport(filters?)` | Assumptions with risk scoring |

### Signals (1 method)

| Method | Description |
|--------|-------------|
| `getSignals()` | Returns 7 signal types: autonomy_spike, high_impact_low_oversight, repeated_failures, stale_loop, assumption_drift, stale_assumption, stale_running_action |

### Dashboard Data (13 methods)

| Method | Description |
|--------|-------------|
| `reportTokenUsage(usage)` | tokens_in, tokens_out, model, context_used, context_max |
| `wrapClient(llmClient, opts?)` | Wrap Anthropic or OpenAI client for auto token reporting |
| `recordDecision(entry)` | Learning database: decision, context, reasoning, outcome, confidence |
| `getRecommendations(filters?)` | Adaptive recommendations from scored episodes |
| `getRecommendationMetrics(filters?)` | Recommendation telemetry + effectiveness deltas |
| `recordRecommendationEvents(events)` | Write telemetry events (batch) |
| `setRecommendationActive(id, active)` | Enable/disable recommendation |
| `rebuildRecommendations(opts?)` | Recompute from recent learning episodes |
| `recommendAction(action)` | Apply top recommendation hints to action payload |
| `createGoal(goal)` | Goal: title, category, description, target_date, progress, status |
| `recordContent(content)` | Content: title, platform, status, url |
| `recordInteraction(interaction)` | CRM interaction: summary, contact_name/id, direction, type, platform |
| `reportConnections(connections)` | Self-report active integrations |
| `createCalendarEvent(event)` | Event: summary, start_time, end_time, location |
| `recordIdea(idea)` | Idea: title, description, category, score, status, source |
| `reportMemoryHealth(report)` | Health: score, entities[], topics[] |

### Session Handoffs (3 methods)

| Method | Description |
|--------|-------------|
| `createHandoff(handoff)` | summary*, session_date?, key_decisions[]?, open_tasks[]?, mood_notes?, next_priorities[]? |
| `getHandoffs(filters?)` | date?, limit? |
| `getLatestHandoff()` | Most recent handoff for this agent |

### Context Manager (7 methods)

| Method | Description |
|--------|-------------|
| `captureKeyPoint(point)` | content*, category?, importance 1-10?, session_date? |
| `getKeyPoints(filters?)` | category?, session_date?, limit? |
| `createThread(thread)` | name* (unique per agent per org), summary? |
| `addThreadEntry(threadId, content, entryType?)` | Add entry to thread |
| `closeThread(threadId, summary?)` | Close with optional final summary |
| `getThreads(filters?)` | status?, limit? |
| `getContextSummary()` | Parallel fetch: today's points + active threads |

### Automation Snippets (5 methods)

| Method | Description |
|--------|-------------|
| `saveSnippet(snippet)` | name*, code*, description?, language?, tags[]? — upserts on name |
| `getSnippet(snippetId)` | Fetch by ID |
| `getSnippets(filters?)` | search?, tag?, language?, limit? |
| `useSnippet(snippetId)` | Increment use_count |
| `deleteSnippet(snippetId)` | Delete by ID |

### User Preferences (6 methods)

| Method | Description |
|--------|-------------|
| `logObservation(obs)` | observation*, category?, importance 1-10? |
| `setPreference(pref)` | preference*, category?, confidence 0-100? |
| `logMood(entry)` | mood*, energy?, notes? |
| `trackApproach(entry)` | approach*, context?, success boolean? |
| `getPreferenceSummary()` | All preference data summary |
| `getApproaches(filters?)` | Approaches with success/fail counts |

### Daily Digest (1 method)

| Method | Description |
|--------|-------------|
| `getDailyDigest(date?)` | Aggregates from 7 tables: actions, decisions, lessons, content, ideas, interactions, goals |

### Security Scanning (3 methods)

| Method | Description |
|--------|-------------|
| `scanContent(text, destination?)` | 18 regex patterns. Returns clean, findings, redacted_text. Does NOT store content. |
| `reportSecurityFinding(text, destination?)` | Scan + store metadata (never raw content) |
| `scanPromptInjection(text, opts?)` | Detect role overrides, delimiter injection, instruction smuggling, encoding evasion |

**Security scanner patterns:** API keys, AWS creds, JWT tokens, private keys, email, phone, SSN, credit cards, IP addresses (18 total)

### Agent Messaging (11 methods)

| Method | Description |
|--------|-------------|
| `sendMessage(params)` | to?, type?, subject?, body*, threadId?, urgent?, docRef?, attachments[]? |
| `getInbox(params?)` | type?, unread?, threadId?, limit? |
| `markRead(messageIds)` | Batch mark as read |
| `archiveMessages(messageIds)` | Batch archive |
| `broadcast(params)` | type?, subject?, body*, threadId? |
| `createMessageThread(params)` | name*, participants[]? |
| `getMessageThreads(params?)` | status?, limit? |
| `resolveMessageThread(threadId, summary?)` | Close thread |
| `saveSharedDoc(params)` | name*, content* — upserts by name |
| `getAttachmentUrl(attachmentId)` | Returns download URL string |
| `getAttachment(attachmentId)` | Returns `{ data: Buffer, filename, mimeType }` |

### Behavior Guard (2 methods)

| Method | Description |
|--------|-------------|
| `guard(context, opts?)` | action_type*, risk_score?, systems_touched[]?, reversible?, declared_goal?. Returns allow/warn/block/require_approval |
| `getGuardDecisions(filters?)` | decision?, limit?, offset? |

**Guard modes:**
- `'off'` — no auto-check (default)
- `'warn'` — console.warn if blocked, proceed anyway
- `'enforce'` — throw `GuardBlockedError` on block or require_approval

**5 Policy Types:** risk_threshold, require_approval, block_action_type, rate_limit, webhook_check

### Bulk Sync (1 method)

| Method | Description |
|--------|-------------|
| `syncState(state)` | Push all categories at once: connections, memory, goals, learning, content, inspiration, context_points, context_threads, handoffs, preferences, snippets, capabilities |

### Policy Testing (3 methods)

| Method | Description |
|--------|-------------|
| `testPolicies()` | Run guardrails tests. Returns pass/fail per policy. |
| `getProofReport(opts?)` | Compliance proof report (format: 'json' or 'md') |
| `importPolicies({ pack?, yaml? })` | Import named pack (enterprise-strict|smb-safe|startup-growth|development) or raw YAML |

### Compliance Engine (5 methods)

| Method | Description |
|--------|-------------|
| `mapCompliance(framework)` | Control-by-control coverage matrix |
| `analyzeGaps(framework)` | Gap analysis + remediation plan |
| `getComplianceReport(framework, opts?)` | Full report + snapshot |
| `listFrameworks()` | Available frameworks: soc2, iso27001, gdpr, nist-ai-rmf, imda-agentic |
| `getComplianceEvidence(opts?)` | Guard decision evidence. window: '7d'|'30d'|'90d' |

### Task Routing (10 methods)

| Method | Description |
|--------|-------------|
| `listRoutingAgents(filters?)` | status? filter |
| `registerRoutingAgent(agent)` | name*, capabilities[]?, maxConcurrent?, endpoint? |
| `getRoutingAgent(agentId)` | Agent + current metrics |
| `updateRoutingAgentStatus(agentId, status)` | available\|busy\|offline |
| `deleteRoutingAgent(agentId)` | Remove from pool |
| `listRoutingTasks(filters?)` | status?, agent_id?, limit?, offset? |
| `submitRoutingTask(task)` | title*, description?, requiredSkills[]?, urgency?, timeoutSeconds?, maxRetries?, callbackUrl? |
| `completeRoutingTask(taskId, result?)` | Mark complete with optional result |
| `getRoutingStats()` | Throughput, latency, utilization |
| `getRoutingHealth()` | Health status + diagnostics |

### Agent Schedules (2 methods)

| Method | Description |
|--------|-------------|
| `listAgentSchedules(filters?)` | agent_id? filter |
| `createAgentSchedule(schedule)` | agent_id*, name*, cron_expression*, description?, enabled? |

### Agent Pairing (3 methods)

| Method | Description |
|--------|-------------|
| `createPairing(opts)` | publicKeyPem*, algorithm?, agentName? — returns pairing_url |
| `createPairingFromPrivateJwk(privateJwk, opts?)` | Derives public PEM from JWK |
| `waitForPairing(pairingId, opts?)` | Poll until approved or expired |

### Identity Binding (2 methods)

| Method | Description |
|--------|-------------|
| `registerIdentity(identity)` | agent_id*, public_key PEM*, algorithm? — admin only |
| `getIdentities()` | List all registered identities |

### Organization Management (5 methods)

| Method | Description |
|--------|-------------|
| `getOrg()` | Current org details |
| `createOrg(org)` | name*, slug* — returns raw API key (shown once) |
| `getOrgById(orgId)` | Org by ID |
| `updateOrg(orgId, updates)` | Update name/slug |
| `getOrgKeys(orgId)` | List org API keys |

### Activity Logs (1 method)

| Method | Description |
|--------|-------------|
| `getActivityLogs(filters?)` | action?, actor_id?, resource_type?, before?, after?, limit?, offset? |

### Webhooks (5 methods)

| Method | Description |
|--------|-------------|
| `getWebhooks()` | List all org webhooks |
| `createWebhook(webhook)` | url*, events[]? |
| `deleteWebhook(webhookId)` | Delete webhook |
| `testWebhook(webhookId)` | Send test event |
| `getWebhookDeliveries(webhookId)` | Delivery history |

### Real-Time Events (1 method)

| Method | Description |
|--------|-------------|
| `events()` | Async iterator of SSE events. `.on(event, cb)` + `.close()` API also available. |

**SSE event types:** `action.created`, `action.updated`, `message.created`, `policy.created`, `policy.updated`, `task.created`, `task.updated`

### Error Classes

| Class | When Thrown |
|-------|-------------|
| `GuardBlockedError` | `guardMode: 'enforce'` + guard returns block/require_approval. Has: decision, reasons, warnings, matchedPolicies, riskScore |
| `ApprovalDeniedError` | `hitlMode: 'wait'` + human denies approval |

---

## 9. Python SDK

Same methods as Node, but snake_case. Install from `sdk-python/` directory.

```python
from dashclaw import DashClaw

claw = DashClaw(
    base_url='http://localhost:3000',
    api_key=os.environ['DASHCLAW_API_KEY'],
    agent_id='my-python-agent'
)

# Context manager for automatic tracking
with claw.track(action_type='build', declared_goal='Compile assets'):
    # work here
    pass

# Direct action recording
claw.create_action(
    action_type='deploy',
    declared_goal='Ship v2',
    risk_score=70
)
```

**Python SDK parity:** 100% (98+ methods across 22 categories). Only `events()` is Node-only (no async generator in Python).

---

## 10. Risk Signals (Automatic Detection)

No configuration needed. Signals fire based on behavior data.

| Signal | Trigger | Severity |
|--------|---------|----------|
| `autonomy_spike` | >10 actions/hour per agent | Red >20, Amber 10-20 |
| `high_impact_low_oversight` | Irreversible + risk≥70 + no authorization_scope | Red ≥90, Amber 70-89 |
| `repeated_failures` | >3 failed actions in 24h | Red >5, Amber 3-5 |
| `stale_loop` | Open loop unresolved >48h | Red >96h, Amber 48-96h |
| `assumption_drift` | ≥2 invalidated assumptions in 7d | Red ≥4, Amber 2-3 |
| `stale_assumption` | Assumption not validated >14d | Red >30d, Amber 14-30d |
| `stale_running_action` | Action stuck in 'running' >4h | Red >24h, Amber 4-24h |

Signals are computed on-demand (GET /api/actions/signals) and by cron (GET /api/cron/signals).

---

## 11. Behavior Guard

### 5 Policy Types

| Type | Rules | Decision |
|------|-------|----------|
| `risk_threshold` | threshold (0-100), action_types[]? | block or warn |
| `require_approval` | action_types[] | require_approval |
| `block_action_type` | action_types[] | block |
| `rate_limit` | max_actions, window_minutes, per_agent | warn or block |
| `webhook_check` | url HTTPS, timeout_ms 1000-10000, on_timeout | external decision |

### Webhook Check Details
- Customer endpoint receives: event, org_id, timestamp, context, preliminary_decision, matched_policies, reasons, warnings
- Customer can only **escalate** severity (never downgrade)
- SSRF protection: private IPs, localhost, link-local blocked
- Delivery logged to `webhook_deliveries` (event_type `guard.evaluation`)

### Decision Severity Order
`allow` < `warn` < `require_approval` < `block`

---

## 12. Environment Variables

### Required
```
DATABASE_URL          # Postgres connection string
NEXTAUTH_URL          # e.g., http://localhost:3000
NEXTAUTH_SECRET       # random hex (openssl rand -hex 32)
GITHUB_ID + GITHUB_SECRET   # GitHub OAuth app
DASHCLAW_API_KEY      # Root API key (protects /api/* in production)
ENCRYPTION_KEY        # 32 chars, encrypts settings at rest
```

### Optional Auth
```
GOOGLE_ID + GOOGLE_SECRET   # Google OAuth
```

### Optional Features
```
RESEND_API_KEY         # Email alerts (resend.com)
ALERT_FROM_EMAIL       # default: practicalsystems.io@gmail.com
CRON_SECRET            # Bearer token for /api/cron/* endpoints
```

### Optional Security
```
ENFORCE_AGENT_SIGNATURES    # default: true in prod, false in dev
DASHCLAW_CLOSED_ENROLLMENT  # true = only pre-registered agents
TRUST_PROXY                 # true = trust x-forwarded-for
DASHCLAW_GUARD_FALLBACK      # 'block' = fail-closed if guard LLM unavailable
```

### Optional Rate Limiting
```
DASHCLAW_RATE_LIMIT_MAX         # default: 100 req/min
DASHCLAW_RATE_LIMIT_WINDOW_MS   # default: 60000
DASHCLAW_DISABLE_RATE_LIMIT     # true = disable (dev only)
```

### Mode
```
DASHCLAW_MODE               # 'demo' | 'self_host' (default)
NEXT_PUBLIC_DASHCLAW_MODE   # same value, client-side
```

### OAuth Callback URIs (local dev)
```
http://localhost:3000/api/auth/callback/github
http://localhost:3000/api/auth/callback/google
```

---

## 13. Essential Commands

```bash
# Development
npm install
npm run dev
npm run build
npm run lint

# Testing
npm run test              # watch mode
npm run test -- --run     # CI / non-watch

# Governance checks (all run in CI)
npm run docs:check            # SDK docs governance
npm run route-sql:check       # No direct SQL in routes
npm run openapi:check         # API contract drift check
npm run api:inventory:check   # Route inventory drift check
npm run openapi:generate      # Generate OpenAPI spec
npm run api:inventory:generate # Generate inventory JSON + MD

# Database migrations (idempotent, safe to re-run)
node scripts/_run-with-env.mjs scripts/migrate-multi-tenant.mjs
node scripts/_run-with-env.mjs scripts/migrate-cost-analytics.mjs
node scripts/_run-with-env.mjs scripts/migrate-identity-binding.mjs
node scripts/_run-with-env.mjs scripts/migrate-capabilities.mjs

# Drizzle ORM (schema management only)
npm run db:generate     # Generate SQL migrations
npm run db:push         # Sync schema with Neon

# Admin scripts
node scripts/create-org.mjs --name "Acme" --slug "acme"
node scripts/bootstrap-agent.mjs --dir "/path" --agent-id "my-agent" --local
node scripts/report-action.mjs --agent-id my-agent --type build --goal "Deploy"
node scripts/cleanup-actions.mjs --before "2026-01-01" --dry-run
node scripts/generate-agent-keys.mjs <agent-id>
node scripts/register-identity.mjs --agent-id ... --public-key-file ...
```

---

## 14. UI / Design System

- **Dark-only theme** — flat surfaces, no glassmorphism or gradients
- **Design tokens** in `globals.css` as CSS custom properties: `--color-brand`, `--color-bg-primary`, `--color-border`, etc.
- **Tailwind** extends tokens to utility classes: `bg-brand`, `bg-surface-secondary`, `text-zinc-300`
- **Icons** — all via `lucide-react` (no emoji anywhere in rendered UI)
- **Typography** — Inter font, `text-sm text-zinc-300` body, `text-xs text-zinc-500` labels, `font-mono text-xs` for timestamps/IDs

### Shared UI Primitives (`app/components/ui/`)
`Card`, `CardHeader`, `CardContent`, `Badge` (6 variants), `Stat`, `StatCompact`, `ProgressBar`, `EmptyState`, `Skeleton`, `CardSkeleton`, `ListSkeleton`

### Navigation
- Persistent `Sidebar.js` — w-56 desktop, collapsible to w-14, hamburger on mobile
- `PageLayout.js` — wraps every page (breadcrumbs, sticky header, title, actions, NotificationCenter, AgentFilterDropdown)
- `SystemStatusBar.js` — below page header, shows STABLE/REVIEWING/DRIFTING/ELEVATED/ALERT, auto-refreshes 30s

### Dashboard Grid
- Draggable/resizable 4-column layout via `react-grid-layout` v2
- Layout persists to localStorage (version 2)
- Mobile (<768px) — single column, drag/resize disabled

### Agent Filter
- `AgentFilterContext.js` provides global agent filter across all pages
- `AgentFilterProvider` in `SessionWrapper.js` — persists across navigation
- All data pages pass `?agent_id=X` when filter is active

---

## 15. Compliance Frameworks

Supported frameworks (map, gap analysis, evidence, reports):
- **SOC 2** — CC6.1, CC6.2, CC6.3, CC7.x, CC8.1
- **ISO 27001** — A.5, A.8, A.9, A.12
- **GDPR** — Article 5, 22, 25, 32
- **NIST AI RMF** — GOVERN, MAP, MEASURE, MANAGE
- **IMDA Agentic AI** — Singapore guidelines

---

## 16. Security Headers & Hardening

All set in both `middleware.js` (API routes) and `next.config.js` (all routes):
- Content-Security-Policy (CSP)
- HSTS with preload
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- Referrer-Policy

Additional limits:
- 2 MB request body size limit (middleware, POST/PUT/PATCH)
- SSE connections capped at 30-minute max duration
- Rate limiting: 100 req/min per IP (configurable)
- Agent-reported risk_score clamped to 0-100
- Agent-reported cost/token values clamped to safe maximums
- SSRF protection on webhook check URLs (private IPs blocked, DNS resolved)

---

## 17. Agent Bootstrap System

Three approaches to import an existing agent's state:

### CLI Scanner (`scripts/bootstrap-agent.mjs`)
Mechanically scans workspace directory. Detects:
- Connections (env key names, package.json deps)
- Memory (MEMORY.md, .claude/**/*.md, memory/**/*.md)
- Goals (projects.md, checkbox task lists, TODOs)
- Learning (memory/decisions/*.md tables)
- Context Points (sections from markdown docs)
- Snippets (fenced code blocks)
- All 13 sync categories

### Self-Discovery Prompt (`scripts/bootstrap-prompt.md`)
Paste to agent — it introspects its own workspace and pushes via `syncState()`.

### Bulk Sync API (`POST /api/sync`)
Single endpoint, all categories in one request.

**Recommended:** Run CLI scanner first (files/connections/snippets/capabilities), then paste prompt (relationships/reasoning/observations/communication style).

---

## 18. Multi-Tenancy Architecture

- Every data table has `org_id TEXT NOT NULL DEFAULT 'org_default'`
- `organizations` table: id (`org_`), name, slug, plan
- `api_keys` table: org-scoped keys (SHA-256 hash stored, raw shown once)
- New users land on `org_default` until they create a workspace
- Onboarding: Create Workspace → Generate Key → Install SDK → First Action
- JWT org refresh: auth.js re-queries user's org_id/role every 5 minutes (orgRefreshedAt TTL)
- Settings support per-agent overrides: `DISTINCT ON (org_id, agent_id, key)` returns merged settings

---

## 19. CI / Governance Gates

All PRs to `main` must pass:
1. `npm ci` — clean install
2. `npm run lint` — ESLint
3. `npm run scripts:check-syntax` — syntax parse for scripts/
4. `npm run docs:check` — docs governance
5. `npm run openapi:check` — API contract drift
6. `npm run api:inventory:check` — route inventory drift
7. `npm run route-sql:check` — no SQL in route files
8. `npm run test -- --run` — Vitest unit tests
9. `npm run build` — Next.js production build
10. Cross-SDK integration suite (Node + Python)

---

## 20. Documentation Files to Always Update

When adding ANY new API route or SDK method, update ALL of these:

1. `app/docs/page.js` — Website docs page (navItems + MethodEntry)
2. `sdk/README.md` — Node SDK README (powers "Copy as Markdown" via `/api/docs/raw`)
3. `sdk-python/README.md` — Python SDK README
4. `docs/sdk-parity.md` — SDK parity matrix
5. `docs/api-inventory.md` — API route inventory
6. `PROJECT_DETAILS.md` — Canonical architecture doc
7. `docs/dashclaw website in markdown.md` — Website content snapshot

Then run:
```bash
npm run docs:check
npm run route-sql:check
npm run openapi:generate
npm run api:inventory:generate
```

---

## 21. Deployment (Vercel)

```
URL: http://localhost:3000 (local) / https://dashclaw.io (production)
Project: ucsandmans-projects/dash-claw
GitHub: Connected — auto-deploys on push to main
Region: Washington D.C. (iad1)
```

**Required env vars on Vercel:** `DATABASE_URL`, `DASHCLAW_API_KEY`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`

**Deploy commands:**
```bash
vercel deploy --prod --yes   # Manual
git push origin main         # Auto via GitHub integration
```

---

## 22. Common Errors & Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401` | Invalid/revoked API key | Generate new key from API Keys page |
| `402` | Quota exceeded | Only in modified/hosted builds; check `app/lib/usage.js` |
| `403` | Member-only route or HITL block | Check role; use admin key for admin routes |
| `429` | Rate limit | Reduce request frequency; check `DASHCLAW_RATE_LIMIT_MAX` |
| `503` | `DASHCLAW_API_KEY` not set in production | Set env var |
| `redirect_uri` error | OAuth callback URL missing | Add `http://localhost:3000/api/auth/callback/github` to OAuth app |
| Signed actions not verified | Public key not registered | Use `createPairing()` or `POST /api/identities` |
| `sql(query, params)` error | Wrong Neon driver usage | Use `sql.query("...", [params])` instead |

---

## Quick Reference Card

```
INSTALL:        npm install dashclaw
IMPORT (ESM):   import { DashClaw, GuardBlockedError } from 'dashclaw';
IMPORT (CJS):   const { create } = require('dashclaw');
DASHBOARD:      http://localhost:3000/dashboard
DOCS:           http://localhost:3000/docs
API BASE:       http://localhost:3000/api

CONSTRUCTOR:
  new DashClaw({ baseUrl*, apiKey*, agentId*, agentName?, guardMode?, hitlMode? })

TOP 10 METHODS:
  createAction({ action_type*, declared_goal*, risk_score?, ... })
  updateOutcome(actionId, { status, output_summary, ... })
  track(actionDef, asyncFn)                     ← auto-wrap
  guard({ action_type*, risk_score?, ... })      ← before risky ops
  getSignals()                                   ← 7 signal types
  registerOpenLoop({ action_id*, loop_type*, description* })
  registerAssumption({ action_id*, assumption*, basis? })
  createHandoff({ summary*, key_decisions[]?, open_tasks[]? })
  getContextSummary()                            ← points + threads
  syncState({ connections, memory, goals, ... }) ← bulk push

GUARD MODES:  'off' → nothing | 'warn' → log+proceed | 'enforce' → throw
HITL MODES:   'off' → 202 immediately | 'wait' → block until approved

ID PREFIXES:  act_ loop_ as_ gp_ gd_ msg_ mt_ sn_ ct_ cp_ ho_ usr_ key_ org_
```

---

## 23. Supplementary Details (from deep codebase scan)

### Repository Layer (17 files in `app/lib/repositories/`)

| File | Purpose |
|------|---------|
| `actions.repository.js` | Action record CRUD + signals computation + trace building |
| `agents.repository.js` | Agent discovery (from action_records, goals, decisions); bootstrap flows |
| `learningLoop.repository.js` | Learning episodes, recommendations, metrics |
| `snippets.repository.js` | Code snippet storage + search + use_count tracking |
| `compliance.repository.js` | Framework mapping, gap analysis, evidence collection |
| `guardrails.repository.js` | Guard policy storage + evaluation context |
| `agentSchedules.repository.js` | Agent execution schedule management |
| `routing.repository.js` | Task routing agents + task queue management |
| `invites.repository.js` | Team invitation token management (7-day expiry) |
| `settings.repository.js` | Integration credentials (encrypted; per-org + per-agent overrides) |
| `messagesContext.repository.js` | Agent message threads, docs, SSE subscriptions |
| `digest.repository.js` | Daily digest aggregation (7 categories, no persistence) |
| `connections.repository.js` | Agent-reported integration connections |
| `promptInjection.repository.js` | Prompt injection detection metadata + scan history |
| `tokens.repository.js` | Token usage snapshots + daily cost totals |
| `orgsTeam.repository.js` | Multi-tenant org + team member + invite management |
| `bugHunter.repository.js` | Bug/issue tracking for agents |

### Additional Database Migrations

| Migration | Key Tables Created |
|-----------|-------------------|
| `migrate-learning-loop-mvp.mjs` | `learning_episodes`, `learning_recommendations`, `learning_metrics` |
| `migrate-behavioral-ai.mjs` | `behavior_patterns`, `behavior_clusters` |
| `migrate-action-records-compat.mjs` | Action record backwards-compat columns |
| `migrate-ideas-subscores.mjs` | `idea_subscores` (impact, feasibility, alignment) |
| `migrate-agent-schedules.mjs` | `agent_schedules` |
| `migrate-message-attachments.mjs` | `message_attachments` (base64-encoded files) |
| `migrate-token-budgets.mjs` | `token_budgets`, `token_budget_periods` |
| `migrate-prompt-injection.mjs` | `prompt_injection_scans`, `prompt_injection_findings` |

### Additional DB Tables (beyond main migration)

```
learning_episodes         # Scored decision+outcome pairs for recommendations
learning_recommendations  # Auto-generated improvement suggestions
learning_metrics          # Recommendation effectiveness tracking
behavior_patterns         # Detected agent behavioral patterns
behavior_clusters         # Pattern groupings/clusters
idea_subscores            # Granular idea scoring (impact, feasibility, alignment)
token_budgets             # Token budget definitions per agent/org
token_budget_periods      # Budget period tracking (daily/weekly/monthly)
prompt_injection_scans    # Prompt injection scan results
prompt_injection_findings # Individual findings from injection scans
agent_schedules           # Agent recurring task schedules (cron expressions)
expected_identities       # Pre-registered agent public keys (closed enrollment)
```

### Additional Middleware Lib Files

| File | Purpose |
|------|---------|
| `lib/promptInjection.js` | Heuristic prompt injection detection (role overrides, delimiters, smuggling, exfiltration) |
| `lib/encryption.js` | AES-256-GCM symmetric encryption for settings at rest |
| `lib/identity.js` | Cryptographic agent identity (sign-on-source, verify-on-sink pattern) |
| `lib/pairings.js` | Agent pairing flow (generate pairing request, approval polling) |
| `lib/events.js` | SSE event emission + subscription management |
| `lib/learning-loop.js` | Learning loop core: episode scoring, recommendation generation |
| `lib/learningLoop.service.js` | Learning recommendations service (fetch, adapt, record telemetry) |
| `lib/validateEnv.js` | Startup env var validation (warn/error on missing required vars) |
| `lib/timing-safe.js` | Timing-safe string comparison (prevents timing oracle attacks) |
| `lib/canonical-json.js` | Deterministic JSON serialization for hashing |
| `lib/llm.js` | OpenAI/LLM utilities for semantic guard analysis |
| `lib/isDemoMode.js` | `DASHCLAW_MODE=demo` detection |
| `lib/dashboardLayoutState.js` | Dashboard grid localStorage persistence (layout version 2) |
| `lib/AgentFilterContext.js` | Global React context for agent filter (persists across navigation) |
| `lib/docExport.js` | Document export utilities |
| `lib/globToRegex.js` | Glob pattern → RegExp conversion |

### Learning Loop System (Adaptive Recommendations)

The learning loop converts past decisions into forward-looking recommendations:

1. **Episodes** — each `learning_decision` with a known outcome (`success`/`failure`) becomes an episode
2. **Scoring** — episodes scored by: outcome quality, confidence, recency, action_type match
3. **Rebuild** — `POST /api/learning/recommendations` (admin only) rebuilds from recent episodes
4. **Adapt** — `claw.recommendAction(action)` applies top hints to action payload before submission
5. **Auto-adapt** — `autoRecommend: 'enforce'` in constructor applies hints automatically
6. **Telemetry** — `recordRecommendationEvents()` tracks acceptance/overrides for future scoring

**SDK methods:** `getRecommendations()`, `getRecommendationMetrics()`, `recordRecommendationEvents()`, `setRecommendationActive()`, `rebuildRecommendations()`, `recommendAction()`

### Swarm Support

- `swarmId` constructor param groups multiple agents into a swarm
- `GET /api/swarm/graph` returns nodes (agents) + edges (connections/interactions) for visualization
- `getActions({ swarm_id })` filters by swarm
- Actions auto-attach `swarm_id` from constructor

### Token Budget System

- `token_budgets` table stores budget limits per agent/org (daily/weekly/monthly)
- `GET /api/tokens/budget` returns budget status and burn rate
- `TokenBudgetCard` dashboard widget shows current/remaining budget
- Separate from `token_snapshots` (which tracks raw usage)

### Prompt Injection Detection

- `POST /api/security/prompt-injection` — heuristic scan of input text
- Detects: role overrides (`ignore previous instructions`), delimiter injection (`---`), instruction smuggling, data exfiltration patterns, encoding evasion (base64, hex in prompts)
- Returns: `risk_level` (none/low/medium/high/critical), `recommendation` (allow/warn/block), `categories[]`, `findings[]`
- Metadata stored in `prompt_injection_scans` (never raw content)
- SDK: `claw.scanPromptInjection(text, { source })` — same API, auto-attaches agent_id

### Additional `package.json` Scripts

```bash
npm run sdk:integration           # Cross-SDK Node parity verification
npm run sdk:integration:python    # Cross-SDK Python contract tests
npm run reliability:evidence      # Collect platform convergence evidence
npm run db:generate               # Drizzle: generate SQL migrations
npm run db:push                   # Drizzle: sync schema with Neon
```

### Middleware Detail (1600+ lines)

`middleware.js` handles:
- **Auth**: API key validation (env fast-path + DB hash lookup with 5-min cache) + NextAuth JWT for browser
- **Rate limiting**: Local in-memory (per-instance) + optional Redis/Upstash distributed (`UPSTASH_REDIS_REST_URL`)
- **Security headers**: HSTS preload, CSP (dev: unsafe-eval, prod: strict), X-Frame-Options DENY, nosniff
- **Demo mode**: `DASHCLAW_MODE=demo` serves fixture data from middleware directly (no DB calls)
- **CORS**: Dev open, prod restricted to `ALLOWED_ORIGIN`
- **2 MB body limit** for POST/PUT/PATCH (returns 413 if exceeded)
- **SSE cap**: 30-minute max connection duration
- **Org context**: Strips externally-provided `x-org-*` headers, injects trusted values

### Optional Env Vars (from subagent deep scan)

```
UPSTASH_REDIS_REST_URL    # Distributed rate limiting (optional)
UPSTASH_REDIS_REST_TOKEN  # Upstash auth token (optional)
DASHCLAW_API_KEY_ORG      # Org for bootstrap key override (default: org_default)
OPENAI_API_KEY            # Required for semantic guard + embeddings features
```
