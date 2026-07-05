import Link from 'next/link';
import {
  ChevronRight,
  ShieldCheck,
  KeyRound,
  Package,
  Plug,
  Terminal,
  Smartphone,
  MessageSquare,
  Send,
  Bot,
  Code,
  ArrowRight,
} from 'lucide-react';

import { headers } from 'next/headers';

import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import HostedProvisionSection from './HostedProvisionSection';
import TrialWorkspaceCard from './TrialWorkspaceCard';
import FirstGovernedActionCard from './FirstGovernedActionCard';
import { getViewerContextFromCookieHeader } from '../lib/sessionViewer.mjs';
import { getSql } from '../lib/db';
import { getHostedWorkspace } from '../lib/repositories/hosted-workspace.repository';

/*
 * Framework agnostic /connect runbook.
 *
 * This page assumes the visitor already has a running DashClaw instance
 * (or links them back to /self-host if they do not). The single job of
 * this page is to get an agent talking to that instance with an
 * approval surface configured.
 *
 * Structure:
 *   1. Get your API key            (env exports)
 *   2. Pick an integration surface (4 cards: SDK, MCP, Claude Code Hooks, OpenClaw)
 *   3. Pick an approval surface    (5 cards: Dashboard default, CLI, Mobile PWA, Discord, Telegram)
 *   4. Verify                       (1 consolidated Verify section)
 *   Framework guides                (5 cards: Claude Code, OpenAI Agents SDK, LangGraph, CrewAI, OpenClaw)
 */

export const metadata = {
  title: 'Connect an agent to DashClaw',
  description:
    'Point any agent at your running DashClaw instance. Pick an integration surface, configure approvals, verify with one command.',
  openGraph: {
    title: 'Connect an agent to DashClaw',
    description:
      'Point any agent at your running DashClaw instance. Pick an integration surface, configure approvals, verify with one command.',
  },
};

interface StepHeaderProps {
  n: React.ReactNode;
  children?: React.ReactNode;
}

function StepHeader({ n, children }: StepHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-7 h-7 rounded-full bg-brand-subtle border border-border-active text-brand text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-text-primary">
        {children}
      </h2>
    </div>
  );
}

interface CodeBlockProps {
  children?: React.ReactNode;
}

function CodeBlock({ children }: CodeBlockProps) {
  return (
    <pre
      tabIndex={0}
      aria-label="Connection command snippet"
      className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-4 text-xs leading-relaxed text-text-secondary font-mono"
    >
      {children}
    </pre>
  );
}

interface EyebrowProps {
  children?: React.ReactNode;
}

function Eyebrow({ children }: EyebrowProps) {
  return (
    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
      {children}
    </p>
  );
}

interface OAuthConnectorCardProps {
  /**
   * When true, renders the keyless hero variant used by the hosted-trial
   * screen: larger heading, no example API key, framed as the first action.
   * When false (default), renders the standard integration-surface card used
   * inside the full runbook.
   */
  hero?: boolean;
}

/**
 * The OAuth custom connector. Keyless: paste the instance `/api/mcp` URL into
 * Claude's Add custom connector, log in, authorize. Used both as the hosted
 * hero and as one of the integration-surface cards in the full runbook, so the
 * JSX lives in one place.
 */
function OAuthConnectorCard({ hero = false }: OAuthConnectorCardProps) {
  if (hero) {
    return (
      <section
        aria-label="Keyless connector"
        className="rounded-2xl border border-border-active bg-surface-secondary p-6 sm:p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={20} className="text-brand" aria-hidden="true" />
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-text-primary">
            Add DashClaw to Claude — no API key
          </h2>
        </div>
        <p className="text-sm sm:text-base text-text-secondary max-w-2xl leading-relaxed">
          Paste your DashClaw instance&apos;s <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[12px] text-text-secondary">/api/mcp</code> URL into Claude&apos;s{' '}
          <span className="text-text-primary">Add custom connector</span>, log in, and
          authorize. No API key needed — the OAuth handshake handles authentication.
        </p>
        <div className="mt-5">
          <CodeBlock>{`https://YOUR-INSTANCE.vercel.app/api/mcp`}</CodeBlock>
          <p className="mt-3 text-xs text-text-tertiary leading-relaxed max-w-2xl">
            In Claude, open <span className="text-text-secondary">Add custom connector</span>,
            paste the URL, click Connect, log in, and Authorize. On plain chat, governance is
            advisory — it records actions and prompts for approval, not a hard block.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound size={16} className="text-brand" aria-hidden="true" />
        <h3 className="text-base font-semibold text-text-primary">Custom connector (Claude app — web / Desktop), OAuth, no key</h3>
      </div>
      <p className="text-sm text-text-secondary leading-relaxed mb-4">
        No API key. Paste your instance URL into Claude&apos;s Add custom connector, then log in and authorize. Free tier allows one connector. On plain chat, governance is advisory — it records actions and prompts for approval, not a hard block.
      </p>
      <div className="mt-auto">
        <CodeBlock>{`https://YOUR-INSTANCE.vercel.app/api/mcp`}</CodeBlock>
        <p className="mt-3 text-[11px] text-text-tertiary leading-relaxed">
          In Claude, open Add custom connector, paste the URL, click Connect, log in, and Authorize.
        </p>
        <a
          href="https://github.com/ucsandman/DashClaw/blob/main/docs/CLAUDE-DESKTOP-PLUGIN.md"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium"
        >
          Claude app connector guide <ArrowRight size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

interface FullConnectGuideProps {
  showBreadcrumb?: boolean;
}

/**
 * The full framework-agnostic runbook. This is the entire body the page has
 * always rendered; the non-hosted variant renders it verbatim, and the hosted
 * variant tucks it under an "Advanced (SDK / CLI)" disclosure.
 *
 * showBreadcrumb (default true) — set to false when rendering inside the
 * hosted <details> disclosure, where the outer page already renders its own
 * <nav aria-label="Breadcrumb">, to avoid two identically-named landmarks.
 */
function FullConnectGuide({ showBreadcrumb = true }: FullConnectGuideProps = {}) {
  return (
    <>
      {/* Breadcrumb — omitted when a parent context already renders one */}
      {showBreadcrumb && (
        <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-text-tertiary">
          <Link href="/" className="transition-colors hover:text-text-secondary">
            Home
          </Link>
          <ChevronRight size={14} aria-hidden="true" />
          <span className="text-text-secondary">Connect an Agent</span>
        </nav>
      )}

          {/* Hero */}
          <header className="mb-10">
            <Eyebrow>Connect an agent</Eyebrow>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight text-text-primary">
              Point your agent at your running DashClaw instance.
            </h1>
            <p className="mt-5 text-lg text-text-secondary max-w-2xl leading-relaxed">
              Pick an integration surface, configure an approval surface, verify with one command. Works with any agent framework that can call an HTTP API or an SDK.
            </p>

            {/* Prerequisite band */}
            <div className="mt-8 rounded-2xl border border-border-active bg-brand-subtle/40 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-subtle border border-border-active flex items-center justify-center shrink-0">
                    <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    <span className="font-semibold text-text-primary">Before you start, you need a running DashClaw instance.</span>{' '}
                    If you do not have one yet, stand it up first. Takes about 10 minutes on Vercel and Neon free tiers.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                  <Link
                    href="/self-host"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-colors"
                  >
                    Self host the runtime <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <Link
                    href="/#live-demo"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-surface-secondary border border-border text-text-secondary text-sm font-medium hover:border-border-hover hover:text-text-primary transition-colors"
                  >
                    Explore the live demo <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>

            <p className="mt-5 text-sm text-text-tertiary italic max-w-2xl">
              First connection takes 5 to 15 minutes depending on the integration surface you pick.
            </p>
          </header>

          {/* Step 1: API key */}
          <section className="mt-10 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={1}>Get your API key</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              From your DashClaw instance settings, copy your API key. It starts with{' '}
              <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[12px] text-text-secondary">oc_live_</code>{' '}
              for self hosted instances. Export it alongside your instance URL:
            </p>
            <div className="mt-4">
              <CodeBlock>{`export DASHCLAW_BASE_URL=https://your-instance.vercel.app
export DASHCLAW_API_KEY=oc_live_...`}</CodeBlock>
            </div>
            <p className="mt-4 text-xs text-text-tertiary leading-relaxed max-w-2xl">
              Never use{' '}
              <code className="rounded border border-border bg-surface-primary px-1 py-0.5 font-mono text-[11px] text-text-secondary">https://dashclaw.io</code>{' '}
              as your agent base URL. Point at your own instance. The dashclaw.io deployment runs in demo mode and rejects writes.
            </p>
          </section>

          {/* Step 2: Integration surface */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={2}>Pick an integration surface</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              Five ways to plug an agent into DashClaw. Pick one. All five hit the same governance loop on the same instance, so you can switch later without changing anything else.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* SDK */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Package size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">SDK</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Node.js or Python. Wrap risky actions in <code className="font-mono text-text-primary">claw.guard()</code> and you are done.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`# Node
npm install dashclaw

# Python
pip install dashclaw`}</CodeBlock>
                  <Link href="/docs" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Full SDK docs <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* MCP Server */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Plug size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">MCP Server</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Zero code. Any MCP compatible client (Claude Code, Claude Desktop, Claude Managed Agents) gets governance through one config block.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npx @dashclaw/mcp-server \\
  --url $DASHCLAW_BASE_URL \\
  --key $DASHCLAW_API_KEY`}</CodeBlock>
                  <Link href="/docs#mcp-server" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    MCP server docs <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* Claude Code Hooks */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Code size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Claude Code Hooks</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Two Python files dropped into{' '}
                  <code className="font-mono text-text-primary">.claude/hooks/</code>. Governs Bash, Edit, Write, MultiEdit, sub-agent spawns, and MCP tool calls (mcp__*) such as Gmail/Stripe/Calendar sends. Safe to ship even without DashClaw configured.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`cp hooks/dashclaw_*.py .claude/hooks/`}</CodeBlock>
                  <Link href="/guides/claude-code" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Claude Code guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* OpenClaw Plugin */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Bot size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">OpenClaw Plugin</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Framework native plugin for OpenClaw agents. Intercepts PreToolUse and PostToolUse, runs guard, records the outcome, and waits for approval automatically.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm install @dashclaw/openclaw-plugin`}</CodeBlock>
                  <Link href="/guides/openclaw" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    OpenClaw plugin guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* OAuth custom connector */}
              <OAuthConnectorCard />
            </div>
          </section>

          {/* Step 3: Approval surface */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={3}>Pick an approval surface</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              When guard returns{' '}
              <code className="font-mono text-text-primary">require_approval</code>, the action pauses until a human resolves it — or the approval expires. An expired approval is a distinct third outcome (<code className="font-mono text-text-primary">err.status === &apos;expired&apos;</code> from <code className="font-mono text-text-primary">waitForApproval</code>) and can never release held work. Pick where humans should see and resolve those approvals. Dashboard is on by default. The other four are optional and additive.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Dashboard (default) */}
              <div className="rounded-xl border border-border-active bg-brand-subtle/20 p-5 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-brand" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-text-primary">Dashboard</h3>
                  </div>
                  <span className="rounded-md border border-border-active bg-brand-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
                    Default
                  </span>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Always on. Interactive queue with triggering policy, risk score, and replay link.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`https://<your-instance>/approvals`}</CodeBlock>
                </div>
              </div>

              {/* CLI */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Terminal size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">CLI</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  For terminal first developers.{' '}
                  <code className="font-mono text-text-primary">dashclaw approve</code> and{' '}
                  <code className="font-mono text-text-primary">dashclaw deny</code> against the same governance endpoint.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm install -g @dashclaw/cli
dashclaw approvals`}</CodeBlock>
                </div>
              </div>

              {/* Mobile PWA */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Mobile PWA</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Add <code className="font-mono text-text-primary">/approve</code> to your home screen on iOS or Android. One tap Allow or Deny from the phone. SSE driven, updates within about one second.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`https://<your-instance>/approve`}</CodeBlock>
                </div>
              </div>

              {/* Discord */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Discord bot</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Phone first via DM. Inline Approve and Deny buttons in a registered user DM. Fire and forget; action creation succeeds even if Discord is unreachable.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`DISCORD_BOT_TOKEN=<bot-token>
DISCORD_APPROVER_USER_ID=<your-discord-user-id>
DISCORD_APPROVER_ORG_ID=<your-org-id>
DISCORD_PUBLIC_KEY=<discord-app-public-key>`}</CodeBlock>
                  <p className="mt-3 text-[11px] text-text-tertiary leading-relaxed">
                    Also set the Interactions Endpoint URL in the Discord Developer Portal to{' '}
                    <code className="font-mono text-text-secondary">https://&lt;your-instance&gt;/api/discord/interactions</code>.
                  </p>
                  <Link href="/guides/discord-approvals" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Discord approvals guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {/* Telegram */}
              <div className="rounded-xl border border-border bg-surface-tertiary p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <Send size={16} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Telegram bot</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">
                  Inline Approve and Deny buttons pushed to an admin chat. Warns and moves on if Telegram is unreachable.
                </p>
                <div className="mt-auto">
                  <CodeBlock>{`npm run telegram:setup`}</CodeBlock>
                  <Link href="/self-host#approve-from-anywhere" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover transition-colors font-medium">
                    Telegram setup guide <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Step 4: Verify */}
          <section className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <StepHeader n={4}>Verify</StepHeader>
            <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
              Run{' '}
              <code className="font-mono text-text-primary">dashclaw doctor</code>{' '}
              from any terminal. Exit 0 means the instance is healthy and your SDK or surface is reachable. Then have your agent attempt a low risk action and watch it land in the dashboard inbox.
            </p>
            <p className="mt-3 text-sm text-text-secondary max-w-2xl leading-relaxed">
              Expected proof: <code className="font-mono text-text-primary">dashclaw doctor</code>{' '}
              exits 0 or names the blocker, <code className="font-mono text-text-primary">/decisions</code>{' '}
              shows the action record, <code className="font-mono text-text-primary">/approvals</code>{' '}
              shows any held action, and <code className="font-mono text-text-primary">/api/setup/live-proof</code>{' '}
              can capture setup evidence for onboarding or CI.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-tertiary p-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">From any terminal</div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">dashclaw doctor</h3>
                <p className="text-xs text-text-secondary leading-relaxed mb-3">
                  Diagnoses your instance and this machine. Report-only by default; --fix applies safe repairs and prints what changed.
                </p>
                <CodeBlock>{`npm install -g @dashclaw/cli
dashclaw doctor`}</CodeBlock>
              </div>
              <div className="rounded-xl border border-border bg-surface-tertiary p-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">Self host operator</div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">npm run doctor</h3>
                <p className="text-xs text-text-secondary leading-relaxed mb-3">
                  Adds filesystem level fixes (env writes, migrations, default policy seed). Backs up{' '}
                  <code className="font-mono text-text-primary">.env</code>{' '}
                  before any write.
                </p>
                <CodeBlock>{`npm run doctor`}</CodeBlock>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-text-tertiary leading-relaxed">
              Exit codes: <code className="font-mono text-text-secondary">0</code> healthy,{' '}
              <code className="font-mono text-text-secondary">1</code> warnings or unreachable. Add{' '}
              <code className="font-mono text-text-secondary">--json</code> for CI integration.
            </p>

            <div className="mt-5 rounded-xl border border-border bg-surface-tertiary p-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">If it doesn&apos;t connect</div>
              <ul className="space-y-2 text-xs text-text-secondary leading-relaxed">
                <li>
                  · The MCP server reads{' '}
                  <code className="font-mono text-text-primary">DASHCLAW_URL</code>{' '}
                  while the hooks read{' '}
                  <code className="font-mono text-text-primary">DASHCLAW_BASE_URL</code>{' '}
                  — set both to your instance URL. The SDK takes the URL as a constructor
                  option (<code className="font-mono text-text-primary">baseUrl</code>), as in the snippets above.
                </li>
                <li>
                  · <code className="font-mono text-text-primary">401 Invalid or missing API key</code>{' '}
                  right after a deploy or update usually means the DB schema is behind — run{' '}
                  <code className="font-mono text-text-primary">npm run db:migrate</code>{' '}
                  on the host.
                </li>
                <li>
                  · Never point an agent at the demo deployment (e.g.{' '}
                  <code className="font-mono text-text-primary">dashclaw.io</code>) — it rejects writes. Use your own instance.
                </li>
                <li>
                  · Hook not firing? Re-run{' '}
                  <code className="font-mono text-text-primary">npm run hooks:install</code>{' '}
                  and confirm the matcher in{' '}
                  <code className="font-mono text-text-primary">.claude/settings.json</code>{' '}
                  includes <code className="font-mono text-text-primary">mcp__.*</code>.
                </li>
              </ul>
            </div>
          </section>

          {/* Framework guides */}
          <section className="mt-10 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
            <Eyebrow>Framework guides</Eyebrow>
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              Step by step walkthroughs for popular frameworks
            </h2>
            <p className="mt-3 text-sm text-text-secondary max-w-2xl leading-relaxed">
              Deeper walkthroughs once you have picked a surface in Step 2. Each takes 10 to 20 minutes end to end.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  href: '/guides/claude-code',
                  title: 'Claude Code',
                  desc: 'Govern Bash, Edit, Write, MultiEdit, sub-agent spawns, and MCP tool calls (mcp__*) via PreToolUse hooks. Zero SDK code required.',
                },
                {
                  href: '/guides/codex',
                  title: 'Codex',
                  desc: 'One dashclaw install codex command wires the same PreToolUse / PostToolUse / Stop hooks into ~/.codex/config.toml.',
                },
                {
                  href: '/guides/hermes',
                  title: 'Hermes Agent',
                  desc: 'Eight lifecycle hooks: pre/post tool, pre/post LLM call with per-turn context injection, on session start/end, transform tool result redaction, and subagent_stop ROI tracking.',
                },
                {
                  href: '/guides/openai-agents-sdk',
                  title: 'OpenAI Agents SDK',
                  desc: 'Add guard, record, and outcome governance to your OpenAI agent tools with the Node.js SDK.',
                },
                {
                  href: '/guides/langgraph',
                  title: 'LangGraph',
                  desc: 'Add a governance node to your LangGraph StateGraph with the Python SDK. Includes a runnable example.',
                },
                {
                  href: '/guides/crewai',
                  title: 'CrewAI',
                  desc: 'Govern CrewAI tool calls using the @tool decorator pattern with the Python SDK. Includes a runnable example.',
                },
                {
                  href: '/guides/openclaw',
                  title: 'OpenClaw',
                  desc: 'Framework native plugin. Intercepts PreToolUse and PostToolUse and calls guard, record, and waitForApproval automatically.',
                },
              ].map((g) => (
                <Link
                  key={g.href}
                  href={g.href}
                  className="group rounded-xl border border-border bg-surface-tertiary p-5 transition-colors hover:border-border-active"
                >
                  <h3 className="text-base font-semibold text-text-primary transition-colors group-hover:text-brand">
                    {g.title}
                  </h3>
                  <p className="mt-2 text-sm text-text-secondary leading-relaxed">{g.desc}</p>
                </Link>
              ))}
            </div>
          </section>
    </>
  );
}

interface ConnectPageProps {
  searchParams?: Promise<{ hosted?: string; trial?: string }>;
}

// v5.1: /connect is unmatched by middleware (public), so the page resolves
// the trial session itself from the cookie header — the same self-serve
// pattern /settings uses. Returns the live trial org or null; every failure
// (no cookie, bad signature, expired JWT, org cleaned up, DB error) is just
// "no card".
async function getTrialWorkspaceForViewer(): Promise<Record<string, unknown> | null> {
  // /connect is a public, high-traffic page served on non-hosted hosts too
  // (marketing/demo, every self-host). getTrialViewer can only ever match on
  // a hosted instance, so short-circuit before doing any cookie/JWT/DB work.
  if (process.env.DASHCLAW_HOSTED !== 'true') return null;
  try {
    const headerStore = await headers();
    const cookieHeader = headerStore.get('cookie') || '';
    const viewer = await getViewerContextFromCookieHeader(cookieHeader, process.env);
    if (viewer.authType !== 'trial') return null;
    const orgId = (viewer.session as { orgId?: string }).orgId;
    if (!orgId) return null;
    const org = await getHostedWorkspace(getSql(), orgId);
    return org && org.hostedMode ? org : null;
  } catch {
    return null;
  }
}

function TrialExpiredNotice() {
  return (
    <section className="mb-10 rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
        Trial ended
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
        This trial workspace is no longer available.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-text-secondary leading-relaxed">
        Trial workspaces are time-boxed and removed after they expire, along
        with their data. You can mint a fresh workspace below and be governing
        an agent again in under a minute.
      </p>
    </section>
  );
}

export default async function ConnectPage({ searchParams }: ConnectPageProps = {}) {
  const params = await searchParams;
  const hosted = typeof params?.hosted === 'string' && params.hosted ? params.hosted : undefined;

  if (hosted) {
    return (
      <div className="min-h-screen bg-surface-primary text-text-primary">
        <PublicNavbar />

        <main className="px-6 pb-20 pt-28">
          <div className="mx-auto max-w-3xl">
            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" className="mb-8 flex items-center gap-2 text-sm text-text-tertiary">
              <Link href="/" className="transition-colors hover:text-text-secondary">
                Home
              </Link>
              <ChevronRight size={14} aria-hidden="true" />
              <span className="text-text-secondary">Connect an Agent</span>
            </nav>

            {/* Hero */}
            <header className="mb-8">
              <Eyebrow>Your trial is ready</Eyebrow>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-text-primary">
                Connect Claude in two minutes.
              </h1>
              <p className="mt-4 text-lg text-text-secondary max-w-2xl leading-relaxed">
                One keyless step gets your agent governed. No install, no key to manage — just
                authorize the connector and watch governed actions land.
              </p>
            </header>

            {/* Keyless connector — the only first-class step */}
            <OAuthConnectorCard hero />

            {/* Mission Control */}
            <div className="mt-6 rounded-2xl border border-border bg-surface-secondary p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={20} className="text-brand" aria-hidden="true" />
                <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                  Watch it work
                </h2>
              </div>
              <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
                Once Claude acts, every governed decision shows up in Mission Control — the action,
                the policy that fired, and anything waiting on your approval.
              </p>
              <Link
                href="/mission-control"
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-colors"
              >
                Open Mission Control <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>

            {/* Advanced — the full SDK / CLI runbook, collapsed */}
            <details className="group mt-6 rounded-2xl border border-border bg-surface-secondary">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 sm:px-8">
                <span className="flex items-center gap-2">
                  <Terminal size={18} className="text-text-tertiary" aria-hidden="true" />
                  <span className="text-base font-semibold text-text-primary">Advanced (SDK / CLI)</span>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-text-tertiary">
                  SDK, hooks, API keys, approval surfaces
                  <ChevronRight
                    size={16}
                    aria-hidden="true"
                    className="transition-transform group-open:rotate-90"
                  />
                </span>
              </summary>
              <div className="border-t border-border px-6 pb-2 sm:px-8">
                <p className="mt-5 text-sm text-text-secondary leading-relaxed max-w-2xl">
                  Prefer the SDK, hooks, or a CLI? Mint an API key from{' '}
                  <Link href="/api-keys" className="text-brand hover:text-brand-hover transition-colors font-medium">
                    API keys
                  </Link>{' '}
                  (shown once at creation), then follow the full runbook below.
                </p>
                <FullConnectGuide showBreadcrumb={false} />
              </div>
            </details>
          </div>
        </main>

        <PublicFooter />
      </div>
    );
  }

  // The trial-aware surfaces only appear on the plain /connect page (not the
  // ?hosted post-mint landing above), so resolve the trial session here —
  // one lookup, and only on the path that uses it.
  const trialExpired = params?.trial === 'expired';
  const trialWorkspace = await getTrialWorkspaceForViewer();

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          {/* v5.1: an unusable trial session landed here via the middleware
              redirect — say so honestly; the mint section below is the path
              back in. */}
          {trialExpired && !trialWorkspace ? <TrialExpiredNotice /> : null}
          {/* v5.1: returning trial user — their workspace, one click away. */}
          {trialWorkspace ? (
            <>
              <TrialWorkspaceCard
                orgId={String(trialWorkspace.orgId)}
                trialEndsAt={trialWorkspace.trialEndsAt ? String(trialWorkspace.trialEndsAt) : null}
                trialActionCap={trialWorkspace.trialActionCap == null ? null : Number(trialWorkspace.trialActionCap)}
                trialActionsUsed={trialWorkspace.trialActionsUsed == null ? null : Number(trialWorkspace.trialActionsUsed)}
              />
              {/* v5.2: the activation step itself — one governed action from
                  the browser, riding the trial session. Only ever rendered in
                  this branch, so anonymous visitors, operators, and self-host
                  instances never see it. */}
              <FirstGovernedActionCard />
            </>
          ) : null}
          {/* Hosted instances only: anonymous trial mint (Turnstile-gated).
              Renders nothing when DASHCLAW_HOSTED is unset (self-host).
              Always rendered — even for a signed-in trial visitor — so a
              trial that has become unusable (e.g. hit its action cap, which
              blocks minting a replacement key) always has a working way
              forward: mint a fresh workspace. The global/per-IP mint caps,
              not this page, are what bound abuse. */}
          <HostedProvisionSection />
          <FullConnectGuide />
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
