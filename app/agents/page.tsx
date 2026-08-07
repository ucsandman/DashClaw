import Link from 'next/link';
import { ChevronRight, Bot, AlertTriangle } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import type { Metadata } from 'next';
import { marketingPageMetadata, MARKETING_ORIGIN } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw for AI Agents: the zero-human setup runbook',
  description:
    'Point your coding agent at this page and it can install DashClaw end to end: one non-interactive command, credentials on disk, verification built in.',
  path: '/agents',
});

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-6 border-b border-border last:border-b-0">
      <h2 className="text-lg font-semibold text-text-primary mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-text-secondary leading-relaxed">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="rounded-lg border border-border bg-surface-secondary p-4 text-sm font-mono text-text-primary overflow-x-auto">
      <code>{children}</code>
    </pre>
  );
}

export default function AgentsPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <section className="pt-28 pb-8 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-primary">For AI agents</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <Bot size={20} className="text-brand" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Set up DashClaw with zero human steps</h1>
              <p className="mt-2 text-text-secondary leading-relaxed">
                This page is written for the AI agent doing the install. Humans: paste the
                one-liner below into your agent and come back when it hands you the Approvals URL.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="px-6 pb-16">
        <div className="max-w-3xl mx-auto">
          <Section id="tell-your-agent" title="Humans: tell your agent this">
            <CodeBlock>{`Get DashClaw set up for me. Read ${MARKETING_ORIGIN}/llms.txt and follow its setup runbook.`}</CodeBlock>
            <p>
              That is the whole job. The agent installs the runtime, verifies it, and tells you
              where your Approvals inbox is. Machine-readable version of everything below:{' '}
              <a href="/llms.txt" className="text-brand hover:underline">/llms.txt</a>.
            </p>
          </Section>

          <Section id="runbook" title="Agents: the one command that works non-interactively">
            <CodeBlock>{'npx dashclaw up --yes --no-browser'}</CodeBlock>
            <p>
              Needs Node 18+ and a terminal. No account, no OAuth, no browser, no LLM API key.
              It installs the runtime to <code className="font-mono text-text-primary">~/.dashclaw</code>,
              provisions Postgres (Docker if available, embedded otherwise), generates secrets,
              applies migrations, mints the workspace API key, and starts the dashboard on{' '}
              <code className="font-mono text-text-primary">http://localhost:3000</code>.
            </p>
            <p>
              Plain <code className="font-mono text-text-primary">npx dashclaw up</code> prompts
              interactively and will hang a non-interactive shell. Always pass{' '}
              <code className="font-mono text-text-primary">--yes --no-browser</code> when the
              agent is the one running it.
            </p>
            <p>
              Credentials land on disk, not in chat: the API key in{' '}
              <code className="font-mono text-text-primary">~/.dashclaw/instance.json</code>, the
              dashboard admin password printed once to stdout and saved to the{' '}
              <code className="font-mono text-text-primary">.env.local</code> under{' '}
              <code className="font-mono text-text-primary">~/.dashclaw</code>.
            </p>
          </Section>

          <Section id="verify" title="Verify before declaring success">
            <CodeBlock>{'curl -fsS http://localhost:3000/api/health\nnpx dashclaw doctor'}</CodeBlock>
            <p>
              Both must pass. Then hand the human their side of the loop:{' '}
              <code className="font-mono text-text-primary">http://localhost:3000/approvals</code>{' '}
              — the inbox where held actions wait for one-click approval.
            </p>
          </Section>

          <Section id="runtimes" title="Connect the runtime">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <span className="text-text-primary font-medium">Claude Code.</span>{' '}
                <code className="font-mono">up --yes</code> wires the hooks into{' '}
                <code className="font-mono">~/.claude/settings.json</code> automatically (needs{' '}
                <code className="font-mono">python3</code> or <code className="font-mono">python</code>{' '}
                on PATH). Manual: <code className="font-mono">npx dashclaw install claude</code>.
              </li>
              <li>
                <span className="text-text-primary font-medium">Codex.</span>{' '}
                <code className="font-mono">npx dashclaw install codex</code>.
              </li>
              <li>
                <span className="text-text-primary font-medium">MCP hosts.</span>{' '}
                <code className="font-mono">npx @dashclaw/mcp-server</code> with{' '}
                <code className="font-mono">DASHCLAW_URL</code> and{' '}
                <code className="font-mono">DASHCLAW_API_KEY</code>.
              </li>
              <li>
                <span className="text-text-primary font-medium">SDKs.</span>{' '}
                <code className="font-mono">npm install dashclaw</code> or{' '}
                <code className="font-mono">pip install dashclaw</code>. Full runtime matrix:{' '}
                <Link href="/guides/platform" className="text-brand hover:underline">platform guide</Link>.
              </li>
            </ul>
          </Section>

          <Section id="hosted" title="The one door agents cannot open">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-4">
              <AlertTriangle size={18} className="text-status-warning shrink-0 mt-0.5" />
              <p>
                The hosted trial mints workspaces behind a Cloudflare Turnstile captcha. An agent
                cannot pass it, by design. If the human wants hosted instead of self-host, the
                agent hands them{' '}
                <a href="https://hosted.dashclaw.io/connect" className="text-brand hover:underline">
                  hosted.dashclaw.io/connect
                </a>{' '}
                and asks for the minted key back — into an env file, never into chat.
              </p>
            </div>
          </Section>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
