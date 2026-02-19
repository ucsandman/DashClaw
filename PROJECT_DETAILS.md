---
source-of-truth: true
owner: Platform PM
last-verified: 2026-02-17
doc-type: architecture
---

# DashClaw Project Details

DashClaw is AI agent decision infrastructure. This file contains detailed technical information about the platform, moved from CLAUDE.md to keep it concise.

## Operational Maturity

### Testing (Vitest)
- **Environment**: Vitest with `jsdom` and `@vitejs/plugin-react`.
- **Config**: `vitest.config.js` with Next.js alias resolution (`@/*`).
- **Location**: `__tests__/unit/` for unit tests.
- **Command**: `npm run test` (watch mode) or `npm run test -- --run` (CI/non-watch).

### Database Migrations (Drizzle ORM)
- **Tooling**: `drizzle-orm` and `drizzle-kit`.
- **Schema**: `schema/schema.js` (baseline definition mirroring raw SQL).
- **Workflow**: `npm run db:generate` to generate SQL migrations, `npm run db:push` to sync schema with Neon.
- **Note**: The application currently uses raw SQL via `@neondatabase/serverless`; Drizzle is used primarily for schema management and migration tracking.

### CI/CD (GitHub Actions)
- **Workflow**: `.github/workflows/ci.yml`.
- **Gates**: Every PR to `main` must pass:
  1. `npm ci` (clean install)
  2. `npm run lint` (ESLint)
  3. `npm run scripts:check-syntax` (fast syntax parse for `scripts/*.js|*.mjs`)
  4. `npm run docs:check` (documentation governance checks)
  5. `npm run openapi:check` (stable API contract drift check)
  6. `npm run api:inventory:check` (route maturity inventory drift check)
  7. `npm run route-sql:check` (direct route-level SQL guardrail check)
  8. `npm run test -- --run` (Vitest unit tests)
  9. `npm run build` (Next.js production build)

### Reliability And Governance Controls
- Archived program RFC source: `docs/rfcs/platform-convergence.md`
- Archived milestone/verification log: `docs/rfcs/platform-convergence-status.md`
- SDK parity matrix: `docs/sdk-parity.md`
- CI guard scripts: `scripts/check-openapi-diff.mjs`, `scripts/check-api-inventory-diff.mjs`, `scripts/check-route-sql-guard.mjs`, `scripts/check-convergence-ws1-latency.mjs` (legacy WS1 evidence gate)

## Architecture

```
app/
├── page.js                    # Public landing page (marketing on dashclaw.io, homepage on self-hosted)
├── layout.js                  # Root layout (Inter font, SessionWrapper)
├── globals.css                # Design tokens (CSS custom properties) + Tailwind
├── mission-control/page.js    # Mission Control — strategic fleet overview (signals, loops, cost, fleet status, activity timeline)
├── dashboard/page.js          # Authenticated dashboard (draggable/resizable widget grid)
├── lib/validate.js            # Input validation helpers
├── lib/db.js                  # Shared database connection utility (production-safe)
├── lib/security.js            # DLP / Sensitive data scanning engine
├── lib/embeddings.js          # Vector embedding generation (OpenAI)
├── lib/maintenance.js         # Proactive memory health engine
├── lib/org.js                 # Multi-tenant org helpers (getOrgId, getOrgRole, getUserId)
├── lib/auth.js                # NextAuth config (GitHub + Google, JWT, user upsert)
├── lib/billing.js             # Cost estimation (tokens -> USD)
├── lib/usage.js               # Usage meters + quota checks
├── lib/connectPrompt.js       # Generates markdown connect prompt for agent sessions
├── lib/colors.js              # Agent color hashing, action type icon map
├── lib/audit.js               # Fire-and-forget activity logging (logActivity)
├── lib/signals.js             # Shared signal computation (computeSignals)
├── lib/guard.js               # Guard evaluation engine (evaluateGuard)
├── lib/webhooks.js            # Webhook HMAC signing, delivery, dispatch + guard webhook delivery
├── lib/notifications.js       # Email alerts via Resend
├── lib/llm.js                 # LLM client with provider abstraction (OpenAI, Anthropic, Google)
├── lib/eval.js                # Evaluation execution engine (regex, contains, llm_judge, etc.)
├── components/
│   ├── ui/                    # Shared primitives (Card, Badge, Stat, ProgressBar, EmptyState, Skeleton)
│   ├── Sidebar.js             # Persistent sidebar navigation (links to /dashboard)
│   ├── PageLayout.js          # Shared page layout (breadcrumbs, title, actions)
│   ├── NotificationCenter.js  # Alert bell + notification dropdown
│   ├── SystemStatusBar.js     # Global risk status bar (STABLE/REVIEWING/DRIFTING/ELEVATED/ALERT state from signal counts, auto-refreshes 30s)
│   ├── ActivityTimeline.js    # Chronological merged timeline of actions, open loops, and learning events (dashboard card)
│   ├── DraggableDashboard.js  # Draggable/resizable 4-column widget grid (react-grid-layout v2, + onboarding checklist)
│   ├── OnboardingChecklist.js # 4-step guided onboarding (workspace, key, SDK, first action)
│   ├── ConnectAgentButton.js  # One-click copy-paste agent connect prompt generator
│   ├── WaitlistForm.js        # Email capture form (client component)
│   ├── SecurityDetailPanel.js  # Slide-out detail drawer (signal + action detail)
│   ├── AssumptionGraph.js     # SVG+HTML trace visualization (parent chain, assumptions, loops)
│   ├── SessionWrapper.js      # NextAuth SessionProvider + AgentFilterProvider wrapper
│   ├── UserMenu.js            # User avatar + sign-out dropdown (client component)
│   └── *.js                   # 14 dashboard widget cards
├── actions/                   # ActionRecord UI pages
├── api-keys/                  # API key management page
├── docs/page.js               # Public SDK documentation (server component)
├── practical-systems/page.js  # Practical Systems branding and about page (public)
├── login/page.js              # Custom login page (GitHub + Google OAuth)
├── bounty-hunter/             # Bounty hunter page
├── content/                   # Content tracker page
├── goals/                     # Goals page
├── integrations/              # Integration settings page
├── learning/                  # Learning database page
├── relationships/             # Mini-CRM page
├── security/                  # Security dashboard (signals, high-risk decisions)
├── policies/                  # Guard policies management page (+ import, test runner, proof report)
├── routing/                   # Task routing page (agent registry, task queue, health)
├── compliance/                # Compliance mapping page (framework controls, gap analysis, evidence, reports)
├── approvals/                 # Human-in-the-loop approval queue page
├── swarm/                     # Swarm Intelligence dashboard (real-time neural web visualization)
├── messages/                  # Agent communication hub (smart inbox, thread conversations, shared docs, SSE real-time)
│   └── _components/           # Extracted sub-components (MessageList, ThreadConversation, SmartInbox, MarkdownBody, etc.)
├── workspace/                 # Agent workspace (digest, context, handoffs, snippets, preferences, memory)
├── activity/                  # Activity log page (audit trail)
├── webhooks/                  # Webhook management page
├── notifications/             # Notification preferences page
├── team/                      # Team management page (members, invites, roles)
├── invite/[token]/            # Invite accept page (standalone layout)
├── setup/                     # Redirects to /dashboard (legacy)
├── tokens/                    # Token usage and cost analytics page
├── workflows/                 # Workflows/SOPs page
└── api/
    ├── auth/[...nextauth]/    # NextAuth route handler (GitHub + Google OAuth)
    ├── actions/               # ActionRecord Control Plane (CRUD + signals + loops + assumptions + trace)
    ├── actions/[actionId]/approve # HITL approval decision endpoint (POST)
    ├── bounties/              # Bounty tracking
    ├── orgs/                  # Organization + API key management (admin only)
    ├── calendar/              # Calendar events
    ├── content/               # Content management
    ├── goals/                 # Goals + milestones
    ├── health/                # DB connectivity check (public)
    ├── inspiration/           # Ideas + ratings
    ├── learning/              # Decisions + lessons
    ├── memory/                # Memory operations
    ├── relationships/         # Contacts + interactions
    ├── schedules/             # Schedule management
    ├── settings/              # Integration credentials (encrypted)
    ├── setup/                 # Setup status (public)
    ├── keys/                  # API key management (list, generate, revoke - admin only for POST/DELETE)
    ├── team/                  # Team management (members list, invite CRUD, role change, remove)
    ├── invite/[token]/        # Invite accept (public GET for details, POST to accept)
    ├── onboarding/            # Onboarding endpoints (status, workspace, api-key)
    ├── tokens/                # Token usage snapshots (disabled - API exists but not used by UI)
    ├── waitlist/              # Waitlist signups (public - no auth required)
    ├── activity/              # Activity log API (GET, paginated)
    ├── webhooks/              # Webhooks CRUD + test + deliveries
    ├── notifications/         # Notification preferences API
    ├── cron/signals/          # Cron endpoint: signal detection + alerting (schedule via external runner)
    ├── cron/memory-maintenance # Cron endpoint: memory health cleanup (schedule via external runner)
    ├── cron/routing-maintenance # Cron endpoint: route pending tasks + check timeouts [beta]
    ├── workflows/             # Workflow definitions
    ├── handoffs/              # Session handoffs API (GET/POST)
    ├── context/               # Context manager: points, threads, entries
    ├── snippets/              # Automation snippets CRUD + use counter
    ├── swarm/graph            # Swarm graph data (nodes + links)
    ├── preferences/           # User preferences (observations, prefs, moods, approaches)
    ├── digest/                # Daily digest aggregation (GET only)
    ├── security/scan/         # Content security scanning (POST only)
    ├── security/prompt-injection/ # Prompt injection scanning (GET/POST)
    ├── sync/                  # Bulk sync (POST - all categories in one request)
    ├── guard/                 # Guard evaluation (POST: check policies, GET: recent decisions)
    ├── policies/              # Guard policy CRUD (GET/POST/PATCH/DELETE - POST/PATCH/DELETE admin only) + test/proof/import [beta]
    ├── compliance/            # Compliance engine: framework mapping, gap analysis, reports, evidence [beta]
    ├── routing/               # Task routing: agents, tasks, stats, health [beta]
    └── messages/              # Agent messaging (messages, threads, shared docs)

sdk/
├── dashclaw.js                # DashClaw SDK (96+ methods across 22+ categories, zero deps, ESM)
├── index.cjs                  # CJS compatibility wrapper
├── package.json               # npm package config (name: dashclaw)
├── LICENSE                    # MIT
└── .npmignore                 # Publish exclusions

sdk-python/
├── dashclaw/
│   ├── __init__.py            # Exports (DashClaw, OpenClawAgent, ApprovalDeniedError)
│   └── client.py              # Python SDK Core (urllib-based, zero deps)
├── README.md                  # Python SDK docs
├── setup.py                   # PyPI package config
└── test_sdk.py                # Integration test suite

scripts/
├── security-scan.js           # Pre-deploy security audit
├── test-actions.mjs           # Integration test suite (~175 assertions, 19 phases)
├── test-full-api.mjs          # Full API test suite (~186 assertions, 15 phases, all remaining routes)
├── migrate-multi-tenant.mjs   # Multi-tenant migration (idempotent)
├── create-org.mjs             # CLI: create org + admin API key
├── report-tokens.mjs          # CLI: parse Claude Code /status and POST to /api/tokens (disabled)
├── report-action.mjs          # CLI: create/update action records via API
├── cleanup-actions.mjs        # CLI: delete stale action records from DB
├── bootstrap-agent.mjs        # CLI: scan agent workspace + push state to API
└── bootstrap-prompt.md        # Prompt file: agent self-discovery (paste to agent)

.claude/skills/                # Claude Code skills for platform operations
└── dashclaw-platform-intelligence/
    ├── SKILL.md               # Skill definition (6 workflows, broad trigger conditions)
    ├── references/             # Progressive-disclosure docs (platform, API surface, troubleshooting)
    └── scripts/                # validate-integration.mjs, diagnose.mjs, bootstrap-agent-quick.mjs

agent-tools/                   # Python CLI tools for local agent ops (memory, security, learning, etc.)
├── tools/                     # Individual tool directories
│   ├── _shared/               # Shared push module (dashclaw_push.py)
│   ├── learning-database/     # Decision/lesson logging
│   ├── goal-tracker/          # Goal tracking with milestones
│   ├── context-manager/       # Key points + threads
│   ├── session-handoff/       # Session continuity documents
│   ├── automation-library/    # Reusable code snippets
│   ├── user-context/          # User preference tracking
│   ├── memory-health/         # Memory health scanner + knowledge graph
│   ├── memory-search/         # Full-text memory search
│   ├── relationship-tracker/  # Mini-CRM for contacts
│   ├── communication-analytics/ # Communication pattern analysis
│   ├── open-loops/            # Unresolved item tracking
│   ├── error-logger/          # Error pattern analysis
│   ├── security/              # Outbound filter, session isolator, audit logger
│   ├── daily-digest/          # Daily summary generator
│   ├── api-monitor/           # API cost/reliability tracking
│   ├── token-efficiency/      # Token budget management
│   ├── token-capture/         # Session token capture
│   └── sync_to_dashclaw.py   # Bulk sync all local data to dashboard
├── install-mac.sh             # Mac/Linux installer
├── install-windows.ps1        # Windows installer
└── .env.example               # Push config template
```

## Key Patterns

### Neon Driver (`@neondatabase/serverless`)
- Tagged templates: ``sql`SELECT * FROM foo WHERE id = ${id}` ``
- Dynamic queries: `sql.query("SELECT * FROM foo WHERE id = $1", [id])`
- **Never** `sql(query, params)` - throws tagged-template error
- TEXT timestamp columns need cast for comparisons: `timestamp_start::timestamptz`

### API Route Pattern
```js
export const dynamic = 'force-dynamic';
export const revalidate = 0;

let _sql;
function getSql() {
  if (!_sql) {
    const { neon } = require('@neondatabase/serverless');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
```

### Auth & Multi-Tenancy
- **User auth**: NextAuth.js v4 with GitHub + Google OAuth (JWT strategy, no DB sessions)
- **Login flow**: `/login` -> OAuth -> callback -> JWT cookie -> redirect to `/dashboard`
- **Config**: `app/lib/auth.js` (providers, callbacks, user upsert), `app/api/auth/[...nextauth]/route.js`
- **Session**: `SessionWrapper.js` wraps layout; `UserMenu.js` in PageLayout header (avatar + sign out)
- **Users table**: `users` (id `usr_` prefix, org_id, email, provider, provider_account_id, role)
- **New user default**: mapped to `org_default` with role `member`
- `middleware.js` gates all `/api/*` routes AND all dashboard page routes
- Middleware matcher includes both API routes and all authenticated page routes (`/dashboard`, `/actions`, `/goals`, etc.)
- Page routes use `getToken()` from `next-auth/jwt` (Edge-compatible) for session checks
- `PROTECTED_ROUTES` array - prefix matching (includes `/api/orgs`, `/api/team`, `/api/invite`)
- `PUBLIC_ROUTES` - `/api/health`, `/api/setup/status`, `/api/waitlist`, `/api/auth`, `/api/webhooks/stripe`, `/api/cron`
- **Role-based access**: Two roles (`admin`, `member`). `session.user.role` available client-side via `useSession()`
- **Admin-only API routes** (return 403 for members): POST/DELETE `/api/keys`, POST/DELETE `/api/settings`, all `/api/team/invite`, PATCH/DELETE `/api/team/[userId]`, all `/api/orgs`, POST/DELETE `/api/webhooks`
- **Admin-only UI**: Generate/revoke API keys hidden for members; Integrations configure modal disabled; Team invite/role/remove sections hidden
- **Member-accessible**: All GET endpoints, all data APIs (actions, goals, learning, etc.)
- Dev mode (no `DASHCLAW_API_KEY` set) allows unauthenticated access -> `org_default`
- Production without key returns 503 (if `DASHCLAW_API_KEY` not configured)
- Same-origin dashboard requests resolve org from NextAuth JWT token (falls back to `org_default`)
- Rate limiting: 100 req/min per IP
- **API key resolution flow**: legacy env key -> `org_default` (fast path); otherwise SHA-256 hash -> `api_keys` table lookup (5-min cache)
- **Dual auth**: Browser uses NextAuth cookies; external SDK uses `x-api-key` headers. Both inject `x-org-id`/`x-org-role`
- Middleware injects `x-org-id` and `x-org-role` headers (external injection stripped)
- Every route uses `getOrgId(request)` from `app/lib/org.js` to scope queries

### Security Headers
- Set in both `middleware.js` (API routes) and `next.config.js` (all routes)
- CSP, HSTS (with preload), X-Frame-Options DENY, nosniff, referrer policy
- 2 MB request body size limit enforced in middleware for POST/PUT/PATCH
- SSE connections capped at 30-minute max duration

### Agent Security
- **Signature enforcement**: Agent signatures verified by default in production (`ENFORCE_AGENT_SIGNATURES`, default true in prod)
- **Closed enrollment**: Optional mode requiring agents to be pre-registered (`DASHCLAW_CLOSED_ENROLLMENT=true`)
- **Cost/token bounds**: Agent-reported cost and token values clamped to safe maximums
- **Risk score clamping**: Agent-reported risk_score clamped to 0-100 range
- **SSRF protection**: Routing dispatch/callback URLs validated (HTTPS required, private IPs blocked, DNS resolved)
- **Guard fallback**: Semantic guard fail-open/closed configurable via `DASHCLAW_GUARD_FALLBACK` (default: allow)
- **Proxy trust**: `x-forwarded-for` and `x-real-ip` only trusted when `TRUST_PROXY=true`

### UI/Design System
- **Dark-only theme** - flat surfaces, no glassmorphism or gradients
- **Design tokens** in `globals.css` as CSS custom properties (`--color-brand`, `--color-bg-primary`, `--color-border`, etc.)
- **Tailwind extension** in `tailwind.config.js` maps CSS variables to utility classes (`bg-brand`, `bg-surface-secondary`, `text-zinc-300`, etc.)
- **Shared primitives** in `app/components/ui/`: `Card`/`CardHeader`/`CardContent`, `Badge` (6 variants), `Stat`/`StatCompact`, `ProgressBar`, `EmptyState`, `Skeleton`/`CardSkeleton`/`ListSkeleton`
- **Icons**: All via `lucide-react` - no emoji anywhere in rendered UI
- **Navigation**: Persistent `Sidebar.js` (w-56 desktop, collapsible to w-14, hamburger on mobile)
- **Page structure**: `PageLayout.js` wraps every page (breadcrumbs, sticky header, title/subtitle, action buttons, NotificationCenter, AgentFilterDropdown)
- **Agent filter**: `AgentFilterContext.js` provides global agent filter; `AgentFilterDropdown.js` renders in PageLayout header. `AgentFilterProvider` is in `SessionWrapper.js` (global - persists across all pages). All data pages (Content, Goals, Learning, Relationships, Workflows, Security) pass `?agent_id=X` when filter is active.
- **Agent colors**: `app/lib/colors.js` - `getAgentColor(agentId)` returns consistent hash-based color from 8-color palette
- **Typography**: Inter font, `text-sm text-zinc-300` body, `text-xs text-zinc-500` labels, `font-mono text-xs` for timestamps/IDs, stat numbers max `text-2xl tabular-nums`
- **Dashboard grid**: Draggable/resizable 4-column layout in `DraggableDashboard.js` using `react-grid-layout` v2 with `useContainerWidth` (measureBeforeMount). Layout persists to localStorage via `dashboardLayoutState.js` (layout version 2). "Reset Layout" button in page header clears saved positions. Mobile (< 768px) stacks cards in single column with drag/resize disabled. Most cards include a "View all →" link that navigates to the corresponding full-page view (e.g. `/actions`, `/goals`, `/security`, `/learning`, `/usage`, `/workspace`, `/relationships`, `/calendar`). Includes `ActivityTimeline` card (merged chronological view of actions, open loops, and learning events with real-time SSE updates).
- **System status bar**: `SystemStatusBar.js` renders below the page header on every dashboard page. Fetches `/api/actions/signals`, computes system state from signal counts (STABLE/REVIEWING/DRIFTING/ELEVATED/ALERT), shows red/amber/all-clear indicators. Auto-refreshes every 30 seconds. Respects global agent filter.
- **GoalsChart**: Summary stats (total, active, completed, avg progress) + top 5 goals with progress bars. No Recharts dependency — uses `StatCompact` and `ProgressBar` primitives.

## Detailed API Routes (POST-enabled)
- `GET /api/agents` - list agents (discovered from action records plus other core tables like goals/decisions; supports `?include_connections=true`)
- `GET/POST /api/agents/connections` - agent self-reported connections (GET: `?agent_id=X`, `?provider=Y`; POST: upsert connections array)
- `GET/POST/DELETE /api/settings` - integration credentials (supports `?agent_id=X` for per-agent overrides; POST/DELETE admin only)
- `GET/POST /api/tokens` - token snapshots + daily totals (disabled - API exists but not used by dashboard)
- `GET/POST /api/learning` - decisions + lessons
- `GET/POST /api/goals` - goals + milestones
- `GET/POST /api/content` - content items
- `GET/POST /api/relationships` - contacts + interactions
- `GET/POST /api/calendar` - calendar events
- `GET/POST /api/inspiration` - ideas/inspiration
- `GET/POST /api/memory` - memory health snapshots, entities, topics
- `GET/POST /api/waitlist` - waitlist signups (public, no auth required; POST upserts by email, GET lists signups)
- `GET/POST/DELETE /api/keys` - API key management (list, generate, revoke for current org; POST/DELETE admin only)
- `GET /api/team` - list workspace members + org info (rejects `org_default`)
- `GET/POST/DELETE /api/team/invite` - invite management (admin only: create, list pending, revoke)
- `PATCH/DELETE /api/team/[userId]` - role change + remove member (admin only; DELETE `?action=leave` for self-leave)
- `GET/POST /api/invite/[token]` - invite details (public GET) + accept invite (POST, requires auth)
- `GET /api/onboarding/status` - onboarding progress (workspace_created, api_key_exists, first_action_sent)
- `POST /api/onboarding/workspace` - create workspace (org) during onboarding
- `POST /api/onboarding/api-key` - generate first API key during onboarding
- `GET /api/activity` - activity logs (paginated, filtered by action/actor/resource_type/date, joins users for actor info)
- `GET/POST/DELETE /api/webhooks` - webhook CRUD (GET: all members; POST/DELETE: admin only; max 10 per org)
- `POST /api/webhooks/[webhookId]/test` - send test webhook payload (admin only)
- `GET /api/webhooks/[webhookId]/deliveries` - recent delivery history (last 20)
- `GET/POST /api/notifications` - notification preferences API
- `GET /api/cron/signals` - cron endpoint: detect new signals, fire webhooks, send email alerts
- `POST /api/cron/routing-maintenance` - cron endpoint: route pending tasks + check timeouts [beta]
- `GET/POST /api/handoffs` - session handoffs (GET: `?agent_id`, `?date`, `?latest=true`; POST: required summary + agent_id)
- `GET/POST /api/context/points` - key points (GET: `?agent_id`, `?category`, `?session_date`; POST: required content)
- `GET/POST /api/context/threads` - threads (GET: `?agent_id`, `?status`; POST: required name, upserts on org+agent+name)
- `GET/PATCH /api/context/threads/[threadId]` - thread detail + update (PATCH: summary, status)
- `POST /api/context/threads/[threadId]/entries` - add entry to thread (validates thread exists + not closed)
- `GET/POST/DELETE /api/snippets` - snippets CRUD (GET: `?search`, `?tag`, `?language`; POST: upserts on org+name)
- `GET /api/snippets/[snippetId]` - fetch single snippet by ID
- `POST /api/snippets/[snippetId]/use` - increment snippet use_count
- `GET/POST /api/preferences` - user preferences (GET: `?type=summary|observations|preferences|moods|approaches`; POST: body.type discriminator)
- `GET /api/digest` - daily digest aggregation (GET: `?date`, `?agent_id`; aggregates from 7 tables, no storage)
- `POST /api/security/scan` - content security scanning (18 regex patterns; returns findings + redacted text; optionally stores metadata)
- `GET/POST /api/security/prompt-injection` - prompt injection scanning (POST: heuristic pattern detection for role overrides, delimiter injection, instruction smuggling, etc.; GET: list recent scans; optionally stores metadata)
- `GET/POST /api/evaluations` - evaluation scores (GET: filtered list; POST: create single score)
- `GET/POST /api/evaluations/scorers` - reusable scorer definitions (POST: admin only)
- `PATCH/DELETE /api/evaluations/scorers/[scorerId]` - update/delete scorer (admin only)
- `GET/POST /api/evaluations/runs` - batch evaluation runs (POST: admin only, executes async)
- `GET/PATCH /api/evaluations/runs/[runId]` - run details, distribution stats + status update
- `GET /api/evaluations/stats` - aggregate evaluation statistics (trends, by scorer, distribution)
- `GET /api/settings/llm-status` - check if an AI provider is configured (OpenAI, Anthropic, or Google)
- `GET/POST/PATCH /api/messages` - agent messages (GET: `?agent_id`, `?direction=inbox|sent|all`, `?type`, `?unread=true`, `?thread_id`; POST: send message; PATCH: batch read/archive)
- `GET/POST/PATCH /api/messages/threads` - message threads (GET: `?status`, `?agent_id`; POST: create; PATCH: resolve/update)
- `/api/messages/attachments` — GET: download attachment binary by ID
- `GET/POST /api/messages/docs` - shared workspace documents (GET: `?id`, `?search`; POST: upsert by name)
- `POST /api/guard` - evaluate guard policies before action execution (returns allow/warn/block/require_approval; ?include_signals=true for live signal check)
- `GET /api/guard` - recent guard decisions (paginated; ?agent_id, ?decision, ?limit, ?offset)
- `GET/POST/PATCH/DELETE /api/policies` - guard policy CRUD (GET: all members; POST/PATCH/DELETE: admin only)
- `POST /api/policies/test` - run guardrails tests against active policies [beta]
- `GET /api/policies/proof` - generate compliance proof report [beta]
- `POST /api/policies/import` - import policy pack or raw YAML [beta]

### Compliance

- `GET /api/compliance/map` - map policies to compliance framework [beta]
- `GET /api/compliance/gaps` - run gap analysis [beta]
- `GET /api/compliance/report` - generate compliance report [beta]
- `GET /api/compliance/frameworks` - list available frameworks [beta]
- `GET /api/compliance/evidence` - get live compliance evidence [beta]
- UI: `/compliance` page — framework selector, coverage stats + ProgressBar, control map (expandable), gap analysis, enforcement evidence, report generation (markdown/JSON with copy/download)
- Sidebar: Scale icon in Operations group (after Task Routing)
- Middleware matcher includes `/compliance` and `/compliance/:path*`

### Routing

- `GET /api/routing/agents` - list routing agents [beta]
- `POST /api/routing/agents` - register routing agent [beta]
- `GET /api/routing/agents/:id` - get routing agent [beta]
- `PATCH /api/routing/agents/:id` - update agent status [beta]
- `DELETE /api/routing/agents/:id` - delete routing agent [beta]
- `GET /api/routing/tasks` - list routing tasks [beta]
- `POST /api/routing/tasks` - submit routing task [beta]
- `POST /api/routing/tasks/:id/complete` - complete routing task [beta]
- `GET /api/routing/stats` - get routing stats [beta]
- `GET /api/routing/health` - get routing health [beta]
- `GET /api/agent-schedules` - list agent schedules (optional `?agent_id`)
- `POST /api/agent-schedules` - create agent schedule
- UI: `/routing` page — health indicator, 6-stat bar, two-column layout with task queue (filter pills, submit form, task list) and agent registry (register form, agent cards with status/capabilities/load)
- Sidebar: Network icon in Operations group (after Workspace)
- Middleware matcher includes `/routing` and `/routing/:path*`

### Per-Agent Settings
- Settings table has `agent_id TEXT` column (nullable - NULL = org-level default)
- Unique index: `settings_org_agent_key_unique` on `(org_id, COALESCE(agent_id, ''), key)`
- `GET /api/settings?category=integration&agent_id=X` - returns merged settings (agent overrides org defaults via `DISTINCT ON`)
- `POST /api/settings` with `agent_id` in body - saves agent-specific override
- `DELETE /api/settings?key=X&agent_id=Y` - deletes agent-specific row only
- Response includes `is_inherited` boolean per setting (true = value comes from org default)
- Integrations page has agent selector dropdown for per-agent configuration

### Agent Connections (Self-Reported)
- Table: `agent_connections` - agents report their active integrations at startup
- Columns: `id` (TEXT `conn_` prefix), `org_id`, `agent_id`, `provider`, `auth_type`, `plan_name`, `status`, `metadata`, `reported_at`, `updated_at`
- Unique index: `agent_connections_org_agent_provider_unique` on `(org_id, agent_id, provider)`
- `auth_type` enum: `api_key`, `subscription`, `oauth`, `pre_configured`, `environment`
- `status` enum: `active`, `inactive`, `error`
- `metadata`: optional JSON string (e.g., `{ "cost": "$100/mo" }`)
- API: `GET/POST /api/agents/connections` - GET supports `?agent_id=X`, `?provider=Y`; POST upserts via `ON CONFLICT`
- POST body: `{ agent_id, connections: [{ provider, auth_type, plan_name, status, metadata }] }` (max 50 per request)
- Integrations page + IntegrationsCard widget merge agent-reported connections with credential-based settings
- Agent-reported connections show blue dot ("Agent Connected") status

## ActionRecord Control Plane
- 3 tables: `action_records`, `open_loops`, `assumptions` (with `invalidated_at` column)
- 13 API routes under `/api/actions/`:
  - `GET/POST /api/actions` - list + create actions (stats respect all query filters: agent_id, status, action_type, risk_min)
  - `GET/PATCH /api/actions/[actionId]` - single action + update outcome
  - `GET /api/actions/[actionId]/trace` - root-cause trace (assumptions, loops, parent chain, related actions)
  - `GET/POST /api/actions/assumptions` - list + create assumptions (supports `drift=true` for drift scoring)
  - `GET/PATCH /api/actions/assumptions/[assumptionId]` - single assumption + validate/invalidate
  - `GET/POST /api/actions/loops` - list + create open loops
  - `GET/PATCH /api/actions/loops/[loopId]` - single loop + resolve/cancel
  - `GET /api/actions/signals` - 7 risk signal types (autonomy_spike, high_impact_low_oversight, repeated_failures, stale_loop, assumption_drift, stale_assumption, stale_running_action)
- SDK: `sdk/dashclaw.js` - 96+ methods across 22+ categories with full Node/Python parity (see `docs/client-setup-guide.md` for current method reference)
- Tests: `scripts/test-actions.mjs` - ~219 assertions across 19 phases (core actions/SDK)
- Tests: `scripts/test-full-api.mjs` - ~186 assertions across 15 phases (all remaining API routes)
- Post-mortem UI: interactive validate/invalidate assumptions, resolve/cancel loops, root-cause analysis
- `timestamp_start` is TEXT (ISO string), not native TIMESTAMP

### DB Migration (if upgrading from Phase 1)
```sql
ALTER TABLE assumptions ADD COLUMN IF NOT EXISTS invalidated_at TEXT;
```

### Token Tables (Disabled)
Token tracking is disabled in the dashboard UI pending a better approach. The API route, DB tables, SDK method, and CLI script still exist but are not linked from the UI. Tables: `token_snapshots`, `daily_totals` (created by migration Step 12).

### Memory Health Tables
- `health_snapshots` - periodic health metrics (score, file counts, duplicates, stale facts)
- `entities` - key entities extracted from memory (name, type, mention_count). Replaced on each POST.
- `topics` - topics/themes from memory (name, mention_count). Replaced on each POST.
- POST `/api/memory` accepts `{ health, entities, topics }` - creates snapshot, replaces entities/topics
- Migration Step 13 in `migrate-multi-tenant.mjs` creates all three tables (idempotent)

### Waitlist Table
- `waitlist` - email signups from landing page (no `org_id` - pre-authentication, global)
- Columns: `id` (SERIAL), `email` (TEXT UNIQUE), `signed_up_at` (TEXT), `signup_count` (INTEGER), `source` (TEXT), `notes` (TEXT)
- POST upserts via `ON CONFLICT (email)` - bumps `signup_count` on duplicates
- Migration Step 14 in `migrate-multi-tenant.mjs` + auto-create fallback in route

### Users Table (NextAuth)
- `users` - OAuth users for dashboard access (managed by auth, not tenant-scoped)
- Columns: `id` (TEXT `usr_` prefix), `org_id` (TEXT, default `org_default`), `email`, `name`, `image`, `provider`, `provider_account_id`, `role`, `created_at`, `last_login_at`
- Unique index: `users_provider_account_unique` on `(provider, provider_account_id)`
- Upserted on every login via `signIn` callback in `app/lib/auth.js`
- Migration Step 15 in `migrate-multi-tenant.mjs`

### Agent ID on Data Tables
- Step 16: `agent_id TEXT` added to `content`, `contacts`, `interactions`, `goals`, `milestones`, `workflows`, `executions`
- Nullable (legacy records get NULL), indexed per table
- API routes for all 7 tables support `?agent_id=X` GET filter
- POST endpoints for content, goals, relationships accept `agent_id` in body
- SDK methods `createGoal()`, `recordContent()`, `recordInteraction()` auto-send `agent_id`
- Signals API: post-filters assembled signals by `agent_id`
- Assumptions API: adds `ar.agent_id` to dynamic WHERE clause

### Security Page
- Route: `/security` (client component, behind auth middleware)
- Fetches 3 endpoints: `/api/actions/signals`, `/api/actions?limit=100`, `/api/actions/assumptions?drift=true`
- Stats bar: Active Signals, High-Risk (24h), Unscoped Actions, Invalidated Assumptions (7d)
- Signal feed (left): clickable rows sorted by severity, opens SecurityDetailPanel
- High-risk actions (right): actions with risk_score>=70 OR (unscoped AND irreversible)
- SecurityDetailPanel: slide-out drawer from right, closes on Escape/backdrop click, supports `onDismiss` callback
- Signal dismissal: client-side via localStorage (`dashclaw_dismissed_signals`), hash = `type:agent_id:action_id:loop_id:assumption_id`
- Dismiss per-signal (X button), "Clear All" header action, "Show Dismissed" toggle with restore (Undo2) buttons
- Stats bar reflects active (non-dismissed) signals only
- Auto-refresh every 30 seconds; respects global agent filter
- Sidebar: "Security" link with ShieldAlert icon in Operations group

## Team & Invites (Implemented)
- Route: `/team` - manage workspace members, invite links, role changes
- Table: `invites` (id `inv_` prefix, org_id, email, role, token, invited_by, status, accepted_by, expires_at, created_at)
- Invite tokens: 64 hex chars, 7-day expiry, link-based (no email service needed)
- API: `GET /api/team` - list members + org info (rejects `org_default`)
- API: `GET/POST/DELETE /api/team/invite` - invite CRUD (admin only)
- API: `PATCH/DELETE /api/team/[userId]` - role change + remove member (admin only; DELETE `?action=leave` for self-leave)
- API: `GET/POST /api/invite/[token]` - public GET for invite details, POST to accept (requires auth)
- Single org per user: users on `org_default` can accept; users on another org must leave first
- Invite accept is race-safe (`WHERE status='pending'` in UPDATE)
- Leave workspace: moves user back to `org_default`, hidden for last admin
- Sidebar: "Team" link with UsersRound icon in System group
- Migration Step 17 in `migrate-multi-tenant.mjs`

### Invites Table
- `invites` - team invitation links
- Columns: `id` (TEXT `inv_` prefix), `org_id`, `email` (nullable - NULL = open invite), `role` (admin/member), `token` (UNIQUE, 64 hex chars), `invited_by` (usr_ id), `status` (pending/accepted/revoked), `accepted_by` (usr_ id), `expires_at` (TEXT ISO), `created_at` (TEXT ISO)
- Indexes: `idx_invites_token`, `idx_invites_org_id`, `idx_invites_status`
- Migration Step 17 in `migrate-multi-tenant.mjs` + `ensureTable()` fallback in invite route

### Usage Meters Table
- `usage_meters` - atomic counters for billing quota enforcement (replaces live COUNTs)
- Columns: `id` (SERIAL), `org_id`, `period` (TEXT: `'YYYY-MM'` for monthly or `'current'` for snapshots), `resource` (TEXT: `actions_per_month` | `agents` | `members` | `api_keys`), `count` (INTEGER), `last_reconciled_at` (TEXT), `updated_at` (TEXT)
- Unique index: `usage_meters_org_period_resource_unique` on `(org_id, period, resource)` - enables atomic `INSERT ... ON CONFLICT DO UPDATE`
- Monthly resources (`actions_per_month`, `agents`): period = `'2026-02'`; snapshot resources (`members`, `api_keys`): period = `'current'`
- Cold start: first request seeds meters from live COUNTs; subsequent requests read 1 row
- Increments are fire-and-forget (don't block API responses); `GREATEST(0, count + delta)` prevents negative counters
- Functions in `app/lib/usage.js`: `getCurrentPeriod()`, `incrementMeter()`, `checkQuotaFast()`, `seedMeters()` (private)
- `getUsage()` reads from meters (1 query for up to 4 rows); `checkQuota()` delegates to `checkQuotaFast()`
- Meter increment points: `POST /api/actions` (+actions, +agents if new), `POST/DELETE /api/keys` (+/-api_keys), `POST /api/invite/[token]` accept (+members), `DELETE /api/team/[userId]` (-members)
- Migration Step 19 in `migrate-multi-tenant.mjs`

## Activity Log (Implemented)
- Route: `/activity` - audit trail of admin actions + system events
- Table: `activity_logs` (id `al_` prefix, org_id, actor_id, actor_type, action, resource_type, resource_id, details JSON, ip_address, created_at)
- Library: `app/lib/audit.js` - fire-and-forget `logActivity()` (same pattern as `incrementMeter()`)
- API: `GET /api/activity` - paginated, filtered by action/actor_id/resource_type/before/after, JOINs users for actor name/image
- Stats: total events, today's events, unique actors
- Actor types: `user`, `system`, `api_key`, `cron`
- Audited events: `key.created`, `key.revoked`, `invite.created`, `invite.revoked`, `invite.accepted`, `role.changed`, `member.removed`, `member.left`, `setting.updated`, `setting.deleted`, `billing.checkout_started`, `webhook.created`, `webhook.deleted`, `webhook.tested`, `webhook.fired`, `signal.detected`, `alert.email_sent`
- Indexes: org_id, created_at, action, actor_id
- Sidebar: "Activity" link with Clock icon in System group (after Usage)
- Migration Step 20 in `migrate-multi-tenant.mjs`

## Webhooks (Implemented)
- Route: `/webhooks` - manage webhook endpoints for signal notifications
- Tables: `webhooks` (id `wh_` prefix), `webhook_deliveries` (id `wd_` prefix)
- Library: `app/lib/webhooks.js` - `signPayload()` (HMAC-SHA256), `deliverWebhook()`, `fireWebhooksForOrg()`
- API: `GET/POST/DELETE /api/webhooks` (GET: all members; POST/DELETE: admin only)
- API: `POST /api/webhooks/[webhookId]/test` - send test payload (admin only)
- API: `GET /api/webhooks/[webhookId]/deliveries` - recent delivery history (last 20)
- Webhook secret: 32-byte hex, shown once on creation, HMAC-SHA256 signature in `X-DashClaw-Signature` header
- Event subscription: JSON array of signal types or `["all"]`
- Max 10 webhooks per org; auto-disabled after 10 consecutive failures
- Delivery logging: status (pending/success/failed), response_status, response_body (truncated to 2000 chars), duration_ms
- Sidebar: "Webhooks" link with Webhook icon in System group (after Activity)
- Migration Steps 21-22 in `migrate-multi-tenant.mjs`

## Email Alerts & Cron (Implemented)
- Route: `/notifications` - email alert preferences per user
- Tables: `notification_preferences` (id `np_` prefix, unique on org_id+user_id+channel), `signal_snapshots` (deduplication via signal_hash)
- Library: `app/lib/signals.js` - `computeSignals()` extracted from signals API route (shared by API + cron)
- Library: `app/lib/notifications.js` - `sendSignalAlertEmail()` via Resend SDK (no-op if `RESEND_API_KEY` not set)
- API: `GET/POST /api/notifications` - user preference CRUD (email channel, signal type filters)
- Cron endpoint: `GET /api/cron/signals` (run via any scheduler):
  1. Auth via `Authorization: Bearer CRON_SECRET`
  2. For each org: compute signals -> hash -> compare to `signal_snapshots` -> find NEW signals
  3. Upsert all current signals into snapshots (update `last_seen_at`)
  4. For new signals: fire webhooks, send emails to opted-in users, log activities
- Signal hashing: MD5 of `type:agent_id:action_id:loop_id:assumption_id`
- Scheduling: DashClaw does not ship a hosted scheduler in OSS. Configure any scheduler (GitHub Actions, system cron, Cloudflare, etc.) to call `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`.
- Sidebar: "Notifications" link with Bell icon in System group (after Webhooks)
- Migration Step 23 in `migrate-multi-tenant.mjs`
- Env vars: `RESEND_API_KEY`, `ALERT_FROM_EMAIL` (default: `alerts@dashclaw.dev`), `CRON_SECRET`

## Onboarding Flow (Implemented)
- 4-step guided checklist displayed on dashboard via `OnboardingChecklist.js` (full-width, self-hides when complete)
- **Step 1**: Create Workspace - text input, calls `POST /api/onboarding/workspace` (creates org, updates user)
- **Step 2**: Generate API Key - button-triggered, calls `POST /api/onboarding/api-key`, shows raw key with copy button
- **Step 3**: Install SDK - static code blocks with key pre-filled
- **Step 4**: Send First Action - code snippet, polls `GET /api/onboarding/status` every 5s to detect first action
- Status endpoint derives 3 booleans: `workspace_created` (org != org_default), `api_key_exists`, `first_action_sent`
- Only users on `org_default` see workspace creation; auto-hides + reloads when all steps done
- Workspace creation auto-generates slug from name, sets plan to `free`, promotes user to `admin`

## API Keys Page (Implemented)
- Route: `/api-keys` - manage workspace API keys
- Lists active and revoked keys with creation/last-used dates
- Generate new keys with labels (format: `oc_live_{32_hex}`, raw shown once)
- Revoke keys with confirmation
- Guards: shows alert if user still on `org_default` (no workspace yet)
- Stats bar: Total, Active, Revoked counts
- Backend: `GET/POST/DELETE /api/keys` (rejects `org_default` users; POST/DELETE admin only)
- Sidebar: "API Keys" link with KeyRound icon in System group
- **Role enforcement**: Generate/revoke buttons hidden for members; empty state shows "ask admin" message

## SDK Documentation Page (Implemented)
- Route: `/docs` - public server component (no auth required, not in middleware matcher)
- Full reference for 95+ SDK methods organized into 21+ categories
- Categories: Action Recording (7), Loops & Assumptions (7), Signals (1), Dashboard Data (9), Session Handoffs (3), Context Manager (7), Automation Snippets (4), User Preferences (6), Daily Digest (1), Security Scanning (2), Agent Messaging (9), Behavior Guard (2), Bulk Sync (1), Policy Testing (3), Compliance Engine (5), Task Routing (10), Agent Pairing (3), Identity Binding (2), Organization Management (5), Activity Logs (1), Webhooks (5), Real-Time Events (1)
- Each method: signature, description, parameter table, return type, code example
- Sticky side navigation with anchor links to all sections
- Quick Start section (3 steps: copy SDK, init client, record first action)
- Constructor reference (5 params), Error Handling section
- Same visual shell as landing page (navbar, footer, dark background)
- Landing page links: navbar "Docs", SDK section "View full SDK docs", footer "Docs"

## JWT Org Refresh
- `app/lib/auth.js` JWT callback periodically re-queries user's org_id/role (5-min TTL)
- Ensures session picks up org changes (e.g., after workspace creation during onboarding)
- Tracks `orgRefreshedAt` timestamp in token to avoid re-querying on every request

## Multi-Tenancy

### Tables
- `organizations` - id (TEXT PK `org_`), name, slug (unique), plan
- `api_keys` - id (TEXT PK `key_`), org_id (FK), key_hash (SHA-256), key_prefix, label, role, revoked_at
- All 33 data tables have `org_id TEXT NOT NULL DEFAULT 'org_default'` + index

### Key Format
`oc_live_{32_hex_chars}` - stored as SHA-256 hash in `api_keys.key_hash`. First 8 chars in `key_prefix` for display.

### Org Management API (admin only)
- `GET/POST /api/orgs` - list/create orgs (POST returns raw API key - shown once)
- `GET/PATCH /api/orgs/[orgId]` - get/update org
- `GET/POST/DELETE /api/orgs/[orgId]/keys` - manage API keys

### Resolution Flow
1. No key + dev mode (no `DASHCLAW_API_KEY` set) -> `org_default` (admin)
2. No key + production (no `DASHCLAW_API_KEY` set) -> 503
3. No key + same-origin browser request (dashboard UI) -> `org_default` (admin)
4. No key + external request -> 401
5. Key matches `DASHCLAW_API_KEY` env -> `org_default` (admin, fast path)
6. Key doesn't match env -> SHA-256 hash -> DB lookup -> org_id + role
7. DB miss or revoked -> 401

### SDK
No code changes needed. The API key determines which organization's data you're accessing.

### Migration (from single-tenant)
```bash
DATABASE_URL=... DASHCLAW_API_KEY=... node scripts/migrate-multi-tenant.mjs
```

## DashClaw Tables (Migration Steps 24-29)

### Handoffs Table (Step 24)
- `handoffs` - session handoff documents for agent continuity
- Columns: `id` (TEXT `ho_` prefix), `org_id`, `agent_id`, `session_date`, `summary`, `key_decisions` (JSON TEXT), `open_tasks` (JSON TEXT), `mood_notes`, `next_priorities` (JSON TEXT), `created_at`
- Indexes: org_id, agent_id, session_date

### Context Tables (Steps 25-26)
- `context_points` - key points captured during sessions
- Columns: `id` (`cp_`), `org_id`, `agent_id`, `content`, `category` (decision|task|insight|question|general), `importance` (1-10), `session_date`, `compressed`, `created_at`
- `context_threads` - named threads for tracking topics across entries
- Columns: `id` (`ct_`), `org_id`, `agent_id`, `name`, `summary`, `status` (active|closed), `created_at`, `updated_at`
- Unique: `(org_id, COALESCE(agent_id, ''), name)`
- `context_entries` - entries within threads
- Columns: `id` (`ce_`), `thread_id` FK, `org_id`, `content`, `entry_type`, `created_at`

### Snippets Table (Step 27)
- `snippets` - reusable code snippets
- Columns: `id` (`sn_`), `org_id`, `agent_id`, `name`, `description`, `code`, `language`, `tags` (JSON TEXT), `use_count`, `created_at`, `last_used`
- Unique: `(org_id, name)` - POST upserts on conflict

### User Preference Tables (Step 28)
- `user_observations` (`uo_`) - agent observations about users (observation, category, importance)
- `user_preferences` (`up_`) - learned user preferences (preference, category, confidence)
- `user_moods` (`um_`) - mood/energy tracking (mood, energy, notes)
- `user_approaches` (`ua_`) - tracked approaches with success/fail counts. Unique: `(org_id, COALESCE(agent_id, ''), approach)`

### Security Findings Table (Step 29)
- `security_findings` (`sf_`) - metadata from security scans (never stores actual content)
- Columns: `id`, `org_id`, `agent_id`, `content_hash` (SHA-256), `findings_count`, `critical_count`, `categories` (JSON TEXT), `scanned_at`

## Agent Messaging Tables (Migration Steps 30-32)

### Agent Messages Table (Step 30)
- `agent_messages` (`msg_`) - async messages between agents with inbox semantics
- Columns: `id`, `org_id`, `thread_id` (FK to message_threads), `from_agent_id`, `to_agent_id` (NULL = broadcast), `message_type` (action|info|lesson|question|status), `subject`, `body`, `urgent` (boolean), `status` (sent|read|archived), `doc_ref`, `read_by` (JSON array for broadcast tracking), `created_at`, `read_at`, `archived_at`
- Indexes: org_id, (org_id, to_agent_id, status), thread_id, (org_id, from_agent_id)

### message_attachments
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `att_<24hex>` |
| org_id | TEXT | Organization |
| message_id | TEXT | Parent message |
| filename | TEXT | Original filename |
| mime_type | TEXT | MIME type |
| size_bytes | INTEGER | File size |
| data | TEXT | Base64-encoded content |
| created_at | TEXT | ISO timestamp |

### Message Threads Table (Step 31)
- `message_threads` (`mt_`) - multi-turn conversation threads
- Columns: `id`, `org_id`, `name`, `participants` (JSON array of agent IDs, NULL = open), `status` (open|resolved|archived), `summary`, `created_by`, `created_at`, `updated_at`, `resolved_at`
- Indexes: org_id, (org_id, status)

### Shared Docs Table (Step 32)
- `shared_docs` (`sd_`) - collaborative workspace documents
- Columns: `id`, `org_id`, `name`, `content`, `created_by`, `last_edited_by`, `version` (auto-incrementing on upsert), `created_at`, `updated_at`
- Indexes: org_id; UNIQUE (org_id, name) for upsert

### Agent Capabilities Table (migrate-capabilities.mjs)
- `agent_capabilities` (`ac_`) - discovered skills and tools for an agent
- Columns: `id`, `org_id`, `agent_id`, `name`, `capability_type` (skill|tool), `description`, `source_path`, `file_count`, `metadata` (JSONB), `created_at`, `updated_at`
- Indexes: org_id; UNIQUE (org_id, COALESCE(agent_id, ''), name, capability_type) for upsert
- Populated by: adaptive bootstrap scanner (`scripts/bootstrap-agent.mjs`) and `POST /api/sync` (capabilities category)

## Behavior Guard (Implemented)
- Route: `/policies` - manage guard policies that govern agent behavior
- Library: `app/lib/guard.js` - `evaluateGuard(orgId, context, sql, options)` core evaluation engine
- Tables: `guard_policies` (gp_ prefix), `guard_decisions` (gd_ prefix)
- 5 policy types: `risk_threshold`, `require_approval`, `block_action_type`, `rate_limit`, `webhook_check`
- Guard evaluation: fetches active policies, evaluates local policies first, then webhook policies with snapshotted preliminary decision
- Decisions: `allow` (200), `warn` (200), `block` (403), `require_approval` (403)
- Optional signal check: `?include_signals=true` adds live risk signal warnings (expensive - 7 extra queries)
- Guard decisions logged fire-and-forget (same pattern as `incrementMeter()`)
- API: `POST /api/guard` (evaluate), `GET /api/guard` (recent decisions + 24h stats)
- API: `GET/POST/PATCH/DELETE /api/policies` (CRUD - POST/PATCH/DELETE admin only)
- API: `POST /api/policies/import` (import policy pack or raw YAML), `POST /api/policies/test` (run guardrails tests), `GET /api/policies/proof` (generate proof report)
- UI: `/policies` page includes policy CRUD, guard decisions, policy pack import, test runner with per-policy expandable results, proof report generation (markdown/JSON with copy/download)
- SDK: `claw.guard(context, options?)`, `claw.getGuardDecisions(filters?)`
- Sidebar: Shield icon in Operations group (after Security)
- Migration Step 33 in `migrate-multi-tenant.mjs`

### Webhook-Based Intervention (Tier 2)
- Policy type: `webhook_check` - calls customer HTTPS endpoint for custom decision logic
- Rules: `url` (HTTPS required, SSRF-protected), `timeout_ms` (1000-10000, default 5000), `on_timeout` ('allow'|'block', default 'allow')
- Customer endpoint receives: event, org_id, timestamp, context, preliminary_decision, matched_policies, reasons, warnings
- Customer responds with: `{ decision, reasons, warnings }` - decision can only escalate severity (never downgrade)
- Delivery logged to `webhook_deliveries` table (event_type `guard.evaluation`, webhook_id = policyId)
- Library: `app/lib/webhooks.js` - `deliverGuardWebhook()` (no HMAC signing, policy-based)
- SSRF protection: private IPs, localhost, link-local addresses blocked in validation
- All webhook policies receive the same snapshotted preliminary decision (no order-dependency)

### beforeAction SDK Hook (Tier 2)
- Constructor params: `guardMode` ('off'|'warn'|'enforce'), `guardCallback` (function)
- `createAction()` calls `_guardCheck()` before API request (also applies to `track()` which calls `createAction()`)
- `off` (default): no guard check (backward compatible)
- `warn`: logs console.warn if blocked/require_approval, proceeds anyway
- `enforce`: throws `GuardBlockedError` if blocked/require_approval
- Guard API failure is fail-open (logs warning, proceeds)
- `GuardBlockedError` class: extends Error, properties: decision, reasons, warnings, matchedPolicies, riskScore
- Exported from SDK: `import { GuardBlockedError } from 'dashclaw'`

### Assumption Graph Visualization (Tier 2)
- Component: `app/components/AssumptionGraph.js` - pure client, no external deps
- SVG bezier connectors (underneath) + absolute-positioned HTML nodes (on top)
- Center column: parent chain (oldest at top) + current action (bottom, brand border)
- Left branches: assumptions as pills (green=validated, red=invalidated, amber=unvalidated)
- Right branches: loops as pills (green=resolved, gray=cancelled, amber=open)
- Bottom row: related actions (up to 5)
- Click: assumptions/loops scroll to detail section, action nodes open in new tab
- Renders on post-mortem page (`/actions/[actionId]`) between metrics and Root Cause Analysis

### Guard Policies Table (Step 33)
- `guard_policies` (`gp_`) - org-level rules governing agent behavior
- Columns: `id`, `org_id`, `name`, `policy_type`, `rules` (JSON string), `active` (0/1), `created_by`, `created_at`, `updated_at`
- UNIQUE index: `(org_id, name)`
- Policy types: risk_threshold, require_approval, block_action_type, rate_limit, webhook_check

### Guard Decisions Table (Step 33)
- `guard_decisions` (`gd_`) - audit log of every guard evaluation
- Columns: `id`, `org_id`, `agent_id`, `decision`, `reason`, `matched_policies` (JSON array), `context` (JSON), `risk_score`, `action_type`, `created_at`
- Indexes: org_id, created_at, agent_id

## Identity Binding (Tier 3)
- **Concept**: Moves from string-based attribution to cryptographic node identity.
- **Architecture**: Sign-on-Source (SDK), Verify-on-Sink (API).
- **Database**:
  - `agent_identities`: org_id, agent_id, public_key, algorithm.
  - `action_records`: added `signature` (TEXT) and `verified` (BOOLEAN) columns.
- **SDK**:
  - Constructor accepts `privateKey` (Web Crypto API `CryptoKey`).
  - `createAction` automatically signs payload if private key is present.
  - Sends `_signature` field in POST body.
- **API**:
  - `POST /api/actions`: verifies signature against registered public key.
  - `POST /api/identities`: register/rotate public keys (admin only; requires `x-api-key` resolving to role `admin`).
  - `GET /api/identities`: list registered identities (same auth as other protected APIs; do not rely on caller-supplied `x-org-*` headers).
- **UI**:
  - `RecentActionsCard`: displays green ShieldCheck icon for verified actions.
- **Migration**: `scripts/migrate-identity-binding.mjs`
 - **Utilities**:
   - `scripts/generate-agent-keys.mjs <agent-id>`: prints a public PEM + private JWK you can wire into an agent.
   - `scripts/register-identity.mjs --agent-id ... --public-key-file ...`: DB upsert helper (requires `DATABASE_URL`).

## Messages Page (Implemented)
- Route: `/messages` - agent communication nerve center with 4 tabs (Inbox, Sent, Threads, Docs)
- **Smart Inbox**: auto-triages messages into "Needs Your Input" (question/action types), "Urgent", and "Everything Else" collapsible sections
- **Thread Conversation View**: clicking a thread shows chronological chat timeline with agent avatars (using `getAgentColor` as className), inline reply bar with optimistic updates, auto-scroll to bottom
- **Markdown Rendering**: message bodies and shared docs render markdown via `react-markdown` (bold, code, links, lists, blockquotes) — no innerHTML, XSS-safe by design
- **Reply Flow**: messages with `thread_id` navigate to thread conversation; non-threaded messages open compose modal with prefilled To/Subject
- **Real-time SSE**: `MESSAGE_CREATED`, `POLICY_UPDATED`, `TASK_ASSIGNED`, `TASK_COMPLETED` events broadcast instantly via `/api/stream`; 15s polling as fallback. SDK `events()` method provides SSE client for agents.
- **Keyboard Navigation**: `j`/`k` navigate list, `r` reply, `e` archive, `Enter` open thread, `Esc` close detail panel (hint bar on desktop)
- **Compose Modal**: supports `prefill` prop for reply pre-population (to, subject, type, thread_id)
- Component architecture: page.js is ~250-line orchestrator importing 10 sub-components from `_components/` folder
- Demo mode: conversation view works, reply bar disabled with tooltip, smart inbox works
- Respects global agent filter across all fetches

## Agent Workspace Page (Implemented)
- Route: `/workspace` - single tabbed interface for agent operational state
- 6 tabs: Overview (Digest), Context (Points + Threads), Handoffs, Snippets, Preferences, Memory
- No backend changes - consumes existing DashClaw API routes
- **Overview**: Daily digest with date picker, 7-stat grid (actions, decisions, lessons, content, ideas, interactions, goals), per-category item lists, quick links to Messages/Security
- **Context**: Two-column layout - key points with category badges + importance pills (add form), threads with expandable entries (create form)
- **Handoffs**: Timeline cards with expandable sections for key decisions, open tasks, next priorities, mood notes; JSON TEXT fields parsed with `safeParseJson()`
- **Snippets**: Search (300ms debounce) + language filter dropdown, code blocks with copy/use buttons, optimistic use_count increment
- **Preferences**: 2x2 summary grid with drill-down views for observations, preferences (confidence ProgressBar), moods (energy ProgressBar), approaches (success/fail ratios)
- **Memory**: Health score hero (color-coded >=80 green, 50-79 yellow, <50 red), 8-metric grid (StatCompact), entities + topics two-column; "Org-wide" badge when agent filter active
- Respects global agent filter, lazy tab loading, manual refresh button
- Sidebar: FolderKanban icon in Operations group (after Messages)
- Middleware matcher includes `/workspace` and `/workspace/:path*`

## Deployment

### Vercel (Production)
- **URL**: http://localhost:3000
- **Project**: `ucsandmans-projects/dash-claw`
- **GitHub**: Connected - auto-deploys on push to `main`
- **Region**: Washington, D.C. (iad1)

### Vercel Environment Variables
| Variable | Environment | Sensitive |
|---|---|---|
| `DATABASE_URL` | Production | Yes |
| `DASHCLAW_API_KEY` | Production | Yes |
| `ALLOWED_ORIGIN` | Production | No |
| `NEXTAUTH_URL` | Production | No |
| `NEXTAUTH_SECRET` | Production | Yes |
| `GITHUB_ID` | Production | Yes |
| `GITHUB_SECRET` | Production | Yes |
| `GOOGLE_ID` | Production | Yes |
| `GOOGLE_SECRET` | Production | Yes |
| `RESEND_API_KEY` | Production (optional) | Yes |
| `CRON_SECRET` | Production | Yes |
| `ENCRYPTION_KEY` | Production | Yes |
| `ENFORCE_AGENT_SIGNATURES` | Production (default: true in prod) | No |
| `DASHCLAW_CLOSED_ENROLLMENT` | Production (optional) | No |
| `TRUST_PROXY` | Production (optional) | No |
| `DASHCLAW_GUARD_FALLBACK` | Production (optional) | No |

### Deploy Commands
```bash
vercel deploy --prod --yes   # Manual deploy
git push origin main         # Auto-deploy via GitHub integration
```

### Agent SDK Integration
Agents connect to the deployed API - they only need the base URL and an API key:
```js
const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  agentName: 'My Agent',
});
```
Agents do NOT need `DATABASE_URL` - the API handles the database connection server-side.

### DashClaw SDK (npm package - 96+ methods across 22+ categories)

The SDK is published as `dashclaw` on npm. Class name is `DashClaw` (backward-compat alias `OpenClawAgent`).

```bash
npm install dashclaw
```

### DashClaw Python SDK (v1.0.0 - Zero Dependencies)

A native Python implementation of the DashClaw toolkit. Supports both synchronous and context-manager based tracking.

```bash
# From the sdk-python directory
pip install .
```

```python
from dashclaw import DashClaw

claw = DashClaw(
    base_url='http://localhost:3000',
    api_key=os.environ['DASHCLAW_API_KEY'],
    agent_id='my-python-agent'
)

# Use as a context manager for automatic action recording
with claw.track(action_type='build', declared_goal='Initialize project'):
    # Your agent logic here
    print("Agent is working...")
```

```javascript
import { DashClaw } from 'dashclaw';
// or: import { OpenClawAgent } from 'dashclaw';  // backward compat

const claw = new DashClaw({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  agentName: 'My Agent',
});
```

**Action Recording (10)**: `createAction()`, `waitForApproval()`, `updateOutcome()`, `getActions()`, `getAction()`, `getActionTrace()`, `track()`, `heartbeat()`, `startHeartbeat()`, `stopHeartbeat()`

**Loops & Assumptions (7)**: `registerOpenLoop()`, `resolveOpenLoop()`, `getOpenLoops()`, `registerAssumption()`, `getAssumption()`, `validateAssumption()`, `getDriftReport()`

**Signals (1)**: `getSignals()`

**Dashboard Data (9)**: `reportTokenUsage()`, `recordDecision()`, `createGoal()`, `recordContent()`, `recordInteraction()`, `reportConnections()`, `createCalendarEvent()`, `recordIdea()`, `reportMemoryHealth()`

**Session Handoffs (3)**: `createHandoff()`, `getHandoffs()`, `getLatestHandoff()`

**Context Manager (7)**: `captureKeyPoint()`, `getKeyPoints()`, `createThread()`, `addThreadEntry()`, `closeThread()`, `getThreads()`, `getContextSummary()`

**Automation Snippets (4)**: `saveSnippet()`, `getSnippets()`, `useSnippet()`, `deleteSnippet()`

**User Preferences (6)**: `logObservation()`, `setPreference()`, `logMood()`, `trackApproach()`, `getPreferenceSummary()`, `getApproaches()`

**Daily Digest (1)**: `getDailyDigest()`

**Security Scanning (2)**: `scanContent()`, `reportSecurityFinding()`

**Agent Messaging (9)**: `sendMessage()`, `getInbox()`, `markRead()`, `archiveMessages()`, `broadcast()`, `createMessageThread()`, `getMessageThreads()`, `resolveMessageThread()`, `saveSharedDoc()`

**Behavior Guard (2)**: `guard()`, `getGuardDecisions()` - `guardMode` constructor option enables auto guard check before `createAction()`/`track()`

**Bulk Sync (1)**: `syncState()`

**Policy Testing (3)**: `testPolicies()`, `getComplianceProof()`, `importPolicyPack()`

**Compliance Engine (5)**: `getComplianceMap()`, `getComplianceGaps()`, `getComplianceReport()`, `getComplianceFrameworks()`, `getComplianceEvidence()`

**Task Routing (10)**: `listRoutingAgents()`, `registerRoutingAgent()`, `getRoutingAgent()`, `updateRoutingAgent()`, `deleteRoutingAgent()`, `listRoutingTasks()`, `submitRoutingTask()`, `completeRoutingTask()`, `getRoutingStats()`, `getRoutingHealth()`

**Agent Pairing (3)**: `createPairing()`, `createPairingFromPrivateJwk()`, `waitForPairing()`

**Identity Binding (2)**: `registerIdentity()`, `getIdentities()`

**Organization Management (5)**: `getOrg()`, `createOrg()`, `getOrgById()`, `updateOrg()`, `getOrgKeys()`

**Activity Logs (1)**: `getActivityLogs()`

**Webhooks (5)**: `getWebhooks()`, `createWebhook()`, `deleteWebhook()`, `testWebhook()`, `getWebhookDeliveries()`

**Error Classes**: `GuardBlockedError` - thrown when `guardMode: 'enforce'` and guard blocks an action

**Cost Analytics**: `reportTokenUsage()` - real-time financial tracking and cost accountability on the dashboard. TokenBudgetCard includes a "24h Projected" cost line that blends today's burn trajectory with historical daily average.

## Agent Bootstrap System

See [`docs/agent-bootstrap.md`](docs/agent-bootstrap.md) for full details on the 3-part hybrid bootstrap system:
- **CLI Scanner** (`scripts/bootstrap-agent.mjs`) — mechanically scans agent workspace, pushes structured data
- **Self-Discovery Prompt** (`scripts/bootstrap-prompt.md`) — paste to agent, it scans its own workspace + self-reports semantic data + pushes via `syncState()` autonomously
- **Bulk Sync API** (`POST /api/sync`) — single endpoint for all data categories in one request

**Recommended workflow**: Run the scanner first (handles files, connections, snippets, capabilities), then paste the prompt (handles relationships, reasoning, observations, communication style).

The CLI scanner covers all 13 sync categories: `connections`, `memory`, `goals`, `learning`, `content`, `context_points`, `context_threads`, `snippets`, `relationships`, `capabilities`, `handoffs` (from daily logs), `inspiration` (from idea/bookmark files), and `preferences` (including `observations`, `moods`, and `approaches` sub-categories).
