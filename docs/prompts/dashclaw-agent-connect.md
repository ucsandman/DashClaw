# DashClaw: One-Clipboard Setup (Connect An Agent Machine)

You are helping a non-technical user connect an agent to their self-hosted DashClaw dashboard.

Rules:
- Do NOT ask the user to paste long-lived secrets into chat. If needed, instruct them to paste secrets only into their agent machine environment file/terminal.
- Never ask for `DATABASE_URL`. Agents never need it.

Inputs you need from the user (as short values):
- `DASHCLAW_BASE_URL` (example: `http://localhost:3000` or `https://dashclaw.example.com`)
- `DASHCLAW_API_KEY` (starts with `oc_live_...`)
- `DASHCLAW_AGENT_ID` (unique per agent, example: `cinder`)

## Step 1: Set Agent Environment Variables

On the agent machine, set:

```bash
DASHCLAW_BASE_URL=...
DASHCLAW_API_KEY=...
DASHCLAW_AGENT_ID=...   # optional but recommended; uniquely identifies this agent process
```

## Step 2: Send a Smoke-Test Action

If the agent is Node/TypeScript:

```bash
npm install dashclaw
```

Create a quick test script:

```js
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.DASHCLAW_AGENT_ID || 'my-agent',
});

const act = { kind: 'http', request: { method: 'GET', url: `${process.env.DASHCLAW_BASE_URL}/api/health` } };
await claw.runGoverned(act, {
  action_type: 'test',
  declared_goal: 'Verify DashClaw connection',
  risk_score: 5,
}, async () => {
  const response = await fetch(act.request.url);
  if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
});

console.log('Governed DashClaw smoke test completed.');
```

> **Canonical execution flow:** For the full explanation of approval waiting,
> execution claims, and uncertain outcome confirmation,
> see [`sdk/README.md` → Human-in-the-Loop (HITL) Approval Flow](../../sdk/README.md#human-in-the-loop-hitl-approval-flow).

Run it and confirm you can see the action in the dashboard (`/decisions`).

## Step 3 (Optional): Terminal Approval Channel

Install the DashClaw CLI to approve agent actions without opening a browser:

```bash
npm install -g @dashclaw/cli
```

Set env vars (same API key, no extra config needed):

```bash
export DASHCLAW_BASE_URL=...
export DASHCLAW_API_KEY=...
```

Commands:
- `dashclaw approvals`: interactive inbox for pending actions
- `dashclaw approve <actionId>`: approve a specific action
- `dashclaw deny <actionId>`: deny a specific action

When an agent calls `waitForApproval()`, the SDK prints the action ID and a replay link to stdout. Approve from any terminal and the agent unblocks instantly via SSE.

## Step 3b (Optional): Telegram Approval Channel

If the DashClaw instance has Telegram configured (`TELEGRAM_BOT_TOKEN` set on
the server), the operator will also receive inline Approve/Reject buttons in
their Telegram admin chat when the agent calls `waitForApproval()`. One tap
resolves the action. No client-side setup is needed — this is a server-side
feature. See the repo's `docs/telegram-setup.md` (or README "Telegram approvals
(optional)" section) for server setup.

## Step 4: One-Click Agent Pairing (Verified Signatures)

If the user wants cryptographic verification, do NOT make them copy/paste PEMs.

High-level flow:
1. Agent has (or generates) a private key locally.
2. Agent creates a pairing request and prints a one-click approval URL.
3. User clicks approve (or bulk approves pending pairings in `/identities`).
4. DashClaw stores the public key, and the agent's signed actions become `verified`.

Node example (private JWK in memory).

> **Important:** `createPairingFromPrivateJwk` and `waitForPairing` currently exist
> **only** on the `dashclaw/legacy` surface — they are not yet on the canonical
> `dashclaw` import. `dashclaw/legacy` is **deprecated** (removed in v5.0.0), so these
> pairing methods must be promoted to the canonical SDK before then; until they are,
> pairing flows require the legacy subpath:

```js
import { DashClaw } from 'dashclaw/legacy';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.DASHCLAW_AGENT_ID,
});

// privateKeyJwk: the agent's RSA private key (JWK)
const { pairing, pairing_url } = await claw.createPairingFromPrivateJwk(privateKeyJwk);
console.log('Approve this agent:', pairing_url);
await claw.waitForPairing(pairing.id);
```

After approval, send a signed action and confirm the dashboard marks it verified.

## Step 5: Scaling to 50+ Agents

Best practice:
- Keep one shared `DASHCLAW_API_KEY` per workspace.
- Use a unique `DASHCLAW_AGENT_ID` per agent process.
- Use the Identities inbox (`/identities`) to approve many pending pairings quickly.
