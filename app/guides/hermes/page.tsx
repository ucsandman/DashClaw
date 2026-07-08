import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import MarkdownBody from '../../components/MarkdownBody';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Hermes Agent Integration Guide - DashClaw',
  description: 'Govern Hermes Agent with DashClaw: per-turn context injection, secret redaction, subagent ROI, and live session ingest in under 20 minutes.',
  path: '/guides/hermes',
});

export default async function HermesGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const hermesConfigYamlBlock = `# >>> dashclaw start — managed block, do not edit by hand
#
# Re-run scripts/install-hermes-plugin.sh to refresh this block.

hooks:
  pre_tool_call:
    - matcher: "^(Bash|Edit|Write|MultiEdit|terminal|str_replace_editor|create_file)$"
      command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_pretool_hermes.py"
      timeout: 60

  post_tool_call:
    - matcher: "^(Bash|Edit|Write|MultiEdit|terminal|str_replace_editor|create_file)$"
      command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_posttool_hermes.py"
      timeout: 30

  pre_llm_call:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_pre_llm_hermes.py"
      timeout: 5

  post_llm_call:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_postllm_hermes.py"
      timeout: 15

  on_session_start:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_on_session_start_hermes.py"
      timeout: 10

  on_session_end:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_on_session_end_hermes.py"
      timeout: 15

  transform_tool_result:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_transform_tool_result_hermes.py"
      timeout: 5

  subagent_stop:
    - command: "python \${DASHCLAW_REPO}/.hermes/hooks/dashclaw_subagent_stop_hermes.py"
      timeout: 10

hooks_auto_accept: false
# <<< dashclaw end`;

  const guardrailsYaml = `version: 1
project: my-hermes-project
description: >
  Governance policy for Hermes Agent tool calls.
  Blocks destructive shell commands. Warns on deployment.

policies:
  - id: block_destructive_shell
    description: Block rm -rf and database drops
    applies_to:
      tools:
        - Bash
        - terminal
        - str_replace_editor
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
        - terminal
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
      title: 'Install the Hermes plugin',
      summary:
        'One script symlinks the plugin into ~/.hermes/, appends the eight DashClaw hook entries to ~/.hermes/config.yaml (idempotent: sentinel markers prevent duplication on re-run), substitutes ${DASHCLAW_REPO} for the absolute repo path, and prints an env-var checklist. Re-run after every git pull to upgrade.',
      codeTitle: 'Terminal',
      codeBody: `# macOS / Linux
bash scripts/install-hermes-plugin.sh

# Windows
powershell -File scripts/install-hermes-plugin.ps1

# Sanity check
hermes dashclaw doctor`,
      note: 'The doctor command runs a 4-section check: env vars, all 8 hooks on disk, plugin skills present, API reachability plus a finalize: true probe of /api/code-sessions/ingest-live.',
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary:
        'The hooks read these from the shell or a .env file in the project root. DASHCLAW_GUARD_UNAVAILABLE_POLICY defaults to block (fail closed). Set it to warn for development if you want stderr warnings instead of blocks when the guard is down.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_AGENT_ID=hermes
DASHCLAW_HOOK_MODE=enforce
DASHCLAW_GUARD_UNAVAILABLE_POLICY=block
DASHCLAW_GUARD_TIMEOUT=5`,
    },
    {
      number: 4,
      title: 'Accept the hooks',
      summary:
        'Hermes prompts on first invocation of each (event, command) pair so you can review the eight commands before they fire. Accept once per hook, or set hooks_auto_accept: true in ~/.hermes/config.yaml after you have reviewed them. Trusted hooks persist across sessions.',
      codeTitle: 'In Hermes',
      codeBody: `# First Hermes session after install will prompt 8 times — once per hook.
# Each prompt shows the absolute command + matcher.

# Or non-interactive — set in ~/.hermes/config.yaml:
hooks_auto_accept: true`,
      note: 'One-time per hook. The acceptance is keyed on the command string, so re-running install with the same DASHCLAW_REPO path keeps consent state intact.',
    },
    {
      number: 5,
      title: 'Verify the managed block',
      summary:
        'Skim the managed block the install script wrote to ~/.hermes/config.yaml. Anything outside the start/end markers is your own content and was preserved verbatim. A .dashclaw-bak sibling holds the pre-install state.',
      codeTitle: '~/.hermes/config.yaml',
      codeBody: hermesConfigYamlBlock,
    },
    {
      number: 6,
      title: 'Connect Discord (2 minutes)',
      summary:
        'A Discord bot turns your phone into a one-tap approval surface for risky tool calls. The built-in Discord adapter posts a DM with Approve / Deny buttons when a policy requires human judgment. Same setup as the Claude Code and Codex paths; ENV-only.',
      codeTitle: '.env.local (or Vercel env vars)',
      codeBody: discordEnvBlock,
      note: 'Step-by-step Discord Developer Portal walkthrough is printed below.',
    },
    {
      number: 7,
      title: 'Run Hermes and trigger a tool call',
      summary:
        'Ask Hermes to do anything that uses Bash, terminal, str_replace_editor, Edit, Write, or MultiEdit. The pre_tool_call hook fires automatically. For policies that require approval, your phone DMs you and Hermes pauses on the dashclaw_wait_for_approval MCP tool until you resolve.',
      codeTitle: 'Example prompt',
      codeBody: 'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note: 'Watch the terminal: you should see [DashClaw] messages as each hook evaluates the action. The pre_llm_call hook also injects pending approvals and active policies into every turn.',
    },
    {
      number: 8,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded under the hermes agent id and that the live-ingest session shows turn-by-turn token counts.',
      note: "Go to /decisions: you should see your tool call with agent_id 'hermes'. Go to /code-sessions: the live session shows per-turn message counts, populated by post_llm_call as the session runs.",
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
- Trigger a Hermes tool call that hits an approval-required policy
- Your phone's Discord app lights up; tap Approve or Deny
- The DM edits in place to show APPROVED or DENIED with timestamp`;

  const hermesNotesBlock = `## Hermes-specific notes

### Hook surface (8 events vs Codex's 3)
Hermes exposes a richer lifecycle than Claude Code or Codex. Beyond
pre/post_tool_call and on_session_{start,end}, DashClaw also wires:

- pre_llm_call: every turn injects active policies + pending approvals
                  + today's action count via Hermes's context-injection
                  contract (5-minute cached)
- post_llm_call: per-turn live ingest to /api/code-sessions/ingest-live
- transform_tool_result: redacts 10 secret-pattern families (Anthropic /
                  OpenAI / AWS / GitHub / Slack / Stripe / JWT / PEM /
                  DashClaw keys) before the model sees tool output
- subagent_stop: records every delegate_task child exit as a DashClaw
                  action with action_type=subagent for the subagent-ROI
                  dashboard

### Live session ingest
post_llm_call pushes turn structure (model, usage, tool calls, assistant
preview, timestamp) to /api/code-sessions/ingest-live every turn. On
session close, on_session_end fires the finalize: true variant which
runs the optimizer + alerts pass on the completed session. Turn-level
attribution is visible immediately in /code-sessions, no waiting for a
Stop hook to flush.

### Secret redaction
transform_tool_result runs every tool output through the same redaction
patterns DashClaw uses in incident reports: Anthropic / OpenAI / AWS /
GitHub / Slack / Stripe API keys, JWTs, PEM private-key blocks, and
DashClaw keys themselves. Never blocks; just substitutes. CodeQL flags
the sys.stdout.write here as clear-text logging because it does not model
the redactor as a sanitizer; confirmed false positive.

### Backing out
Delete the managed block between the # >>> dashclaw start / # <<<
dashclaw end markers in ~/.hermes/config.yaml. A .dashclaw-bak file is
left next to the config on first install for full restore.`;

  const proofMoment =
    "Go to /decisions: you should see your Hermes tool call with agent_id 'hermes'. Go to /code-sessions: the live session shows per-turn token counts and tool calls as they happen.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Hermes Agent Integration Guide - DashClaw',
          description: 'Govern Hermes Agent with DashClaw: per-turn context injection, secret redaction, subagent ROI, and live session ingest in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/hermes',
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
            <span className="text-secondary">Hermes</span>
          </div>

          <GuideClient
            frameworkName="Hermes"
            frameworkIcon="H"
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Hermes-specific notes
            </p>
            <MarkdownBody content={hermesNotesBlock} className="mt-4" />
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
