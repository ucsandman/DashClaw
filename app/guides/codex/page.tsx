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
  title: 'Codex Integration Guide - DashClaw',
  description: 'Govern OpenAI Codex CLI tool calls with DashClaw in under 20 minutes.',
  path: '/guides/codex',
});

export default async function CodexGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const configTomlBlock = `# >>> dashclaw start — managed block, do not edit by hand
#
# Re-run \`dashclaw install codex\` to refresh this block.

approval_policy = "on-request"

[mcp_servers.dashclaw]
command = "python"
args = ["/path/to/DashClaw/mcp-server/bin/dashclaw-mcp.js", "--agent-id", "codex"]

[[hooks.PreToolUse]]
matcher = "Bash|Edit|Write|MultiEdit"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "python /Users/<you>/.codex/hooks/dashclaw/dashclaw_pretool.py"
timeoutSec = 3600

[[hooks.PostToolUse]]
matcher = "Bash|Edit|Write|MultiEdit"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "python /Users/<you>/.codex/hooks/dashclaw/dashclaw_posttool.py"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "python /Users/<you>/.codex/hooks/dashclaw/dashclaw_stop.py"
# <<< dashclaw end`;

  const guardrailsYaml = `version: 1
project: my-codex-project
description: >
  Governance policy for Codex tool calls.
  Blocks destructive shell commands. Warns on deployment.

policies:
  - id: block_destructive_shell
    description: Block rm -rf and database drops
    applies_to:
      tools:
        - Bash
        - local_shell
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
        - local_shell
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
      title: 'Install Codex governance',
      summary:
        'One command writes the DashClaw MCP server config + PreToolUse / PostToolUse / Stop hooks into ~/.codex/config.toml, copies the Python governance scripts into ~/.codex/hooks/dashclaw/, and drops the governance protocol into your project\'s AGENTS.md. Idempotent — re-run after each `git pull` to upgrade.',
      codeTitle: 'Terminal',
      codeBody: `# From the DashClaw repo root:
node cli/bin/dashclaw.js install codex --project /path/to/your/project

# Optional: also wire Codex's legacy notify config for turn-complete records
node cli/bin/dashclaw.js install codex --project /path/to/your/project --include-notify

# Inspect what got installed
cat ~/.codex/config.toml
cat /path/to/your/project/AGENTS.md`,
      note: 'Codex defaults to approval_policy = "on-request" after install so DashClaw\'s require_approval decisions surface in Codex\'s UI.',
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary:
        'The hooks read these from the shell or a .env file in the project root. DASHCLAW_GUARD_UNAVAILABLE_POLICY defaults to block, which fails closed if the guard is unreachable after three retry attempts. Set it to warn for development if you would rather proceed with a stderr warning when the guard is down.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_HOOK_MODE=enforce
DASHCLAW_GUARD_UNAVAILABLE_POLICY=block
DASHCLAW_GUARD_TIMEOUT=5`,
    },
    {
      number: 4,
      title: 'Trust the hooks',
      summary:
        'Codex marks new hooks as untrusted on first encounter so you can review them before they fire. The hooks live in ~/.codex/hooks/dashclaw/ and are pinned by content hash — Codex re-prompts if the hash changes.',
      codeTitle: 'In Codex',
      codeBody: `codex hooks list
# Find the three DashClaw hooks (trustStatus: untrusted)

codex hooks trust ~/.codex/config.toml:pre_tool_use:0:0
codex hooks trust ~/.codex/config.toml:post_tool_use:0:0
codex hooks trust ~/.codex/config.toml:stop:0:0

# Or open Codex's UI and approve when prompted on first tool call.`,
      note: 'This is a one-time per-hook step. Trusted hooks persist across sessions.',
    },
    {
      number: 5,
      title: 'Verify the managed block',
      summary:
        'Skim the managed block dashclaw install codex wrote to ~/.codex/config.toml. Anything outside the start/end markers is your own content and was preserved verbatim. A .dashclaw-bak sibling holds the pre-install state.',
      codeTitle: '~/.codex/config.toml',
      codeBody: configTomlBlock,
    },
    {
      number: 6,
      title: 'Connect Discord (2 minutes)',
      summary:
        'A Discord bot turns your phone into a one-tap approval surface for risky tool calls. The built-in Discord adapter posts a DM with Approve / Deny buttons when a policy requires human judgment. Same setup as the Claude Code path; ENV-only.',
      codeTitle: '.env.local (or Vercel env vars)',
      codeBody: discordEnvBlock,
      note: 'Step-by-step Discord Developer Portal walkthrough is printed below.',
    },
    {
      number: 7,
      title: 'Run Codex and trigger a tool call',
      summary:
        'Ask Codex to do anything that uses local_shell, Bash, Edit, Write, or MultiEdit. The hook fires automatically. For policies that require approval, your phone DMs you and Codex pauses on the dashclaw_wait_for_approval MCP tool until you resolve.',
      codeTitle: 'Example prompt',
      codeBody: 'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note: 'Watch the terminal — you should see [DashClaw] messages as the hook evaluates the action. Codex shows hook output above each tool call.',
    },
    {
      number: 8,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded under the codex agent id.',
      note: "Go to /decisions — you should see your tool call in the ledger with agent_id 'codex' and status 'completed'. Approvals that ran through Discord show approved_by starting with 'discord:'.",
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
- Trigger a Codex tool call that hits an approval-required policy
- Your phone's Discord app lights up; tap Approve or Deny
- The DM edits in place to show APPROVED or DENIED with timestamp`;

  const codexNotesBlock = `## Codex-specific notes

### Tool surface
Codex's main shell tool is local_shell (not Bash). DashClaw governs both names
identically — the matcher in the managed config.toml block is
"Bash|Edit|Write|MultiEdit" and applies to local_shell automatically because
Codex's hook schema treats local_shell as a Bash-class tool.

### Approval policy
After install, approval_policy = "on-request" is set in the managed block.
DashClaw's require_approval guard decisions surface through Codex's normal
approval prompt; the dashclaw_wait_for_approval MCP tool blocks until your
phone resolves it.

### Session transcripts
Codex writes session rollouts to ~/.codex/sessions/rollout-<ts>-<uuid>.jsonl.
Backfill them for analytics with:

  dashclaw code ingest-codex --dry-run        # preview
  dashclaw code ingest-codex                  # write to ~/.dashclaw/codex-sessions/

### Backing out
Delete the managed block between the # >>> dashclaw start / # <<< dashclaw end
markers in ~/.codex/config.toml. A .dashclaw-bak file is left next to the
config on first install for full restore.`;

  const proofMoment =
    "Go to /decisions — you should see your Codex tool call in the ledger. Look for agent_id 'codex' and status 'completed'.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Codex Integration Guide - DashClaw',
          description: 'Govern OpenAI Codex CLI tool calls with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/codex',
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
            <span className="text-secondary">Codex</span>
          </div>

          <GuideClient
            frameworkName="Codex"
            frameworkIcon="⌘"
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Codex-specific notes
            </p>
            <MarkdownBody content={codexNotesBlock} className="mt-4" />
          </section>

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
