import Link from 'next/link';
import { ChevronRight, ShieldCheck, ArrowRight, FileText, ScrollText, Activity, GitBranch } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import MarketingPageView from '../components/MarketingPageView';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

// Page-level ISR, not fetch-level only: when SELF_GOVERNANCE_SOURCE_URL is
// unset at build time fetchLiveEvidence returns before fetch() runs, so no
// fetch revalidate marker exists and the page would freeze fully-static on
// its build-time state. This keeps the route revalidating (and re-reading
// runtime env) every 5 minutes regardless.
export const revalidate = 300;

export const metadata: Metadata = marketingPageMetadata({
  title: 'Proof: DashClaw governs its own maintainer',
  description:
    'Live, aggregate evidence that DashClaw is maintained under its own governance: every change guarded, recorded, and auditable on a real DashClaw instance.',
  path: '/proof',
});

/**
 * v7.3 self-governance proof surface. The numbers are live queries against
 * the instance that governs this repo's maintenance, fetched server-side from
 * SELF_GOVERNANCE_SOURCE_URL (aggregate-only endpoint; exposure boundary in
 * docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md). If the
 * source is unset or unreachable the page says so honestly — it never
 * fabricates or hardcodes evidence.
 */

interface LiveEvidence {
  version: string | null;
  generatedAt: string;
  actions: {
    total: number;
    last30d: number;
    last7d: number;
    firstAt: string | null;
    latestAt: string | null;
    activeDays: number;
  };
  decisions: {
    total: number;
    last30d: number;
    byDecision: { allow: number; warn: number; block: number; require_approval: number };
  };
}

async function fetchLiveEvidence(): Promise<LiveEvidence | null> {
  const url = process.env.SELF_GOVERNANCE_SOURCE_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.selfGovernance !== true || typeof body?.actions?.total !== 'number' || typeof body?.decisions?.total !== 'number') {
      return null;
    }
    return body as LiveEvidence;
  } catch {
    return null;
  }
}

const num = (n: number) => n.toLocaleString('en-US');

function utcDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}

const DECISION_ROWS = [
  { key: 'allow' as const, label: 'allow', barClass: 'bg-status-success' },
  { key: 'warn' as const, label: 'warn', barClass: 'bg-status-warning' },
  { key: 'require_approval' as const, label: 'require_approval', barClass: 'bg-status-info' },
  { key: 'block' as const, label: 'block', barClass: 'bg-status-error' },
];

const TRAIL_LINKS = [
  {
    href: 'https://github.com/ucsandman/DashClaw/blob/main/docs/maintainer-log.md',
    external: true,
    icon: ScrollText,
    title: 'Maintainer log',
    desc: 'The running, human-readable record of every maintainer session: what shipped, what was decided, what was declined.',
  },
  {
    href: 'https://github.com/ucsandman/DashClaw/blob/main/MAINTAINER.md',
    external: true,
    icon: FileText,
    title: 'MAINTAINER.md',
    desc: 'The charter: the five invariants a human holds, and the boundaries the AI maintainer operates inside.',
  },
  {
    href: 'https://github.com/ucsandman/DashClaw/releases',
    external: true,
    icon: GitBranch,
    title: 'GitHub releases',
    desc: 'Every governed ship, versioned and published; the CHANGELOG entry rides each release.',
  },
  {
    href: '/livingcode/index.html',
    external: false,
    icon: Activity,
    title: 'Livingcode dashboard',
    desc: 'A generated, always-current map of the codebase the maintainer works in, derived from the code, not written about it.',
  },
];

export default async function ProofPage() {
  const live = await fetchLiveEvidence();
  const latestAction = live ? utcDate(live.actions.latestAt) : null;
  const since = live ? utcDate(live.actions.firstAt) : null;
  const decisionTotal = live ? Math.max(1, live.decisions.total) : 1;

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <MarketingPageView event="marketing_proof_visited" />
      <PublicNavbar />

      <section className="pt-28 pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-primary">Proof</span>
          </div>

          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <ShieldCheck size={20} className="text-brand" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary font-mono">Self-governance proof</p>
              <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight">DashClaw is maintained under its own governance</h1>
              <p className="mt-2 text-text-secondary max-w-2xl leading-relaxed">
                This project&apos;s maintainer is an AI agent, and every change it makes runs through a live
                DashClaw instance: intent declared, risk evaluated, the action recorded, risky acts held for
                human approval. The numbers below are live aggregates from that instance, not marketing copy.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Live evidence */}
      <section className="pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          {live ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-xl bg-surface-secondary border border-border p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Governed actions</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{num(live.actions.total)}</p>
                  {since && <p className="mt-1 text-xs text-text-tertiary">recorded since {since}</p>}
                </div>
                <div className="rounded-xl bg-surface-secondary border border-border p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Guard decisions</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{num(live.decisions.total)}</p>
                  <p className="mt-1 text-xs text-text-tertiary">{num(live.decisions.last30d)} in the last 30 days</p>
                </div>
                <div className="rounded-xl bg-surface-secondary border border-border p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Decision cadence</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{num(live.actions.activeDays)}</p>
                  <p className="mt-1 text-xs text-text-tertiary">active governed days · {num(live.actions.last7d)} actions this week</p>
                </div>
                <div className="rounded-xl bg-surface-secondary border border-border p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Latest governed ship</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{live.version ? `v${live.version}` : '—'}</p>
                  {latestAction && <p className="mt-1 text-xs text-text-tertiary">latest governed action {latestAction}</p>}
                </div>
              </div>

              {/* Decision mix */}
              <div className="mt-4 rounded-xl bg-surface-secondary border border-border p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Decision mix, all time</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                  {DECISION_ROWS.map(({ key, label, barClass }) => {
                    const count = live.decisions.byDecision[key];
                    const pct = Math.round((count / decisionTotal) * 100);
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 font-mono text-xs text-text-secondary">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-text-primary">{num(count)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-text-tertiary">
                  Held and blocked actions are the system working: the maintainer&apos;s riskiest moves wait for a human.
                </p>
              </div>

              <p className="mt-3 text-xs text-text-tertiary">
                Live from the maintainer&apos;s instance · aggregate-only, no decision content crosses this boundary ·
                refreshed every 5 minutes · snapshot {utcDate(live.generatedAt) ?? '—'}
              </p>
            </>
          ) : (
            <div className="rounded-xl bg-surface-secondary border border-border p-6">
              <p className="text-sm font-semibold text-text-primary">Live evidence is temporarily unavailable</p>
              <p className="mt-2 text-sm text-text-secondary leading-relaxed max-w-2xl">
                This page renders live aggregates from the DashClaw instance that governs this repo&apos;s
                maintenance. That feed isn&apos;t reachable right now, and we don&apos;t show cached or made-up
                numbers in its place. The written trail below is permanent and doesn&apos;t depend on it.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* The written trail */}
      <section className="pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-bold tracking-tight">Verify it yourself</h2>
          <p className="mt-2 text-sm text-text-secondary max-w-2xl leading-relaxed">
            The aggregate numbers are one layer. The full human-readable trail is public and permanent:
          </p>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {TRAIL_LINKS.map(({ href, external, icon: Icon, title, desc }) => {
              const inner = (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-brand" aria-hidden="true" />
                    <span className="text-sm font-semibold text-text-primary">{title}</span>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
                </>
              );
              const cls = 'block rounded-xl bg-surface-secondary border border-border p-5 hover:border-border-hover transition-colors';
              return external ? (
                <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
              ) : (
                <a key={href} href={href} className={cls}>{inner}</a>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold tracking-tight [text-wrap:balance]">The same loop is what you deploy</h2>
          <p className="mt-3 text-text-secondary">
            Nothing on this page is a special build. It&apos;s a stock DashClaw instance governing a real,
            high-stakes workload: its own product.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/self-host" className="px-6 py-2.5 rounded-lg bg-brand text-surface-primary text-sm font-medium hover:bg-brand-hover transition-colors inline-flex items-center gap-2">
              Run your own instance <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <a href="/explain" className="px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors">
              How the governance loop works
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
