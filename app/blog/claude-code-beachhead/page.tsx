/**
 * /blog/claude-code-beachhead — DashClaw flagship launch post (DOG-04).
 *
 * Added by Plan 03-02. Source of truth: docs/launch/blog-post.md.
 *
 * Design: CSS tokens only per .impeccable.md. No hardcoded hex in this
 * file. Brand orange is signal — applied only on the trigger number in
 * the commitment section.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Govern Claude Code before it surprises you: DashClaw',
  description:
    'DashClaw installs a PreToolUse checkpoint for supported Claude Code tool categories, routes policy holds to human approval, and records decision evidence.',
  path: '/blog/claude-code-beachhead',
  ogType: 'article',
});

export default function BlogPostPage() {
  return (
    <div className="space-y-6 text-text-primary">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'Govern Claude Code before it surprises you: DashClaw',
          description: 'DashClaw installs a PreToolUse checkpoint for supported Claude Code tool categories, routes policy holds to human approval, and records decision evidence.',
          url: 'https://www.dashclaw.io/blog/claude-code-beachhead',
          datePublished: '2026-04-22',
          publisher: { '@type': 'Organization', name: 'DashClaw', url: 'https://www.dashclaw.io' },
        }}
      />
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
          Launch post · Claude Code Beachhead
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Govern Claude Code before it surprises you
        </h1>
        <p className="mt-4 text-base text-text-secondary">
          A PreToolUse hook that checks configured Bash, Edit, Write,
          MultiEdit, and MCP tool categories before execution. Policy-matched
          actions can pause for approval. I tap Approve or Deny, and the hook
          observes the server-side decision.
        </p>
      </header>

      <section>
        <h2 className="mt-6 text-xl font-semibold tracking-tight">
          The problem
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          Claude Code is fast. Most of the time that is exactly what I
          want. Some of the time it is not. In the past few months it has
          rm -rf&apos;d a node_modules I actually needed for a different
          checkout, force-pushed to main after a rebase I had not
          finished reviewing, and installed a package I had not vetted
          because an upstream snippet suggested it.
        </p>
        <p className="mt-3 text-base text-text-secondary">
          None of these are the agent&apos;s fault. The agent did what I
          told it to do, and sometimes what I told it to do was too
          broad. The question is not &quot;how do I make the agent
          smarter&quot;; the question is &quot;how do I keep a small
          number of specific actions from running without me
          knowing.&quot;
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          Try the current demo
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          The home page has a live guard demo using the current decision
          shape. It shows policy results and the approval flow without
          relying on the retired launch video.
          {' '}<Link href="/#live-demo" className="text-text-primary underline decoration-border hover:decoration-text-primary">Run the live demo</Link>.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          DashClaw registers a PreToolUse hook on your Claude Code
          install. Configured, supported Bash, Edit, Write, MultiEdit, and
          mcp__* calls go through a policy check before they run. Three steps:
        </p>
        <ol className="mt-4 space-y-2 text-base text-text-secondary">
          <li>
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              npm install &amp;&amp; npm run hooks:install
            </code>{' '}
            wires the hook into{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              ~/.claude/settings.json
            </code>
            .
          </li>
          <li>
            Paste a workspace token from{' '}
            <Link
              href="/connect"
              className="text-text-primary underline decoration-border hover:decoration-text-primary"
            >
              /connect
            </Link>
            . That is the API key my deployment uses to recognize this
            laptop.
          </li>
          <li>
            Configure Discord: pick a server, pick a channel, drop in a
            bot token. I use my own account; you use yours.
          </li>
        </ol>
        <p className="mt-3 text-base text-text-secondary">
          Three commands and one paste. The Claude Code → DashClaw →
          Discord → phone loop is the only thing on the critical path.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          What&apos;s free
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          The core runtime is MIT licensed and self-hostable. That includes:
        </p>
        <ul className="mt-4 space-y-2 text-base text-text-secondary">
          <li>
            · The PreToolUse hook and the{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              claude-code-starter
            </code>{' '}
            policy pack.
          </li>
          <li>· Discord and Telegram approval bridges.</li>
          <li>
            · The{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /decisions
            </code>{' '}
            ledger with explicit identity verification, payload-signature,
            and receipt status on recorded decisions.
          </li>
          <li>
            · Optional semantic guard integrations using your own provider key.
          </li>
          <li>
            · The{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /activity
            </code>{' '}
            and{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /my-agent
            </code>{' '}
            surfaces, where I check what the agent did today without
            scrolling through a terminal.
          </li>
        </ul>
        <p className="mt-3 text-base text-text-secondary">
          I self-host on Vercel free tier. Postgres on Neon free tier.
          Zero SaaS subscription. Deploy button on the GitHub repo.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          What broke and what I fixed
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          Two things bit me early and both shipped fixes you will never
          see directly:
        </p>
        <ul className="mt-4 space-y-3 text-base text-text-secondary">
          <li>
            <strong className="text-text-primary">CSP blocked the embed.</strong>{' '}
            The first time I put a Loom iframe on the homepage, Chrome
            refused to render it because my frame-src directive was self.
            Fixed by explicitly allowlisting loom.com and
            youtube-nocookie.com in next.config.js, and by having the
            embed component itself throw if someone tries a third host.
          </li>
          <li>
            <strong className="text-text-primary">
              The hook silently failed open when the guard was
              unreachable.
            </strong>{' '}
            If my deployment was down, a destructive action would
            just… run. Fixed with a block / warn / allow policy knob
            that defaults to block, plus an orphan-actions journal. Calls that
            reach the unavailable-guard handler are recorded locally and can be
            reconciled when the guard recovers.
          </li>
        </ul>
        <p className="mt-3 text-base text-text-secondary">
          Both of these are the kinds of things you only find by running
          DashClaw on your own laptop every day.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          What&apos;s next
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          I&apos;m building the rest of DashClaw&apos;s growth loop
          under DashClaw-governed agents. Research, content drafts,
          monitoring: each one is a Claude Code session with policies
          the public can read. The ledger adds evidence for the paths that
          reported to DashClaw. It does not prove unobserved external behavior.
        </p>
        <p className="mt-3 text-base text-text-secondary">
          Public status page coming. The first one will be a live board
          of how many Claude Code integrations are active this week,
          which policies fired most, and which denials I had to override
          because my own policy was wrong.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          Try it
        </h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 font-mono text-sm text-text-secondary">
          <code>{`npm install
npm run hooks:install
# then open /connect for the workspace token + Discord setup`}</code>
        </pre>
        <p className="mt-3 text-base text-text-secondary">
          Three commands. The guide walks you through the rest:{' '}
          <Link
            href="/guides/claude-code"
            className="text-text-primary underline decoration-border hover:decoration-text-primary"
          >
            /guides/claude-code
          </Link>
          .
        </p>
        <p className="mt-3 text-base text-text-secondary">
          If something breaks, open an issue on GitHub. I read all of
          them.
        </p>
      </section>
    </div>
  );
}
