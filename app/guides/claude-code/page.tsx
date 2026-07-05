import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import MarkdownBody from '../../messages/_components/MarkdownBody';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Claude Code Integration Guide - DashClaw',
  description: 'Govern Claude Code tool calls with DashClaw in under 20 minutes.',
  path: '/guides/claude-code',
});

export default async function ClaudeCodeGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const hookSettingsJson = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent|Task|Bash|Edit|Write|MultiEdit|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_pretool.py",
            "timeout": 3600000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Agent|Task|Bash|Edit|Write|MultiEdit|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_posttool.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/dashclaw_stop.py"
          }
        ]
      }
    ]
  }
}`;

  const guardrailsYaml = `version: 1
project: my-claude-code-project
description: >
  Governance policy for Claude Code tool calls.
  Blocks destructive shell commands. Warns on deployment.

policies:
  - id: block_destructive_shell
    description: Block rm -rf and database drops
    applies_to:
      tools:
        - Bash
    rule:
      block: true
    when:
      command_contains:
        - "rm -rf"
        - "drop table"

  - id: warn_on_deploy
    description: Require approval for deployment commands
    applies_to:
      tools:
        - Bash
    rule:
      require: approval
    when:
      command_contains:
        - "git push"
        - "vercel deploy"`;

  const discordEnvBlock = `DISCORD_BOT_TOKEN=<token>
DISCORD_PUBLIC_KEY=<64-char-hex>
DISCORD_APPROVER_USER_ID=<numeric-user-id>
DISCORD_APPROVER_ORG_ID=<your-org-id>
# Kill switch — leave unset or set to true to enable DMs
# DASHCLAW_ALERTS_DISCORD=false`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the hook scripts',
      summary: 'Already running the DashClaw plugin (claude plugin install dashclaw@dashclaw)? The Pre/Post/Stop hooks are bundled — they fire as soon as the plugin is enabled (no trust gate), so you can skip straight to Step 3 (env vars). Otherwise, one command copies all three governance hooks plus the vendored intel module and merges the matching settings.json blocks. Re-run after each git pull to upgrade.',
      codeTitle: 'Terminal',
      codeBody: `# From the DashClaw repo root:
npm run hooks:install

# Govern EVERY project, fires out-of-the-box (incl. fresh clones / Docker /
# headless): installs into ~/.claude/settings.json, which Claude Code does NOT
# gate behind the "trust this folder?" prompt the way a project file is.
node scripts/install-hooks.mjs --global --governance

# Or from any other project, pointing at a checked-out DashClaw clone:
node /path/to/DashClaw/scripts/install-hooks.mjs --target=.

# Manual fallback (skips settings merge):
mkdir -p .claude/hooks
cp hooks/dashclaw_pretool.py  .claude/hooks/
cp hooks/dashclaw_posttool.py .claude/hooks/
cp hooks/dashclaw_stop.py     .claude/hooks/
cp -r hooks/dashclaw_agent_intel .claude/hooks/`,
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary: 'Claude Code reads these from the shell or a .env file in the project root. The hooks accept DASHCLAW_URL as a fallback for DASHCLAW_BASE_URL (the MCP server uses DASHCLAW_URL) — set either. If only one of the URL/key is present, PreToolUse prints a one-line "half-configured" warning instead of failing silently. DASHCLAW_GUARD_UNAVAILABLE_POLICY defaults to block, which fails closed if the guard is unreachable after three retry attempts. Set it to warn for development if you would rather proceed with a stderr warning when the guard is down.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_HOOK_MODE=enforce
DASHCLAW_GUARD_UNAVAILABLE_POLICY=block
DASHCLAW_GUARD_TIMEOUT=5`,
    },
    {
      number: 4,
      title: 'Add hooks to Claude Code settings',
      summary:
        'Merge this into your project\'s .claude/settings.json (or ~/.claude/settings.json for global).',
      codeTitle: '.claude/settings.json',
      codeBody: hookSettingsJson,
      note:
        'Heads-up: a PROJECT .claude/settings.json only loads after you accept Claude Code\'s "trust this folder?" prompt. In a fresh clone, a Docker container, or a headless run, project hooks silently won\'t fire (a global ~/.claude Stop hook still will — the classic "Stop ran but Pre/PostToolUse didn\'t"). Put the hooks in ~/.claude/settings.json (or run `install-hooks.mjs --global --governance`) to fire out of the box with no trust step.',
    },
    {
      number: 5,
      title: 'Connect Discord (2 minutes)',
      summary:
        'A Discord bot turns your phone into a one-tap approval surface for risky tool calls. The built-in Discord adapter posts a DM with Approve / Deny buttons when a policy requires human judgment. Telegram parity; ENV-only setup.',
      codeTitle: '.env.local (or Vercel env vars)',
      codeBody: discordEnvBlock,
      note:
        'Step-by-step Discord Developer Portal walkthrough is printed below.',
    },
    {
      number: 6,
      title: 'Run Claude Code and trigger a tool call',
      summary:
        'Ask Claude Code to do anything that uses Bash, Edit, Write, or MultiEdit, or an MCP tool (e.g. a connected Gmail/Stripe send). The hook fires automatically. For policies that require approval, your phone will DM you.',
      codeTitle: 'Example prompt',
      codeBody: 'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note: 'Watch the terminal — you should see [DashClaw] messages as the hook evaluates the action.',
    },
    {
      number: 7,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions — you should see your tool call in the ledger with action_type 'other' (for a simple file write) or 'security' (for sensitive files), status 'completed'. Approvals that ran through Discord show approved_by starting with 'discord:'.",
    },
  ];

  const discordPortalWalkthrough = `## Discord Developer Portal walkthrough

### Create the bot
- Open https://discord.com/developers/applications -> New Application
- Name the app; skip the Installation tab
- Open the "Bot" tab -> Reset Token -> copy as DISCORD_BOT_TOKEN
- Open "General Information" -> copy the Public Key as DISCORD_PUBLIC_KEY
- Under "Privileged Gateway Intents" leave ALL off (button-only bot)

### Invite the bot to a mutual server (so DMs work)
- Open "OAuth2" -> URL Generator -> scopes: "bot" -> permissions: "Send Messages"
- Paste the URL in a browser, invite the bot to a personal test server
- In Discord client, enable Developer Mode (Settings -> Advanced)
- Right-click your own user in the member list -> Copy User ID
- Paste as DISCORD_APPROVER_USER_ID

### Register the interactions endpoint
- In "General Information" set:
  Interactions Endpoint URL: https://<your-deployment>/api/discord/interactions
- Discord sends a PING; DashClaw responds {type:1} and the URL saves.

### Verify
- Trigger a Claude Code tool call that hits an approval-required policy
- Your phone's Discord app lights up; tap Approve or Deny
- The DM edits in place to show APPROVED or DENIED with timestamp`;

  const proofMoment =
    "Go to /decisions — you should see your Claude Code tool call in the ledger. Look for action_type 'other' or 'security' with agent_id 'claude-code' and status 'completed'.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Claude Code Integration Guide - DashClaw',
          description: 'Govern Claude Code tool calls with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/claude-code',
        }}
      />
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-2 text-sm text-tertiary">
            <Link href="/" className="transition-colors hover:text-secondary">
              Home
            </Link>
            <ChevronRight size={14} />
            <Link href="/connect" className="transition-colors hover:text-secondary">
              Connect
            </Link>
            <ChevronRight size={14} />
            <span className="text-secondary">Claude Code</span>
          </div>

          <GuideClient
            frameworkName="Claude Code"
            frameworkIcon="🤖"
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Discord setup
            </p>
            <MarkdownBody content={discordPortalWalkthrough} className="mt-4" />
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
