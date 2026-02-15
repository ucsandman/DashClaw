# DashClaw: One-Clipboard Setup (Connect An Agent Machine)

> **Tip:** The fastest way to generate this prompt with your dashboard URL pre-filled is the **Copy Agent Prompt** button on the API Keys page (`/api-keys`) or the onboarding checklist.

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
DASHCLAW_AGENT_ID=...
```

## Step 2: Send A Smoke-Test Action (Node)

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
  agentId: process.env.DASHCLAW_AGENT_ID,
  agentName: process.env.DASHCLAW_AGENT_ID,
});

const { action_id } = await claw.createAction({
  action_type: 'monitor',
  declared_goal: 'Smoke test: agent connected',
  risk_score: 1,
});

console.log('DashClaw action created:', action_id);
```

Run it and confirm you can see the action in the dashboard (`/actions`).

## Step 3 (Recommended): One-Click Pairing For Verified (Signed) Agents

If the user wants cryptographic verification, do NOT make them copy/paste PEMs.

High-level flow:
1. Agent has (or generates) a private key locally.
2. Agent creates a pairing request and prints a one-click approval URL.
3. User clicks approve (or bulk approves in `/pairings`).
4. DashClaw stores the public key, and the agent's signed actions become `verified`.

Node example (private JWK in memory):

```js
// privateKeyJwk: the agent's RSA private key (JWK)
const { pairing, pairing_url } = await claw.createPairingFromPrivateJwk(privateKeyJwk);
console.log('Approve this agent:', pairing_url);
await claw.waitForPairing(pairing.id);
```

After approval, send a signed action and confirm the dashboard marks it verified.

## Step 4: Scaling To 50+ Agents

Best practice:
- Keep one shared `DASHCLAW_API_KEY` per workspace.
- Use a unique `DASHCLAW_AGENT_ID` per agent process.
- Use the Pairings inbox (`/pairings`) to approve many agents quickly.

