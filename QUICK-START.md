# Quick Start

DashClaw gives unattended agents policy checks and remote human approvals. Installed runtime hooks enforce decisions before supported tool calls; SDK integrations govern only the callbacks your code passes through them. This guide gets you to your first **governed agent action**.

New to the concepts (guard, actions, approvals, outcomes)? Skim [docs/concepts.md](./docs/concepts.md) first — five minutes, and every step below will make sense.

## Pick your door

| You want | Door | Time |
|---|---|---|
| Try the operator workflow | **A. Hosted trial** — create a workspace in the browser | ~3 min |
| A self-contained local demo | **B. `npx dashclaw-demo`** (needs Docker) | ~1 min |
| Your own instance, governing your own agents | **C. Deploy** — local one-command or Vercel + Neon | ~8 min |

Start with **C1** for your own local instance. To explore the screens without connecting an agent, use the [interactive demo](https://www.dashclaw.io/demo). Demo records do not prove enforcement on your machine.

## Upgrade order for existing installations

The current Node `runGoverned` and Python `run_governed` helpers require execution claim protocol 1. Deploy the matching server and schema before upgrading those clients. They stop before the callback if the protocol is unavailable or a claim is uncertain.

Hooks and OpenClaw preserve the earlier guard/approval flow when an older server advertises neither claim field. That path has no atomic claim guarantee. Partial, malformed, or unsupported advertisements fail closed. After the server upgrade, `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` makes claim support mandatory for those runtimes too.

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

The installer opens the trial's `/connect` page, takes the API key you minted, preflights the instance, and wires the Claude Code hooks in **enforce mode** by default (pass `--observe` to log without holding). Trial workspaces come with the `claude-code-starter` policy pack pre-seeded, so your next Claude Code session is governed from the first tool call. When a risky action is held, it lands in your Approvals inbox at `/approvals` and the paused tool call resumes the moment you approve. Full guide: [docs/integrations/claude-code.md](./docs/integrations/claude-code.md).

## Door B: the 1-minute local demo

```bash
npx dashclaw-demo
```

Requires Docker running and port 3000 free. It pulls the demo image, starts a local DashClaw in demo mode, and runs an example agent that tries to purge customer records from a production database. The demo simulates the guard's `block` decision locally (demo mode has no live policies), records the blocked action, and prints a `REPLAY_URL=` line: open it to see the Decision Replay. (On hook surfaces like Claude Code the halt is mechanical; the per-surface table is [docs/architecture/enforcement-boundary.md](./docs/architecture/enforcement-boundary.md).)

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

### C2. Cloud (Vercel + Neon)

1. Use the one-click deploy button in [`README.md`](./README.md#quick-start) (or fork and connect the repo yourself). Provider pricing and limits apply.
2. Add the [Neon Postgres](https://neon.tech) integration when Vercel prompts.
3. Set the required env vars — the full annotated list is [`.env.example`](./.env.example). The required set:
   - `DATABASE_URL` (auto-populated when you add Neon)
   - `DASHCLAW_API_KEY` (any `oc_live_...` string you generate; wired to `org_default`)
   - `ENCRYPTION_KEY` (32 random chars: `openssl rand -hex 16`)
   - `NEXTAUTH_SECRET` (`openssl rand -base64 32`)
   - `NEXTAUTH_URL` (your deployed URL)
   - `CRON_SECRET` (`openssl rand -hex 32`)
   - `DASHCLAW_LOCAL_ADMIN_PASSWORD` (so you can sign in without configuring OAuth first)

The schema migration runs as part of the build (`scripts/auto-migrate.mjs`). Back up an existing database before upgrading. Checksum or schema errors must be resolved before serving the release. The no-OAuth path in detail: [docs/deploy-without-oauth.md](./docs/deploy-without-oauth.md).

### C3. Verify the instance

Open `/setup` on your instance to verify the database connection and environment. Then install your runtime integration from `/connect` and check its enforcement. Green server checks do not prove a hook is installed or holding actions. The liveness card shows reported probe results and freshness, not independent machine attestation. For failures, use [docs/troubleshooting.md](./docs/troubleshooting.md).

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

The starter uses `runGoverned`: policy check, action record, approval when required, execution claim, simulation callback, and outcome report. It performs no real deployment. Without an OpenAI key, it makes no model call. Open `/decisions` to inspect the recorded evidence, or `/approvals` if your policy holds the simulation.

### See the approval gate fire

A fresh self-hosted instance seeds the **catastrophe-only** pack. It holds classified protected-target destruction, real-money spend, force pushes, and secret-file writes. A high risk score or ordinary project deletion alone is not a protected-target event. For a harmless approval demonstration, configure a temporary Short List rule for the starter simulation in `/policies`, run it, and choose **Allow** or **Deny** at `/approvals`. Do not use real destructive operations or secret-file writes just to trigger a hold. Broader packs are available in `/policies/packs`; review their installed tier before expecting them to interrupt.

### Connect your own agent

Open `/connect` on your instance — the golden path for any real agent (OpenAI, LangChain, CrewAI, custom). Once connected, its governed actions land in the decisions ledger at `/decisions`, and anything held waits for you in the Approvals inbox at `/approvals`.

Prefer Node `runGoverned(act, params, callback)` or Python `run_governed`. Keep the external effect inside the callback and describe that same effect in `act`. The helper cannot stop code outside it or a client that lies about its act. Manual integrations must implement the complete lifecycle:

1. **Guard** → `claw.guard()` checks intent against policy. Your code aborts on `block` — on the SDK path the decision is advisory and this `if` **is** the enforcement, so don't skip it. Attach the actual act (`act: { kind: 'shell', command }` — or `http` / `sql` / `file`) and the server classifies from evidence instead of trusting your declaration.
2. **Record** → `claw.createAction()` logs the start. The server re-evaluates here and may gate with `action.status === 'pending_approval'`.
3. **Wait (if held)** → `claw.waitForApproval(action_id)` — using **the `action_id` from step 2**, never the id from step 1.
4. **Claim** → `claw.claimExecution(action_id, act)` requests one execution attempt bound to the action, credential principal, agent, exact act, and fresh policy evaluation. Operator and plan authority is consumed here. Stop if the claim is rejected or its response is uncertain.
5. **Execute** → run the actual effect only after a confirmed successful claim. `recordAssumption()` can record a reasoning basis; it does not verify the external effect.
6. **Report** → `reportActionSuccess` / `reportActionFailure` records the reported result. Terminal records are one-shot, but external effects are not exactly once. If a claim or outcome acknowledgement is lost, reconcile the target system and DashClaw record before retrying. Do not infer that execution failed from a missing outcome: [durable finality](./docs/architecture/durable-execution-finality.md).

Full instrumentation guide with the working code: [docs/agent-bootstrap.md](./docs/agent-bootstrap.md). Canonical HITL flow including the action-id pitfall: [`sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow](./sdk/README.md#human-in-the-loop-hitl-approval-flow).

---

## Where to next

- **The full docs index:** [docs/README.md](./docs/README.md)
- **Operate DashClaw** (policies, approvals, the emergency halt): [docs/operations.md](./docs/operations.md)
- **SDK references:** [`sdk/README.md`](./sdk/README.md) · [`sdk-python/README.md`](./sdk-python/README.md)
- **The minimal HTTP contract:** [docs/architecture/runtime-api.md](./docs/architecture/runtime-api.md)

## A note on scope

DashClaw is a fail-closed approval layer for unattended agent runs, not an agent platform. The core API surface stays governance-only: anything off the intercept → decide → approve → prove loop, or not directly supporting it, is out of scope by definition (see [`THESIS.md`](./THESIS.md)). If you're contributing, new routes must be governance primitives — see [CONTRIBUTING.md](./CONTRIBUTING.md).
