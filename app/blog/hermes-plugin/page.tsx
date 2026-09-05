/**
 * /blog/hermes-plugin — Hermes Agent plugin launch post.
 *
 * Added alongside the Hermes plugin landing. Where Codex parity was about
 * reusing the same hook surface, Hermes is about going wider — eight
 * lifecycle events including per-turn context injection, secret redaction,
 * subagent ROI, and live ingest.
 *
 * Design: CSS tokens only per .impeccable.md.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw now ships a Hermes plugin: per-turn governance, live ingest, subagent ROI',
  description:
    "Eight Hermes lifecycle hooks, per-turn context injection, secret redaction in tool output, and live session ingest. One install script.",
  path: '/blog/hermes-plugin',
  ogType: 'article',
});

export default function BlogPostPage() {
  return (
    <div className="space-y-6 text-text-primary">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'DashClaw now ships a Hermes plugin: per-turn governance, live ingest, subagent ROI',
          description: "Eight Hermes lifecycle hooks, per-turn context injection, secret redaction in tool output, and live session ingest. One install script.",
          url: 'https://www.dashclaw.io/blog/hermes-plugin',
          datePublished: '2026-05-14',
          publisher: { '@type': 'Organization', name: 'DashClaw', url: 'https://www.dashclaw.io' },
        }}
      />
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
          Update · Hermes plugin
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          DashClaw now ships a Hermes plugin
        </h1>
        <p className="mt-4 text-base text-text-secondary">
          One install script. Eight lifecycle hooks. Per-turn governance
          context injection so the model knows what is pending and what
          is policied. Recognized credential patterns in tool output are
          replaced before the model receives the hook result. Live session ingest so{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            /code-sessions
          </code>{' '}
          shows turn-by-turn token counts as the agent runs, not after.
        </p>
      </header>

      <section>
        <h2 className="mt-6 text-xl font-semibold tracking-tight">
          Why Hermes gets a richer surface
        </h2>
        <p className="mt-3 text-base text-text-secondary">
          Claude Code and Codex expose three lifecycle events DashClaw
          cares about:{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            pre_tool_call
          </code>
          ,{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            post_tool_call
          </code>
          ,{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            stop
          </code>
          . Useful, but coarse. Hermes Agent exposes eight, and four of
          them unlock workflows the others cannot:{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            pre_llm_call
          </code>{' '}
          (inject context every turn),{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            post_llm_call
          </code>{' '}
          (live ingest),{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            transform_tool_result
          </code>{' '}
          (redact secrets before the model sees them), and{' '}
          <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
            subagent_stop
          </code>{' '}
          (record reported delegate_task children for ROI tracking). The
          existing Claude Code Python hooks still run unchanged for the
          pre/post tool path; Hermes shares the same stdin JSON shape.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          The four new capabilities
        </h2>
        <ol className="mt-4 space-y-3 text-base text-text-secondary">
          <li>
            <strong className="text-text-primary">
              Per-turn governance context.
            </strong>{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              pre_llm_call
            </code>{' '}
            injects active policies, pending approvals, and today&apos;s
            action count via Hermes&apos;s context-injection contract.
            Each observed turn receives the governance state available to
            the hook, so the model knows what
            governance state it is in. Cached for 5 minutes so the hot
            path stays cheap.
          </li>
          <li>
            <strong className="text-text-primary">Live session ingest.</strong>{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              post_llm_call
            </code>{' '}
            pushes turn structure to{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /api/code-sessions/ingest-live
            </code>{' '}
            for each reported turn. No more waiting for a Stop hook to flush a
            transcript: token costs and tool calls land in{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              /code-sessions
            </code>{' '}
            as the agent runs.
          </li>
          <li>
            <strong className="text-text-primary">Secret redaction.</strong>{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              transform_tool_result
            </code>{' '}
            substitutes Anthropic / OpenAI / AWS / GitHub / Slack /
            Stripe API keys, JWTs, PEM private-key blocks, and DashClaw
            keys themselves in tool output before the model sees them.
            Never blocks; just substitutes. The model gets a redacted
            string with a token-shaped placeholder.
          </li>
          <li>
            <strong className="text-text-primary">Subagent ROI.</strong>{' '}
            Each reported{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              delegate_task
            </code>{' '}
            child exits through{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              subagent_stop
            </code>
            , which records a DashClaw action with{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              action_type=subagent
            </code>{' '}
            and the child&apos;s outcome. Powers the subagent-ROI
            dashboard: which delegated tasks paid off vs. burned tokens
            without making progress.
          </li>
        </ol>
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
            ledger. Hermes actions land alongside Claude Code and Codex
            with{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              agent_id = &quot;hermes&quot;
            </code>
            .
          </li>
          <li>· Same Discord and Telegram approval bridges.</li>
          <li>
            · Same{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw_wait_for_approval
            </code>{' '}
            MCP tool: when Hermes calls it and honors the result, it waits on
            the same server-side approval decision as Claude Code and Codex.
          </li>
          <li>· Same policy packs. No Hermes-specific policies to write.</li>
          <li>
            · The{' '}
            <code className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-sm">
              dashclaw-governance
            </code>{' '}
            skill is mirrored into the Hermes plugin from the same
            canonical source used by the Claude Code and global skill installs.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mt-10 text-xl font-semibold tracking-tight">
          Try it
        </h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 font-mono text-sm text-text-secondary">
          <code>{`# macOS / Linux
bash scripts/install-hermes-plugin.sh

# Windows
powershell -File scripts/install-hermes-plugin.ps1

# Sanity check
hermes dashclaw doctor`}</code>
        </pre>
        <p className="mt-3 text-base text-text-secondary">
          Full step-by-step at{' '}
          <Link
            href="/guides/hermes"
            className="text-text-primary underline decoration-border hover:decoration-text-primary"
          >
            /guides/hermes
          </Link>
          . If something breaks, open an issue on GitHub.
        </p>
      </section>
    </div>
  );
}
