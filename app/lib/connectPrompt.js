/**
 * Generates a markdown prompt users can paste into any AI agent session
 * to self-configure a connection to their DashClaw dashboard.
 */
export function generateConnectPrompt(baseUrl, orgName) {
  return `# DashClaw Agent Setup

DashClaw is your AI agent observability and governance dashboard — it tracks actions, decisions, goals, and security signals.

- **Dashboard**: ${baseUrl}/dashboard
- **Workspace**: ${orgName}

## 1. Set your API key

Before doing anything else, set \`DASHCLAW_API_KEY\` in your environment (shell, \`.env\`, etc.).
Do NOT paste the key into this chat.

\`\`\`bash
export DASHCLAW_API_KEY="<your-key>"
\`\`\`

## 2. Install the SDK

\`\`\`bash
# Node.js
npm install dashclaw

# Python
pip install dashclaw
\`\`\`

## 3. Initialize the client

\`\`\`js
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: '${baseUrl}',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  agentName: 'My Agent',
});
\`\`\`

## 4. Smoke test

\`\`\`js
await claw.createAction({
  action_type: 'test',
  declared_goal: 'Verify DashClaw connection',
  risk_score: 10,
});
\`\`\`

## 5. Optional: Bootstrap existing state

Clone the repo and run the scanner to import integrations, goals, and memory:

\`\`\`bash
git clone https://github.com/ucsandman/DashClaw.git /tmp/dashclaw
node /tmp/dashclaw/scripts/bootstrap-agent.mjs \\
  --dir . --agent-id my-agent \\
  --api-key "$DASHCLAW_API_KEY" \\
  --base-url ${baseUrl}
\`\`\`

## What to report

Use the SDK to report:
- **Actions** — tool calls, file writes, deployments
- **Learning / Decisions** — why you chose an approach
- **Goals** — what you're trying to achieve
- **Context** — handoff notes, memory, preferences

## Reference

Full SDK docs: ${baseUrl}/docs
`;
}
