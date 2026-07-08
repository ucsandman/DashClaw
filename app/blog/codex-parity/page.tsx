/**
 * /blog/codex-parity — Codex parity launch post.
 *
 * Added by the Codex parity phase. Same governance surface DashClaw shipped
 * for Claude Code now runs for OpenAI Codex CLI: PreToolUse hooks, MCP
 * server, AGENTS.md governance protocol, JSONL session ingest. The post
 * focuses on "what changed in DashClaw to support Codex" — narrower scope
 * than the beachhead post because the beachhead already established the
 * "why."
 *
 * Design: CSS tokens only per .impeccable.md.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw now governs Codex: same surface, same audit ledger',
  description:
    "Codex's hook schema is field-compatible with Claude Code's. One `dashclaw install codex` and every Codex tool call is governed.",
  path: '/blog/codex-parity',
  ogType: 'article',
});

export default function BlogPostPage() {
  return (
    <div className="space-y-6 text-text-primary">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'DashClaw now governs Codex: same surface, same audit ledger',
          description: "Codex's hook schema is field-compatible with Claude Code's. One `dashclaw install codex` and every Codex tool call is governed.",
          url: 'https://www.dashclaw.io/blog/codex-parity',
          datePublished: '2026-05-14',
          publisher: { '@type': 'Organization', name: 'DashClaw', url: 'https://www.dashclaw.io' },
        }}
      />
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
          Update · Codex parity
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          DashClaw now governs Codex
        </h1>
        <p className="mt-4 text-base text-text-secondary">
          One install command. The same PreToolUse / PostToolUse / Stop
          hooks. The same Discord approval round-trip. The decision ledger
          shows Codex actions next to Claude Code actions, with{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            agent_id
          </code>{' '}
          telling you which agent did what.
        </p>
      </header>

      <section>
        <h2 className="mt-6 text-xl font-semibold tracking-tight">
          The unlock
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          Codex&apos;s hook event schema (PreToolUse, PostToolUse,
          SessionStart, UserPromptSubmit, Stop, PermissionRequest) is
          field-compatible with Claude Code&apos;s. Same JSON shape on
          stdin:{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            tool_name
          </code>
          ,{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            tool_input
          </code>
          ,{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            tool_use_id
          </code>
          . Same exit-code-2 semantics for block. The Python hooks
          DashClaw already ships for Claude Code run unchanged under
          Codex.
        </p>
        <p className="mt-3 text-base text-text-secondary">
          What was missing was the wiring. Codex stores its config in{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            ~/.codex/config.toml
          </code>{' '}
          (TOML, not JSON), uses{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            AGENTS.md
          </code>{' '}
          where Claude uses{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            CLAUDE.md
          </code>
          , and ships its own MCP and notify configs. The new{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            dashclaw install codex
          </code>{' '}
          command handles all of it.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          What the installer does
        </h2>
        <ol className="mt-4 space-y-3 text-base text-text-secondary">
          <li>
            <strong className="text-text-primary">Copies the hooks.</strong>{' '}
            The same{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_pretool.py
            </code>{' '}
            /{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_posttool.py
            </code>{' '}
            /{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_stop.py
            </code>{' '}
            scripts plus the vendored{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_agent_intel
            </code>{' '}
            module go into{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              ~/.codex/hooks/dashclaw/
            </code>
            .
          </li>
          <li>
            <strong className="text-text-primary">Merges config.toml.</strong>{' '}
            A managed block, bracketed by{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              # &gt;&gt;&gt; dashclaw start
            </code>{' '}
            /{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              # &lt;&lt;&lt; dashclaw end
            </code>{' '}
            , registers the DashClaw MCP server, the three hook events,
            and sets{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              approval_policy = &quot;on-request&quot;
            </code>{' '}
            so Codex surfaces DashClaw&apos;s{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              require_approval
            </code>{' '}
            decisions through its normal approval prompt. Your existing
            config outside the block is preserved verbatim, and a{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              .dashclaw-bak
            </code>{' '}
            sits next to it on first install.
          </li>
          <li>
            <strong className="text-text-primary">Drops the protocol into AGENTS.md.</strong>{' '}
            The governance protocol: when to call{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_guard
            </code>
            , how to handle each of the four decisions, when to call{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_record
            </code>{' '}
            , gets merged into your project&apos;s{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              AGENTS.md
            </code>
            . Same managed-block strategy. Anything you wrote stays.
          </li>
        </ol>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          Session analytics
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          Codex writes session rollouts to{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            ~/.codex/sessions/rollout-&lt;ts&gt;-&lt;uuid&gt;.jsonl
          </code>
          . A new{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            dashclaw code ingest-codex
          </code>{' '}
          subcommand parses them, including reasoning tokens and cached
          input tokens, which Codex tracks separately from Claude, and
          writes normalized session JSON to{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            ~/.dashclaw/codex-sessions/
          </code>{' '}
          for batch upload.
        </p>
        <p className="mt-3 text-base text-text-secondary">
          Server-side codex session ingestion lands in the next release.
          For now the parser and CLI are ready; sessions accumulate on
          disk waiting for the server endpoint.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          What stays the same
        </h2>
        <ul className="mt-4 space-y-2 text-base text-text-secondary">
          <li>
            · Same{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /decisions
            </code>{' '}
            ledger. Codex actions land alongside Claude Code actions with{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              agent_id = &quot;codex&quot;
            </code>
            .
          </li>
          <li>· Same Discord and Telegram approval bridges.</li>
          <li>· Same{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_wait_for_approval
            </code>{' '}
            MCP tool: Codex blocks on it the same way Claude Code does.
          </li>
          <li>· Same policy packs. No Codex-specific policies to write.</li>
          <li>
            · Free for everyone, no tier gating. DashClaw is an
            open-source project: there is no pricing surface and no
            Pro plan.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          Try it
        </h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 font-mono text-sm text-text-secondary">
          <code>{`node /path/to/DashClaw/cli/bin/dashclaw.js install codex \\
  --project /path/to/your/project
codex hooks list   # find the three DashClaw hooks
codex hooks trust ~/.codex/config.toml:pre_tool_use:0:0
# (repeat for post_tool_use and stop)`}</code>
        </pre>
        <p className="mt-3 text-base text-text-secondary">
          Full step-by-step at{' '}
          <Link
            href="/guides/codex"
            className="text-text-primary underline decoration-border hover:decoration-text-primary"
          >
            /guides/codex
          </Link>
          . If something breaks, open an issue on GitHub.
        </p>
      </section>
    </div>
  );
}
