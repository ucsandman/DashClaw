# DashClaw — Complete AI Context Document

> **Updated:** 2026-04-11
> **Purpose:** Give any AI model full context about the DashClaw platform in a single file.
> **Source of truth:** `PROJECT_DETAILS.md`, `README.md`, `sdk/README.md`, `docs/client-setup-guide.md`

---

## 1. What Is DashClaw?

DashClaw is an **AI agent decision infrastructure platform**. It serves as a governance and control plane for AI agent fleets, governing the lifecycle of agent decisions before they reach real-world systems.

DashClaw mirrors the lifecycle of a governed decision:
1. **Agent Intent** — The agent declares what it wants to do.
2. **Policy Evaluation** — DashClaw evaluates the intent against organizational policies.
3. **Decision Outcome** — The action is allowed, blocked, or requires human approval.
4. **Decision Evidence** — Verifiable proof of the governance process is recorded.

### Core Capabilities
- **Approvals** — Human-in-the-loop approval queue, active interventions, and live decision stream.
- **Decision Replay** — Visual causal chain visualization of single agent decisions.
- **Agent Governance Profile** — Dedicated dossiers for every agent (posture, active policies, permissions).
- **Behavior Guard** — Policy enforcement before agents act (allow / warn / block / require_approval).
- **Risk Signals** — Automatic detection of dangerous behavior patterns (autonomy spikes, failure loops).
- **Assumption Tracking** — Log what agents believe; validate or invalidate later to detect drift.
- **Compliance Mapping** — SOC 2, ISO 27001, GDPR, NIST AI RMF, IMDA Agentic.
- **Multi-tenancy** — Isolated organizations, each with their own API keys and data.

### Deployment Model
DashClaw ships as one codebase serving two roles via `DASHCLAW_MODE`:

| Mode | Value | Behavior |
|------|-------|----------|
| Marketing/demo site | `DASHCLAW_MODE=demo` | No login, API returns fixtures, simulations enabled, policy management enabled. |
| Self-hosted (default) | `DASHCLAW_MODE=self_host` | GitHub/Google OAuth + real Postgres DB |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Next.js 16 (App Router) |
| Language | JavaScript |
| Styling | Tailwind CSS 3 + dark-only design tokens |
| Database | PostgreSQL via Neon (`@neondatabase/serverless`) or TCP (`postgres`) |
| Auth (UI) | NextAuth v4 (GitHub + Google OAuth, JWT strategy) |
| Auth (agents) | `x-api-key` header (DashClaw API keys) |
| ORM | Drizzle ORM (schema management only; raw SQL for queries) |
| Icons | lucide-react (no emoji in UI) |
| Testing | Vitest + jsdom |
| CI | GitHub Actions |
| Deployment | Vercel |
| SDK (Node) | `dashclaw` npm package — zero deps |
| SDK (Python) | `dashclaw` pip package — zero deps |

---

## 3. Architecture Overview

DashClaw is organized into a lean governance runtime with modular extensions.

> **Note (accuracy):** The `(core)` / `(extensions)` / `(archive)` grouping below is a *conceptual* tiering, not the on-disk layout — the real `app/` directories are flat (`app/approvals`, `app/drift`, …), there are no Next.js route-group folders. In the UI, the "extensions" surfaces (drift, learning, routing, swarm, prompts) live under a collapsible sidebar group labeled **Labs**; there is no "AI Safety Research" section in the product.

```
app/
├── (core)/                    # Tier 1 — Governance Runtime UI
│   ├── decisions/             # Decisions Ledger & Replay (Visual causal chain)
│   ├── policies/              # Guard Policies — Full lifecycle (CRUD, simulation, testing)
│   ├── approvals/             # Human-in-the-loop approval queue
│   ├── audit-log/             # Permanent record of system/admin events
│   ├── activity/              # Real-time operational telemetry feed
│   ├── agents/                # Agent Fleet & Dossiers (Health and filtering)
│   ├── security/              # Risk Signals — Spikes, failure loops, alerts
│   ├── compliance/            # Evidence — Control mapping and reports
│   └── usage/                 # Token velocity and cost tracking
│
├── (extensions)/              # Tier 3 — Experimental (AI Safety Research)
│   ├── drift/                 # Behavioral Drift — Assumptions and reasoning tracking
│   ├── learning/              # Learning Loops — Performance analytics over time
│   ├── routing/               # Task Routing — Agent-to-agent delegation maps
│   ├── swarm/                 # Swarm Intel — Multi-agent communication maps
│   └── prompts/               # Prompt Management — Template versioning and stats
│
├── (archive)/                 # Tier 4 — Legacy Artifacts
│   ├── goals/                 # Replaced by Action Intent
│   ├── messages/              # Replaced by Activity Stream
│   └── workspace/             # Replaced by Activity Stream
│
├── api/                       # The Stable Runtime API (Decision Control Plane)
│   ├── guard/                 # POST /guard — "Can I do X?"
│   ├── actions/               # POST /actions — "I am attempting X."
│   ├── approvals/             # POST /approvals/:id — "Operator decision"
│   ├── assumptions/           # POST /assumptions — "I believe Z"
│   └── signals/               # GET /signals — "Risk indicators"
│
├── components/                # Shared UI Components
├── lib/                       # Core Business Logic & Repositories
└── hooks/                     # Shared React Hooks
```

### Key Invariants

1. **Approvals as Landing Page**: Post-login, users are always sent to `/approvals` for immediate operational posture.
2. **Decision Lineage Everywhere**: The product emphasizes the causal chain (Intent → Policy → Outcome) rather than isolated logs.
3. **Minimal Runtime API**: The entire platform maps to five idempotent primitives (Guard, Actions, Outcomes, Assumptions, Approvals).
4. **No direct SQL in route files.** All queries go in `app/lib/repositories/*.repository.js`.
5. **Org context headers** (`x-org-id`, `x-org-role`, `x-user-id`) are injected by middleware only — never accepted from clients.
6. **Default-deny** for all `/api/*` routes — only explicit `PUBLIC_ROUTES` skip auth.

---

## 4. Auth & Multi-Tenancy

### Auth Flow (Browser)
1. `/login` → GitHub or Google OAuth (or Admin Password)
2. OAuth callback → NextAuth JWT cookie
3. Redirect to `/approvals`
4. Every page route: `middleware.js` calls `getToken()` (Edge-compatible)
5. Session includes `user.role` (`admin` | `member`)

### Auth Flow (SDK / API Keys)
1. Agent sends `x-api-key: oc_live_xxx` header
2. Middleware resolves org:
   - Key matches `DASHCLAW_API_KEY` env → `org_default` (admin, fast path)
   - Otherwise → SHA-256 hash → `api_keys` table lookup
3. Middleware injects `x-org-id` and `x-org-role` headers
4. Every route calls `getOrgId(request)` from `app/lib/org.js`

### Role Capabilities

| Capability | Admin | Member |
|-----------|-------|--------|
| View all data | ✓ | ✓ |
| Use all APIs (SDK) | ✓ | ✓ |
| Generate/revoke API keys | ✓ | — |
| Invite team members | ✓ | — |
| Change roles | ✓ | — |
| Configure integrations | ✓ | — |
| Manage webhooks | ✓ | — |
| Manage policies | ✓ | — |

---

## 5. Decision Lifecycle (The Core Narrative)

The platform is designed around the lifecycle of an agent decision:

### 1. Intent (Action Records)
Agents use the SDK to record what they intend to do. This captures:
- `declared_goal` (Intent)
- `reasoning` (Causality)
- `action_type` (Capability)

### 2. Governance (Guard)
Before acting, agents call `claw.guard()`. DashClaw evaluates:
- **Posture**: Current system risk level.
- **Policies**: Static and dynamic guardrails.
- **Signals**: Live risk indicators (e.g., recent failure rate).

### 3. Outcome
The decision is finalized and recorded in the **Decisions Ledger**. 
Failed or blocked decisions are surfaced in **Approvals** for immediate operator intervention.

### 4. Evidence
Every step is preserved in the **Decision Replay** view, providing a cryptographically signed audit trail for compliance and debugging.

---

## 6. Key UI Components

- **Sidebar**: Tier-based navigation (Command, Governance, Evidence, Labs, System).
- **Activity Stream**: Unified real-time feed of all agent intents, guard decisions, and system events.
- **Causal Timeline**: The heart of Decision Replay; visualizes the path from intent to outcome.
- **Posture Indicator**: Standardized triple-state (Nominal, Elevated, Critical) fleet risk summary.
- **QuickStart**: Smart onboarding card with real-time progression and simulator bot.
- **Agent Dossier**: Detailed view of a single agent's identity and governance history.
- **Audit Log**: Immutable record of administrative actions and system changes.
- **Policy Suite**: Full lifecycle management: create, test, simulate, and generate proof.
- **Labs**: Experimental workspace for swarm intelligence, learning loops, and prompt tracking.
