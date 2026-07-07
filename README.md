<div align="center">
  <img src="public/images/logo-circular.png" alt="DashClaw" width="220" />

  <h1>DashClaw</h1>

  <p><strong>When your AI coding agent tries something destructive, DashClaw catches it before it runs and asks you first, even when you are not at the keyboard.</strong></p>

  <p>
    DashClaw is a fail-closed approval layer that sits between an agent
    <em>deciding</em> to call a tool and the tool <em>actually running</em>.
    It intercepts the call, scores it against your policies, freezes anything
    dangerous for one-click human approval from anywhere, and writes a signed,
    replayable audit row. It is not a dashboard that records what an agent did;
    it is the thing that stops the agent mid-action.
  </p>

  <p><sub>Built for the developer running long, unattended coding-agent sessions: overnight runs, CI agents, background fleets, against a real repo and real infrastructure. Enforced at the hook seam in Claude Code, Codex, Hermes, and at the OpenClaw gateway; honored cooperatively by the Node/Python SDK, MCP, and REST.</sub></p>

  <p>
    <strong><a href="#deploy">Install the runtime →</a></strong> one command, no account on the path to your first caught action. The product thesis is <a href="THESIS.md">THESIS.md</a>.
  </p>

  <p><sub><strong>This project is maintained by an AI</strong> in public, under a human-held charter. <a href="MAINTAINER.md">MAINTAINER.md</a> holds the five invariants the maintainer cannot change; every decision is on the record in the <a href="docs/maintainer-log.md">maintainer log</a>.</sub></p>

  <p>
    <a href="#deploy"><img alt="Deploy" src="https://img.shields.io/badge/Deploy-npx%20dashclaw%20up-orange?style=flat-square" /></a>
    <a href="#the-loop"><img alt="The loop" src="https://img.shields.io/badge/Loop-intercept%20%E2%86%92%20decide%20%E2%86%92%20approve%20%E2%86%92%20prove-blue?style=flat-square" /></a>
    <a href="#choose-your-integration-path"><img alt="Connect an agent" src="https://img.shields.io/badge/Connect-MCP%20%7C%20SDK%20%7C%20Hooks-zinc?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://dashclaw.io"><img src="https://img.shields.io/badge/website-dashclaw.io-orange?style=flat-square" alt="Website" /></a>
    <a href="https://dashclaw.io/docs"><img src="https://img.shields.io/badge/docs-SDK%20%26%20API-blue?style=flat-square" alt="Docs" /></a>
    <a href="https://github.com/ucsandman/DashClaw/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
    <a href="https://www.npmjs.com/package/dashclaw"><img src="https://img.shields.io/npm/v/dashclaw?style=flat-square&color=orange" alt="npm" /></a>
    <a href="https://pypi.org/project/dashclaw/"><img src="https://img.shields.io/pypi/v/dashclaw?style=flat-square&color=orange" alt="PyPI" /></a>
  </p>

  <br />

  <img src="docs/media/governance-loop.gif" alt="The governance loop: an agent tries a tool call, guard evaluates policy and scores risk, a human approves, and a replayable decision record is written" width="780" />

  <p><sub>Intercept &rarr; decide &rarr; approve &rarr; prove.</sub></p>
</div>

<br />

## What DashClaw is

The whole product is one loop:

1. **Intercept** — a PreToolUse hook in Claude Code, Codex, or Hermes (plus `dashclaw_invoke` and the OpenClaw gateway) catches a tool call before it executes.
2. **Decide** — the guard engine risk-scores the call against your policies into the decision lattice `allow < warn < require_approval < block` (join = max; a block is absolute).
3. **Approve** — `require_approval` freezes the action and pages a human, who approves or denies with **one click, from anywhere** (the Approvals inbox, the CLI, a phone), and the grant is single-use and bound to the exact action.
4. **Prove** — every decision writes a durable, replayable, signed audit row (Ed25519 receipts, JWKS export), and a liveness probe keeps proving the governor is still enforcing.

**For whom.** A solo developer or small team running long, unattended autonomous coding-agent sessions against a real repo and real infrastructure. The person who kicks off a 1 to 6 hour run, cannot watch every tool call, and is one bad run away from an agent that force-pushes over main, wipes a directory, drops a table, or reads a secret.

**Honesty about the incumbent.** Claude Code and Codex already ship native permission prompts for the at-keyboard user, for free. DashClaw does not compete with those. The wedge is the job native prompts structurally cannot do because they require your presence: remote and async approval, one central policy across every runtime and session, a tamper-evident audit trail, calibrated interruptions, and a liveness probe that proves enforcement is still on.

Not observability (LangSmith and Langfuse record; DashClaw prevents). Not a marketplace, not an agent platform. The full product definition is [`THESIS.md`](THESIS.md).

## Enforcement boundary (stated plainly)

Enforcement is mechanically real where DashClaw sits in the seam between decide and execute: the Claude Code / Codex / Hermes hooks (fail-closed, exit-2 on block), the OpenClaw gateway, and `dashclaw_invoke`. Everywhere else (bare SDK / API / MCP callers, desktop chat) governance is cooperative: the caller consults guard and honors the decision, every call is still recorded, and a block is never downgraded in the ledger. We do not claim universal hard enforcement. The per-surface table is [`docs/architecture/enforcement-boundary.md`](./docs/architecture/enforcement-boundary.md).

---

## The loop

Four calls, from the SDK, the MCP server, a plugin, or plain REST. The hook seam runs them for you in Claude Code, Codex, and Hermes.

```javascript
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'nightly-agent',
});

// 1. Intercept + decide — attach the real act; the server classifies from
//    evidence, and evidence can only raise the risk, never lower it.
const g = await claw.guard({
  action_type: 'shell',
  act: { kind: 'shell', command: 'git push --force origin main' },
});

// 2. Open the decision record.
const action = await claw.createAction({
  action_type: 'shell',
  declared_goal: 'Force-push the rebased branch',
});

// 3. Freeze until a human resolves it, from anywhere.
if (g.decision === 'require_approval') {
  await claw.waitForApproval(action.action_id);
}

// 4. Close the record, one-shot and durable (retry-safe).
try {
  await run();
  await claw.reportActionSuccess(action.action_id, 'Pushed');
} catch (err) {
  await claw.reportActionFailure(action.action_id, err.message);
}
```

Python uses the same shape with `snake_case`. Full reference: [`sdk/README.md`](./sdk/README.md) (Node, camelCase), [`sdk-python/README.md`](./sdk-python/README.md) (Python, snake_case). Step-by-step: [`QUICK-START.md`](./QUICK-START.md).

---

## Choose your integration path

DashClaw meets agents where they already are. Every path lands on the same guard engine, the same decision ledger, and the same Approvals inbox.

| If your agent is… | Use this path | Install |
|---|---|---|
| Claude Code | Plugin + hooks (mechanical halt) | `npm i -g @dashclaw/cli && dashclaw install claude` |
| Codex | Plugin (mechanical halt) | `dashclaw install codex --project <path>` |
| Hermes Agent | Plugin (mechanical halt) | `bash scripts/install-hermes-plugin.sh` |
| OpenClaw | OpenClaw plugin (mechanical halt) | `npm install @dashclaw/openclaw-plugin` |
| Claude Desktop (chat, web) | Custom connector (OAuth, no install) | Settings → Connectors → paste `https://<instance>/api/mcp` |
| Any stdio MCP host | MCP server (stdio) | `npx @dashclaw/mcp-server` |
| Claude Managed Agents | MCP server (Streamable HTTP) | Point at `/api/mcp` |
| LangChain / CrewAI / AutoGen | Python SDK integration | `pip install dashclaw` |
| LangGraph / OpenAI Agents SDK | Node or Python SDK | `npm install dashclaw` |
| Custom / framework-less | Node or Python SDK | `npm install dashclaw` |
| Anything HTTP | REST API + webhooks | [OpenAPI spec](./docs/openapi/critical-stable.openapi.json) |

Working end-to-end examples for each runtime live in [`examples/`](./examples/).

### 1. Coding-agent plugins (Claude Code, Codex, Hermes Agent)

One plugin source, three ecosystems. Distributed via [`plugins/dashclaw/`](./plugins/dashclaw/). Each manifest ships the MCP server config, the `dashclaw-governance` protocol skill, the `dashclaw-platform-intelligence` reference skill, and a distinct `agent_id` so each host reports as its own identity.

```bash
# Claude Code — the CLI downloads the hooks bundle from your instance,
# wires ~/.claude/settings.json, and defaults to observe mode.
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key

# Codex — installer wires manifest, hooks, and the AGENTS.md protocol
dashclaw install codex --project /path/to/your/project

# Hermes Agent — lifecycle hooks (pre/post tool, session start/end, redaction)
bash scripts/install-hermes-plugin.sh        # macOS / Linux
powershell -File scripts/install-hermes-plugin.ps1   # Windows
```

For Claude Code, the hooks govern Bash, Edit, Write, MultiEdit, sub-agent spawns, and every `mcp__*` tool call with a fail-closed PreToolUse check. It starts in observe mode (decisions logged, nothing blocked); flip to enforce with `DASHCLAW_HOOK_MODE=enforce`. Full details in [`hooks/README.md`](hooks/README.md).

**Verify it fires:** pipe a fake tool call through the hook — a clean exit (and a guard evaluation when DashClaw is reachable) confirms the wiring.

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_use_id":"test_001","session_id":"smoke"}' | python .claude/hooks/dashclaw_pretool.py
```

### 2. MCP server (zero code, any MCP host)

[`@dashclaw/mcp-server`](./mcp-server) exposes **12 governance MCP tools** across 3 groups — core governance, retrospection, agent identity — plus 3 read-only resources (`dashclaw://policies`, `dashclaw://agent/{agent_id}/history`, `dashclaw://status`).

**Stdio (Claude Code, any stdio MCP client — not Claude Desktop chat, whose bundled Node crashes local MCP servers; Desktop uses the OAuth connector below):**

```json
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-dashclaw.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_xxx"
      }
    }
  }
}
```

**Streamable HTTP (Claude Managed Agents, any remote MCP client):** every DashClaw instance serves MCP at `/api/mcp`. For Claude Desktop / claude.ai, add it as a **custom connector** (Settings → Connectors → paste `https://<instance>/api/mcp`): OAuth auto-discovers, no key in the UI. Full walkthrough: [`docs/CLAUDE-DESKTOP-PLUGIN.md`](./docs/CLAUDE-DESKTOP-PLUGIN.md).

### 3. Node and Python SDKs

For custom agents, frameworks, and anywhere you want explicit control over what gets governed.

```bash
npm install dashclaw     # Node 18+
pip install dashclaw     # Python 3.7+
```

The **28-method canonical Node surface** covers the governance core: guard, record, assumptions, approvals, durable-execution finality, security scanning, sessions and the action graph, agent pairing, risk signals, and policy simulation. The **Python SDK exposes 51 methods**, plus ready-made CrewAI and AutoGen integrations. Full catalogues: [`sdk/README.md`](./sdk/README.md), [`sdk-python/README.md`](./sdk-python/README.md).

### 4. OpenClaw plugin

For agents built on OpenClaw, [`@dashclaw/openclaw-plugin`](./packages/openclaw-plugin) wires governance into the tool-call lifecycle directly (`before_tool_call`, `after_tool_call`, `agent_end`), calling guard / record / waitForApproval automatically.

### 5. Direct REST API and webhooks

Every governance primitive is reachable as HTTP. The stable contract is pinned in [`docs/openapi/critical-stable.openapi.json`](./docs/openapi/critical-stable.openapi.json); the full inventory (**116 routes**: 38 stable, 17 beta, 61 experimental) is at [`docs/api-inventory.md`](./docs/api-inventory.md). Webhook events include `decision.created`, `action.created`, and `lost_confirmation`, configurable per org.

### 6. Skills — governance protocol + live platform reference

Two drop-in skills, available as zip bundles or source in [`public/downloads/`](./public/downloads/) and auto-bundled into the coding-agent plugins:

- [`dashclaw-governance`](./public/downloads/dashclaw-governance/) — the governance protocol: the decision tree (allow / warn / block / require_approval), action recording, the approval-wait protocol, and session lifecycle.
- [`dashclaw-platform-intelligence`](./public/downloads/dashclaw-platform-intelligence/) — live API reference, env var contract, and troubleshooting playbook, regenerated from the codebase on every release so it never drifts.

---

## Deploy

### Local

```bash
npx dashclaw up
```

Installs the app, provisions Postgres (Docker or embedded), generates secrets, mints your API key, applies migrations, starts on :3000, and offers to wire Claude Code hooks. One command, no accounts required.

Coming from the hosted trial? Click **Export workspace** on your trial's `/connect` card, then run `dashclaw import <bundle.json>` against your new instance — policies, decisions, action history, agents, and assumptions carry over. API keys and secret values never ride a bundle; mint fresh ones here.

### Cloud

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fucsandman%2FDashClaw&env=DATABASE_URL,DASHCLAW_API_KEY,ENCRYPTION_KEY,NEXTAUTH_SECRET,NEXTAUTH_URL,CRON_SECRET,DASHCLAW_LOCAL_ADMIN_PASSWORD&envDescription=Required%20DashClaw%20configuration.%20See%20.env.example%20for%20details.&envLink=https%3A%2F%2Fgithub.com%2Fucsandman%2FDashClaw%2Fblob%2Fmain%2F.env.example&project-name=my-dashclaw&repository-name=my-dashclaw&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&skippable-integrations=1)

**$0 to deploy.** Vercel free tier plus Neon free tier. Click the button, add the Neon integration when prompted, fill in the env vars listed in [`.env.example`](./.env.example). The schema migration runs as part of the build.

The hosted trial is the secondary door: if you want a taste of the Approvals inbox before deploying, [hosted.dashclaw.io](https://hosted.dashclaw.io/connect) mints a capped trial workspace in the browser. To run that trial mode yourself (operator deployments only), see [`docs/hosted-deployment-runbook.md`](./docs/hosted-deployment-runbook.md).

---

## Safety and governance model

DashClaw is control before execution, not observability. The model:

1. **Every risky action is evaluated against active policies before it runs.** Policies are declarative; the builder ships with nine pre-built safety switches (Deploy Gate, Risk Threshold, Rate Limiter, Evidence Required, Protected Path, and others), an AI generator, and YAML import.
2. **The default pack is catastrophe-only.** Out of the box, DashClaw interrupts for the irreversible class — destructive filesystem, git, and database actions, and secret reads or exfiltration — and lets everything else run. This is the fatigue lesson encoded: a governor you disable is worse than none.
3. **Sensitive actions require human approval.** Approvals route to the dashboard (`/approvals`), the CLI, the mobile PWA at `/approve`, Telegram, or Discord, with one-tap allow or deny. When one policy exceeds its interruption budget, per-action pings collapse into a single flood banner with bulk-resolve controls; pending approvals are never auto-resolved.
4. **Every decision is recorded, and outcomes are durable.** The ledger is replayable, and a five-state finality machine plus a lost-confirmation sweep guarantee no silent double-execute on retry.
5. **Interruption precision is calibrated, not guessed.** A distribution-free controller ([`/calibration`](docs/architecture/governance-core-theory.md), default off) turns your approve/deny verdicts into a proven false-interruption bound; shadow-first, tighten-only, and loosening always routes through human-ratified proposals.
6. **Enforcement proves it is still on.** A liveness probe drives a synthetic held action through the real hook seam and verdicts by whether it executed, never by reading the ledger — because once it wasn't and nothing noticed. Stale never renders green.
7. **Prompt injection scanning is on by default.** High-confidence system-override patterns force a `block` at guard time; lower-severity patterns raise a `warn`.

The full architecture map lives in [`PROJECT_DETAILS.md`](./PROJECT_DETAILS.md). The runtime API contract is in [`docs/architecture/runtime-api.md`](./docs/architecture/runtime-api.md).

---

## Approvals beyond the dashboard

| Surface | Purpose | Setup |
|---|---|---|
| Dashboard (`/approvals`) | The primary inbox: what your agent tried, what is waiting on you, two buttons per item. | None. |
| CLI (`@dashclaw/cli`) | Terminal-first inbox. `dashclaw approvals`, `dashclaw approve <id>`. | `npm install -g @dashclaw/cli` |
| Mobile PWA (`/approve`) | Phone-first allow/deny with risk score and policy. Add to home screen. | None. |
| Telegram | Inline Approve/Reject buttons in an admin chat. | Optional. See [`docs/telegram-setup.md`](./docs/telegram-setup.md). |
| Discord | Inline Approve/Deny on DM embeds. | Optional. See `.env.example`. |

`waitForApproval()` unblocks near-instantly over SSE when the approval resolves, falling back to ~5-second polling — regardless of which surface resolves the action.

---

## Durable execution finality

Approved actions carry a terminal outcome separate from their lifecycle status. Five states, one-shot transitions, repository-level enforcement:

| State | Meaning |
|---|---|
| `pending` | Approved, no outcome reported yet. |
| `completed` | Finished successfully. Set by the agent. |
| `partial` | Started but did not finish. Set by the agent with a progress payload. |
| `failed` | Attempted and errored. Set by the agent with an error message. |
| `lost_confirmation` | Timeout exceeded without a report. Set by the cron sweep. |

`POST /api/actions/[actionId]/outcome` is one-shot: the first call wins, every subsequent POST returns 409. A cron sweep marks stale pending rows as `lost_confirmation` and emits a `signal.detected` event. Full spec: [`docs/architecture/durable-execution-finality.md`](./docs/architecture/durable-execution-finality.md).

---

## Documentation

**[docs/README.md](./docs/README.md) is the full documentation index** — ordered by adoption journey (understand → try → connect → operate → reference). Highlights:

- [Product thesis](./THESIS.md): what DashClaw is, who it is for, and what is explicitly out of scope.
- [Concepts](./docs/concepts.md): the mental model — primitives, the loop, risk scoring, what "block" means per surface.
- [Quick start](./QUICK-START.md): from zero to first governed action.
- [Governing Claude Code](./docs/integrations/claude-code.md) · [Governing agents over MCP](./docs/integrations/mcp.md).
- [Operating DashClaw](./docs/operations.md): policies, approvals, the decisions ledger, the emergency halt, doctor.
- [Troubleshooting](./docs/troubleshooting.md): the errors you will actually see, with fixes.
- [Node SDK reference](./sdk/README.md) · [Python SDK reference](./sdk-python/README.md) · [SDK parity matrix](./docs/sdk-parity.md).
- [Agent identity guide](./docs/agent-identity.md): JWKS verification, replay protection, action binding.
- [Runtime API contract](./docs/architecture/runtime-api.md) · [Guard enforcement contract](./docs/guard-enforcement-contract.md) · [Governance core theory](./docs/architecture/governance-core-theory.md).
- [API inventory](./docs/api-inventory.md): full route list with maturity tier.
- [Architecture map](./PROJECT_DETAILS.md) · [Changelog](./CHANGELOG.md) · [Security guide](./docs/SECURITY.md).

---

## Project status

Honest expectations, stated plainly:

- **Young and fast-moving.** First commit February 2026; releases land near-daily. The API surface is explicitly tiered for exactly this reason — 38 stable routes pinned in the [OpenAPI contract](./docs/openapi/critical-stable.openapi.json), 17 beta, 61 experimental. Build against stable; experimental routes can change without notice.
- **Proven by dogfood, not by scale.** The core loop is exercised continuously by the maintainer's own agent fleet and by a CI policy-smoke harness that live-proves the public claims on every push. External production deployments are early. Treat this as young infrastructure that takes correctness seriously, not a battle-tested incumbent.
- **AI-maintained, human-governed.** Day-to-day maintenance is done by an AI agent under the human-held charter in [MAINTAINER.md](./MAINTAINER.md); risk-bearing invariants (blocks are absolute, no self-approval, humans ratify policy changes, credentials stay human) cannot be changed by the maintainer. The [maintainer log](./docs/maintainer-log.md) records every decision in public.

## License

[MIT](./LICENSE)

<div align="center">
  <br />
  <img src="public/images/github-social-preview-ps.png" alt="Practical Systems" width="600" />
  <br />
  <sub>Built by <a href="https://practicalsystems.io">Practical Systems</a></sub>
</div>
