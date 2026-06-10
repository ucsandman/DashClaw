# Quick Start Guide (v2 Governance Runtime)

DashClaw is a governance runtime for AI agents. This guide will get you from zero to your first **governed agent action** in under 8 minutes.

## ⚡ The 1-Minute Governance Test (Fastest Path)

The absolute fastest way to see DashClaw in action with **zero configuration**:

```bash
npx dashclaw-demo
```

**What happens?**
1. A local DashClaw demo runtime starts automatically.
2. An example agent attempts a high-risk deployment action.
3. DashClaw **intercepts** and **blocks** it.
4. Your browser will open directly to the Decision Replay.

---

## Step 1: Deploy DashClaw

### Option A: Local (full environment)

1. **Clone the repo**:
   ```bash
   git clone https://github.com/ucsandman/DashClaw.git
   cd DashClaw
   ```
2. **Run the setup**:
   ```bash
   npm install
   npm run setup
   ```
   `npm run setup` is interactive. It provisions a local DB if you don't already have one, generates `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`, mints a workspace API key into `.env.local`, and applies migrations.
3. **Start the server**:
   ```bash
   npm run dev
   ```

### Option B: Cloud (Vercel + Neon, $0 to deploy)

1. Fork this repository, or use the one-click deploy button in [`README.md`](./README.md#deploy).
2. Connect a [Neon Postgres](https://neon.tech) database when Vercel prompts for the integration.
3. Set the required env vars in the Vercel dashboard. See [`.env.example`](./.env.example) for the full annotated list. The required set is:
   - `DATABASE_URL` (auto-populated when you add Neon)
   - `DASHCLAW_API_KEY` (any `oc_live_...` string you generate; will be wired to `org_default`)
   - `ENCRYPTION_KEY` (32 random chars: `openssl rand -hex 16`)
   - `NEXTAUTH_SECRET` (32 random chars: `openssl rand -base64 32`)
   - `NEXTAUTH_URL` (your deployed URL, e.g. `https://my-dashclaw.vercel.app`)
   - `CRON_SECRET` (any 64 random hex chars: `openssl rand -hex 32`)
   - `DASHCLAW_LOCAL_ADMIN_PASSWORD` (so you can sign in without configuring OAuth first)

   The schema migration runs as part of the build (`scripts/auto-migrate.mjs`), so there is no manual migration step.

---

## Step 2: Verify the Instance
Open `http://localhost:3000/setup`. This page verifies your database connection and environment variables. Once you see all green checks, you are ready to govern agents.

---

## Step 3: Run the Starter Agent (The Aha! Moment)
Run the canonical starter to record a real governed action.

1. **Enter the example directory**:
   ```bash
   cd examples/openai-governed-agent
   ```
2. **Install and configure**:
   ```bash
   npm install
   cp .env.example .env
   ```
   Edit `.env` and set `DASHCLAW_API_KEY` to the key from your instance (found in `.env.local` after `npm run setup`, or generate a new one at `/api-keys`). `OPENAI_API_KEY` is optional; the agent falls back to a simulated deployment response when it is unset.
3. **Run it**:
   ```bash
   node index.js
   ```
**Result:** The agent runs the full 4-step governance loop (`guard` → `createAction` → `recordAssumption` → `updateOutcome`). Open [Mission Control](http://localhost:3000/mission-control) and watch the Operations Feed light up with the new action, then click through to the Decision Replay to inspect the recorded evidence.

> **See the approval gate fire:** A fresh self-hosted instance starts with no policies, so `guard` returns `allow` by default — import the `claude-code-starter` pack from [`/policies`](http://localhost:3000/policies) (or run `node scripts/seed-claude-code-starter.mjs`) to get the day-one baseline. Hosted trial workspaces come with that pack **pre-seeded** at provisioning. Either way, the pack's `require_approval` policies will hold the agent at the network/install steps until you approve at [`/approvals`](http://localhost:3000/approvals); `node scripts/seed-demo-capabilities.mjs` adds a deploy-gating demo policy on top.

---

## Step 4: Integrate Your Own Agent
Open `http://localhost:3000/connect`. This page provides the **Golden Path** for connecting any real agent (OpenAI, LangChain, CrewAI) using the v2 SDK.

### The Governance Loop (with optional human review):
1. **Guard** &rarr; `claw.guard()` checks intent against policy. Abort on `block`.
2. **Record** &rarr; `claw.createAction()` logs the start of the action. The
   server may gate it here with `action.status === 'pending_approval'`.
3. **Wait (optional)** &rarr; If the action is `pending_approval`, call
   `claw.waitForApproval(action_id)` using **the `action_id` from step 2**,
   not the one from step 1. This is where the mobile PWA queue, the CLI
   approval channel, and the dashboard approvals feed unblock your agent.
4. **Verify** &rarr; `claw.recordAssumption()` tracks reasoning basis.
5. **Outcome** &rarr; `claw.updateOutcome()` records the final evidence.

Full canonical HITL flow (including the `action_id` pitfall to avoid) is
documented in [`sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow](./sdk/README.md#human-in-the-loop-hitl-approval-flow).

> **Retry-safe outcomes (v2.13.3+):** For long-running or retried actions, prefer
> `claw.reportActionOutcome(action_id, { status: 'completed', summary })` over
> `claw.updateOutcome()`. The new `/api/actions/:id/outcome` endpoint is one-shot
> (409 on double-terminate), records `pending` / `completed` / `partial` / `failed` /
> `lost_confirmation`, and is the surface to poll with `getActionOutcome()` before
> a retry to avoid double-execution. Full spec:
> [`docs/architecture/durable-execution-finality.md`](./docs/architecture/durable-execution-finality.md).

---

## Essential Docs for Developers
- **Node SDK Reference**: [`sdk/README.md`](./sdk/README.md)
- **Python SDK Reference**: [`sdk-python/README.md`](./sdk-python/README.md)
- **Minimal Runtime API**: [`docs/architecture/runtime-api.md`](./docs/architecture/runtime-api.md)
- **API Inventory**: [`docs/api-inventory.md`](./docs/api-inventory.md)
- **Durable Execution Finality**: [`docs/architecture/durable-execution-finality.md`](./docs/architecture/durable-execution-finality.md)

## Category Enforcement
DashClaw is infrastructure, not a platform. To prevent "platform creep," we enforce a strict **Governance Boundary** in CI. All new API routes must live in `app/api/_archive/` unless they are core governance primitives.
