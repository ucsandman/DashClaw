/**
 * /llms.txt — the agent-readable setup runbook (agent-onboarding pass, 2026-08-07).
 *
 * A human tells their coding agent "get DashClaw set up"; the agent searches
 * the web, lands here, and must be able to finish without a human. This file
 * is the machine-readable contract for that path: the one command that works
 * non-interactively, where the credentials land, how to verify, and the one
 * door (hosted trial) an agent must NOT attempt headlessly.
 *
 * Host-aware like robots.txt: only the marketing host serves the full
 * runbook; every other host (hosted trial, self-host instances, previews)
 * answers with a pointer so private instances never advertise setup copy
 * that does not apply to them.
 *
 * Human-facing twin: /agents renders the same runbook as a page.
 */

import { isMarketingHost } from '../lib/guideContent';
import { MARKETING_ORIGIN } from '../lib/marketingSeo';

export const dynamic = 'force-dynamic';

const RUNBOOK = `# DashClaw

> DashClaw evaluates agent actions against policy, routes held work to a human
> Approvals inbox, and records the decisions it receives. Installed hooks,
> OpenClaw, and bounded invocation helpers can halt supported actions before
> execution. Bare SDK and MCP calls are cooperative. MIT licensed and self-hosted.

## Setup runbook for AI agents

You are an AI agent setting DashClaw up for your user. This is the complete,
non-interactive path. It needs Node 18+ and a terminal. No account, no OAuth,
no browser, no LLM API key.

Run:

    npx dashclaw up --yes --no-browser

What this does: installs the runtime to ~/.dashclaw, provisions Postgres
(Docker if available, embedded binary otherwise), generates secrets, applies
migrations, mints the workspace API key, builds, and starts the dashboard on
http://localhost:3000.

Plain \`npx dashclaw up\` without \`--yes\` prompts interactively and will hang
a non-interactive shell. Always pass \`--yes --no-browser\` when you are the
one running it.

Where the credentials land:

- Workspace API key (oc_live_...): ~/.dashclaw/instance.json
- Dashboard admin password: printed to stdout once, also saved to the
  .env.local file under ~/.dashclaw
- Never paste these into chat. Read them from disk when you need them.

## Verify

    curl -fsS http://localhost:3000/api/health
    npx dashclaw doctor

Both must succeed before you tell your user setup is done. Then hand your
user this URL for the human side: http://localhost:3000/approvals — that is
where their one-click approvals happen.

## Connect your runtime

- Claude Code: \`up --yes\` wires the hooks into ~/.claude/settings.json
  automatically (needs python3 or python on PATH). Manual: \`npx dashclaw
  install claude\`. Codex: \`npx dashclaw install codex\`. OpenClaw: \`npx
  dashclaw install openclaw\` (interactive in a terminal — it can create an
  instance and collect a key; headless runs need DASHCLAW_BASE_URL and
  DASHCLAW_API_KEY set, or --base-url/--api-key flags).
- MCP (any MCP host): \`npx @dashclaw/mcp-server\` with env DASHCLAW_URL and
  DASHCLAW_API_KEY (optional DASHCLAW_AGENT_ID). The host must call the tools
  and honor their decisions unless an installed hook enforces the call path.
- SDKs: \`npm install dashclaw\` (Node) or \`pip install dashclaw\` (Python).
  Bare methods are cooperative. \`runGoverned\` and \`run_governed\` require a
  server that advertises execution-claim protocol 1 before invoking the supplied
  callback. Upgrade the server and SDK together before using these helpers.

## Enforcement contract

- Installed hooks and the OpenClaw gateway mechanically enforce the supported
  events that reach them. A missing protocol advertisement keeps the legacy hook
  approval flow; malformed or unsupported advertisements fail closed.
- Protocol 1 atomically grants one execution attempt only after a fresh policy
  check binds the exact redacted act and principal. It does not make an external
  side effect exactly once. Reconcile uncertain claim or outcome states before retrying.
- Audit receipts protect the integrity of recorded content and verdicts where a
  receipt was issued. They do not prove unobserved external reality or imply a
  universal payload signature. Identity verification and payload-signature status
  are reported separately.
- Enforcement liveness is a point-in-time client report, not continuous attestation.

## What you cannot do headlessly

The hosted trial (https://hosted.dashclaw.io/connect) mints workspaces behind a
Cloudflare Turnstile captcha. You cannot pass it. Do not try. If your user
wants the hosted trial instead of self-host, give them the link and ask them
to paste the minted API key back to your environment — the key goes in an env
file, not in chat.

## Key URLs

- Agent setup page (this runbook, rendered): ${MARKETING_ORIGIN}/agents
- Docs: ${MARKETING_ORIGIN}/docs
- Platform guide (all runtimes): ${MARKETING_ORIGIN}/guides/platform
- Claude Code guide: ${MARKETING_ORIGIN}/guides/claude-code
- Self-host options (Vercel + Neon deploy): ${MARKETING_ORIGIN}/self-host
- Source: https://github.com/ucsandman/DashClaw
- npm: https://www.npmjs.com/package/dashclaw
`;

export async function GET(request: Request) {
  const host = request.headers.get('host');

  const body = isMarketingHost(host)
    ? RUNBOOK
    : `# DashClaw\n\nThis is a private DashClaw instance. The public setup runbook for AI agents lives at ${MARKETING_ORIGIN}/llms.txt\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
