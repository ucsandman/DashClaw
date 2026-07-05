# Quick Start Guide (v2 Governance Runtime)

DashClaw is a governance runtime for AI agents. This guide will get you from zero to your first **governed agent action** in under 8 minutes.

## ⚡ The 1-Minute Governance Test (Fastest Path)

The absolute fastest way to see DashClaw in action with **zero configuration** (the one prerequisite: Docker running — it pulls and runs the demo image):

```bash
npx dashclaw-demo
```

**What happens?**
1. A local DashClaw demo runtime starts automatically.
2. An example agent attempts a high-risk deployment action.
3. DashClaw **intercepts** and **blocks** it — the demo agent runs the SDK loop, so it consults guard before acting and stops on the `block` decision. (On hook surfaces like Claude Code the halt is mechanical; the per-surface table is [`docs/architecture/enforcement-boundary.md`](docs/architecture/enforcement-boundary.md).)
4. Your browser will open directly to the Decision Replay.

---

## 🚀 The 3-Minute Hosted Trial (no deploy)

The public trial instance is **[hosted.dashclaw.io](https://hosted.dashclaw.io)** — the installer uses it by default. You don't need to clone or deploy anything:

```bash
npm i -g @dashclaw/cli
dashclaw install claude --trial
```

1. The installer opens the trial's `/connect` page in your browser (your own hosted instance instead? re-run with `--endpoint <url>`) — complete the signup check and copy the API key it issues. The mint also signs your browser in to the trial's dashboard: Mission Control and the decisions ledger are one click away, and you can come back to them anytime until the trial ends (the API key is shown once; your dashboard is not). Want proof before wiring anything? The same page lets you **send your first governed action straight from the browser** — no install — and watch the decision land in your ledger.
2. Paste the API key into the installer prompt. It preflights the instance, wires the Claude Code hooks (observe mode — decisions logged, nothing blocked), and prints next steps. Lost the key? Mint a new one from the dashboard's API keys page.
3. Trial workspaces start with the `claude-code-starter` policy pack **pre-seeded**, so your next Claude Code session is governed from the first tool call. After a governed turn you'll see the recap line, and `dashclaw cost` shows the session's spend.

Self-hosting instead? Continue below.

---

## Step 1: Deploy DashClaw

### Option A: Local (one command)

```bash
npx dashclaw up
```

Everything is interactive-with-defaults: it installs the app to `~/.dashclaw`, provisions Postgres
(Docker if you have it, embedded Postgres otherwise — no accounts, no extra installs), generates
secrets, mints your API key, applies migrations, starts the server at http://localhost:3000, and
offers to wire Claude Code hooks so your next session is governed. Re-run `npx dashclaw up` any
time to start it again; `npx dashclaw down` stops it; `npx dashclaw up --update` upgrades.

<details><summary>Working from a clone instead (contributors)</summary>

```bash
git clone https://github.com/ucsandman/DashClaw.git && cd DashClaw
npm install && npm run setup && npm run dev
```

</details>

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

Once connected, your agent appears in the [Agent Registry](http://localhost:3000/agents/registry) — the fleet-wide identity ledger. From there, grant it scoped permissions from the capability templates at [`/capabilities`](http://localhost:3000/capabilities) to declare what it is allowed to do.

### The Governance Loop (with optional human review):
1. **Guard** &rarr; `claw.guard()` checks intent against policy. Your code
   aborts on `block` — on the SDK path the decision is advisory and this
   `if` is the enforcement, so don't skip it. Attach the actual act
   (`act: { kind: 'shell', command }` — or `http` / `sql` / `file`) and the
   server classifies from evidence instead of trusting your declaration.
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

> **Work Orders** turn an agent call into a task-grade contract: typed input/output schema, a budget
> ceiling, and a self-verifying receipt. Submit an order against a registered type (`claw.submitWorkOrder`),
> let any worker `claim` and `complete` it, and get back a SHA-256 receipt with cost, output hash, and the
> governance trail. DashClaw stays the control plane — execution is external workers via `claim`/`complete`.
> Page at [`/work-orders`](http://localhost:3000/work-orders); ~75-line reference worker in
> [`examples/work-order-worker/`](./examples/work-order-worker/).

---

## Essential Docs for Developers
- **Node SDK Reference**: [`sdk/README.md`](./sdk/README.md)
- **Python SDK Reference**: [`sdk-python/README.md`](./sdk-python/README.md)
- **Minimal Runtime API**: [`docs/architecture/runtime-api.md`](./docs/architecture/runtime-api.md)
- **API Inventory**: [`docs/api-inventory.md`](./docs/api-inventory.md)
- **Durable Execution Finality**: [`docs/architecture/durable-execution-finality.md`](./docs/architecture/durable-execution-finality.md)

## Category Enforcement
DashClaw is infrastructure, not a platform. To prevent "platform creep," we enforce a strict **Governance Boundary** in CI. All new API routes must live in `app/api/_archive/` unless they are core governance primitives.
