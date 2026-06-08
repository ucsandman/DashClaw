# DashClaw Architecture

## What DashClaw Is

Decision infrastructure / policy firewall for AI agents. Sits between agents and external systems to:
- Intercept risky agent actions before execution
- Enforce governance policies
- Require human approval for sensitive operations
- Record verifiable evidence of every decision

**Not** an observability tool. **Not** an agent platform. It's the control plane for governance.

## 3-Tier Architecture

### Tier 1: Core Runtime (`app/api/`)
7 mandatory API endpoints defining DashClaw's governance category:
- Guard, Actions, Approvals, Assumptions, Signals, Policies, Health

**The 7-route boundary is CI-enforced.** No new core routes without justification.

### Tier 2: Extensions (`app/(extensions)/`)
Modular operational intelligence (not required for core governance):
- Compliance, Drift, Evaluations, Scoring, Prompts, Webhooks, Learning

### Tier 3: Archived (`app/api/_archive/`)
Legacy features from the "Agent Platform" era:
- Messaging, CRM, Workspace, Memory Health
- Physically isolated from runtime

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ |
| Framework | Next.js 15 (App Router) |
| Database | Postgres (Neon recommended) |
| ORM | Drizzle ORM |
| Auth | NextAuth.js v4 (GitHub, Google, OIDC) |
| UI | React 18, Tailwind CSS 3, Lucide Icons |
| Charts | Recharts, D3 |
| Testing | Vitest + jsdom |
| Linting | ESLint |
| Package Manager | npm |
| Billing | Stripe (optional) |
| Email | Resend (alerts) |
| Real-time | In-memory event bus or Redis pub/sub |

## Data Flow: The Governance Loop

```
Agent → POST /api/guard (policy check)
  ↓
  decision: allow/warn/block/require_approval
  ↓
Agent → POST /api/actions (record intent)
  ↓
Agent → POST /api/assumptions (record beliefs)
  ↓
Agent executes the action
  ↓
Agent → PATCH /api/actions/:id (record outcome)
  ↓
DashClaw → Signal computation (cron, every 5 min)
  ↓
Dashboard → Mission Control (live decision feed)
```

## Database Schema (Key Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organizations` | Multi-tenant orgs | plan, stripe_id |
| `users` | User accounts per org | email, role |
| `api_keys` | API key management | key_hash, org_id, permissions |
| `action_records` | Action lifecycle | action_id (ar_*), action_type, risk_score, status, agent_id, declared_goal, reversible, timestamp_start/end, approved_by |
| `assumptions` | Reasoning basis | assumption_id, action_id, assumption, validated, source |
| `guard_policies` | Guard rules | name, type, mode, conditions, action, agent_id |
| `guard_decisions` | Guard history | decision, risk_score, matched_policies |
| `open_loops` | Unresolved deps | type, status, priority, description |
| `webhooks` | Event subscriptions | url, events, org_id |
| `agent_presence` | Heartbeat tracking | agent_id, last_seen, status |
| `compliance_evidence` | Audit trail | framework, evidence_type |
| `drift_signals` | Behavioral anomalies | metric, z_score, severity |
| `evaluations` | LLM-judge scoring | scorer_id, score, label |
| `learning_episodes` | Agent improvement | action_type, success, score |

**ID convention:** All primary keys are TEXT with crypto-random prefixed values (e.g., `ar_` for actions, `oc_live_` for API keys).

## Auth Chain

```
1. Strip x-org-id, x-org-role, x-user-id (always — client cannot set these)
2. Rate limit check (100 req/min prod, 1000 req/min dev)
3. Route matching:
   - PUBLIC_ROUTES (health, setup, auth, cron, docs): pass through
   - Protected routes:
     a. x-api-key header → timing-safe compare (fast path)
     b. Fallback → hash lookup in api_keys table
     c. NextAuth session (same-origin browser requests)
4. Org context injection from resolved API key
```

## Infrastructure Routes

- `POST /api/cron/signals` — Signal detection + notification (every 5 min)
- `GET /api/integrations/health` — Credential validation (every 6 hours)

## Deployment Models

### Local Development
```bash
npm install && node scripts/setup.mjs && npm run dev
```

### Cloud (Vercel + Neon)
Fork → Deploy to Vercel → Connect Neon Postgres → Run setup

### Demo Mode
```bash
npx dashclaw-demo
```
Read-only with fixture data.

## Key Directories

```
app/
├── api/                    ← 7 core routes + extensions
├── lib/                    ← Shared services
│   ├── guard.js            ← Risk scoring engine
│   ├── signals.js          ← 8-type anomaly detection
│   ├── db.js               ← Postgres connection
│   ├── validate.js         ← Input validation
│   ├── org.js              ← Multi-tenant scoping
│   ├── auth.js             ← API key validation
│   ├── embeddings.js       ← Vector storage
│   ├── llm.js              ← LLM-as-judge
│   ├── security.js         ← Sensitive data scanning
│   ├── promptInjection.js  ← Injection detection
│   ├── webhooks.js         ← Event delivery
│   ├── compliance/         ← SOC 2 evidence
│   ├── drift.js            ← Behavioral deviation
│   ├── eval.js             ← Scoring
│   ├── learning-loop.js    ← Agent improvement
│   ├── prompt.js           ← Prompt version control
│   └── repositories/       ← Data access layer
├── components/             ← React UI
├── mission-control/        ← Live decision dashboard
├── decisions/              ← Visual causal chain ledger
├── policies/               ← Guard policy editor
├── compliance/             ← Audit evidence viewer
├── drift/                  ← Drift detection UI
└── setup/                  ← Instance readiness

sdk/
├── dashclaw.js             ← V2 SDK (80 methods, zero deps)
└── legacy/
    └── dashclaw-v1.js      ← V1 SDK (187 methods)

cli/
├── bin/dashclaw.js         ← CLI entry point
└── lib/render.js           ← ANSI rendering

schema/
└── schema.js               ← Drizzle ORM schema
```

## Architectural Guardrails

1. **No direct SQL in route handlers** — Use repository modules (CI-enforced)
2. **Real-time first** — SSE via `/api/stream`
3. **Default-deny** — New endpoints are protected by default
4. **Org context injection** — Never from clients, always from API key
5. **Two separate thread systems** — Context threads vs message threads
6. **Zero-LLM by default** — Only `llm_judge` scorer requires an LLM key
7. **TEXT PKs** — Crypto-random prefixed IDs, never auto-increment
