# Quick Start

DashClaw is a governance runtime for AI agents: policy before action, human approval where required, replayable evidence always. This guide gets you from zero to your first **governed agent action**.

New to the concepts (guard, actions, approvals, outcomes)? Skim [docs/concepts.md](./docs/concepts.md) first — five minutes, and every step below will make sense.

## Pick your door

| You want | Door | Time |
|---|---|---|
| Proof, zero install | **A. Hosted trial** — mint a workspace in the browser | ~3 min |
| A self-contained local demo | **B. `npx dashclaw-demo`** (needs Docker) | ~1 min |
| Your own instance, governing your own agents | **C. Deploy** — local one-command or Vercel + Neon | ~8 min |

If you're unsure: take door **A**, watch a governed action land, then come back for door C when you want your own instance.

---

## Door A: the hosted trial (no deploy, no clone)

The public trial instance is [hosted.dashclaw.io](https://hosted.dashclaw.io).

**Browser only:** open [hosted.dashclaw.io/connect](https://hosted.dashclaw.io/connect), complete the signup check, and send your first governed action straight from the page — no install — then watch the decision land in your ledger. The mint also signs your browser in to the trial dashboard: the Approvals inbox and the decisions ledger are one click away until the trial ends. The API key is shown once; copy it.

The record is yours to keep: **Export workspace** on the same card downloads your governance record (policies, decisions, action history), and `dashclaw import <file>` loads it into a self-hosted instance later — the trial cap is a door, not a wall.

**Governing Claude Code with it:**

```bash
npm i -g @dashclaw/cli
dashclaw install claude --trial
```

The installer opens the trial's `/connect` page, takes the API key you minted, preflights the instance, and wires the Claude Code hooks in **observe mode** (decisions logged, nothing blocked). Trial workspaces come with the `claude-code-starter` policy pack pre-seeded, so your next Claude Code session is governed from the first tool call. When a risky action is held, it lands in your Approvals inbox at `/approvals`. Full guide: [docs/integrations/claude-code.md](./docs/integrations/claude-code.md).

## Door B: the 1-minute local demo

```bash
npx dashclaw-demo
```

Requires Docker running. It pulls the demo image, starts a local DashClaw, has an example agent attempt a high-risk deployment, and DashClaw blocks it — the demo agent runs the SDK loop, so it consults guard before acting and stops on the `block` decision. Your browser opens directly to the Decision Replay. (On hook surfaces like Claude Code the halt is mechanical; the per-surface table is [docs/architecture/enforcement-boundary.md](./docs/architecture/enforcement-boundary.md).)

## Door C: deploy your own instance

### C1. Local, one command

```bash
npx dashclaw up
```

Interactive with defaults: installs the app to `~/.dashclaw`, provisions Postgres (Docker if you have it, embedded otherwise — no accounts, no extra installs), generates secrets, mints your API key, applies migrations, starts on http://localhost:3000, and offers to wire Claude Code hooks. Re-run any time to start it again; `npx dashclaw down` stops it; `npx dashclaw up --update` upgrades.

<details><summary>Working from a clone instead (contributors)</summary>

```bash
git clone https://github.com/ucsandman/DashClaw.git && cd DashClaw
npm install && npm run setup && npm run dev
```

</details>

### C2. Cloud (Vercel + Neon, $0 to deploy)

1. Use the one-click deploy button in [`README.md`](./README.md#deploy) (or fork and connect the repo yourself).
2. Add the [Neon Postgres](https://neon.tech) integration when Vercel prompts.
3. Set the required env vars — the full annotated list is [`.env.example`](./.env.example). The required set:
   - `DATABASE_URL` (auto-populated when you add Neon)
   - `DASHCLAW_API_KEY` (any `oc_live_...` string you generate; wired to `org_default`)
   - `ENCRYPTION_KEY` (32 random chars: `openssl rand -hex 16`)
   - `NEXTAUTH_SECRET` (`openssl rand -base64 32`)
   - `NEXTAUTH_URL` (your deployed URL)
   - `CRON_SECRET` (`openssl rand -hex 32`)
   - `DASHCLAW_LOCAL_ADMIN_PASSWORD` (so you can sign in without configuring OAuth first)

The schema migration runs as part of the build (`scripts/auto-migrate.mjs`) — no manual migration step. The no-OAuth path in detail: [docs/deploy-without-oauth.md](./docs/deploy-without-oauth.md).

### C3. Verify the instance

Open `/setup` on your instance. It verifies the database connection and environment. All green checks → you are ready to govern agents. (Anything red: [docs/troubleshooting.md](./docs/troubleshooting.md) — the most common failure is `503 SCHEMA_NOT_INITIALIZED`, fixed by one migrate command.)

---

## Your first governed action

### Run the starter agent

> This step needs the repo on disk (`npx dashclaw up` installs the app without the examples): `git clone https://github.com/ucsandman/DashClaw.git`. No clone handy? The `/connect` page on your instance sends a first governed action from the browser instead.

```bash
cd examples/openai-governed-agent
npm install
cp .env.example .env   # set DASHCLAW_API_KEY (from /api-keys on your instance); OPENAI_API_KEY optional
node index.js
```

The agent runs the full governance loop (`guard` → `createAction` → `recordAssumption` → outcome). Open the Approvals inbox at `/approvals` and watch the live decision stream, then click through to the Decision Replay to inspect the recorded evidence.

### See the approval gate fire

A fresh self-hosted instance starts with **no policies**, so `guard` returns `allow` by default. Import the `claude-code-starter` pack from `/policies` (or run `node scripts/seed-claude-code-starter.mjs`) to get the day-one baseline — its `require_approval` policies will hold the agent at the network/install steps until you approve at `/approvals`. `node scripts/seed-demo-capabilities.mjs` adds a deploy-gating demo policy on top.

### Connect your own agent

Open `/connect` on your instance — the golden path for any real agent (OpenAI, LangChain, CrewAI, custom). Once connected, its governed actions land in the decisions ledger at `/decisions`, and anything held waits for you in the Approvals inbox at `/approvals`.

The loop your code implements (Node shown; Python is the same shape in snake_case):

1. **Guard** → `claw.guard()` checks intent against policy. Your code aborts on `block` — on the SDK path the decision is advisory and this `if` **is** the enforcement, so don't skip it. Attach the actual act (`act: { kind: 'shell', command }` — or `http` / `sql` / `file`) and the server classifies from evidence instead of trusting your declaration.
2. **Record** → `claw.createAction()` logs the start. The server re-evaluates here and may gate with `action.status === 'pending_approval'`.
3. **Wait (if held)** → `claw.waitForApproval(action_id)` — using **the `action_id` from step 2**, never the id from step 1.
4. **Verify** → `claw.recordAssumption()` tracks reasoning basis.
5. **Outcome** → `claw.reportActionSuccess(action_id, …)` / `reportActionFailure(…)` — one-shot, retry-safe (`409` on double-terminate). Poll `getActionOutcome()` before any retry to avoid double-execution: [docs/architecture/durable-execution-finality.md](./docs/architecture/durable-execution-finality.md).

Full instrumentation guide with the working code: [docs/agent-bootstrap.md](./docs/agent-bootstrap.md). Canonical HITL flow including the action-id pitfall: [`sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow](./sdk/README.md#human-in-the-loop-hitl-approval-flow).

---

## Where to next

- **The full docs index:** [docs/README.md](./docs/README.md)
- **Operate DashClaw** (policies, approvals, the emergency halt): [docs/operations.md](./docs/operations.md)
- **SDK references:** [`sdk/README.md`](./sdk/README.md) · [`sdk-python/README.md`](./sdk-python/README.md)
- **The minimal HTTP contract:** [docs/architecture/runtime-api.md](./docs/architecture/runtime-api.md)

## A note on scope

DashClaw is a fail-closed approval layer for unattended agent runs, not an agent platform. The core API surface stays governance-only: anything off the intercept → decide → approve → prove loop, or not directly supporting it, is out of scope by definition (see [`THESIS.md`](./THESIS.md)). If you're contributing, new routes must be governance primitives — see [CONTRIBUTING.md](./CONTRIBUTING.md).
