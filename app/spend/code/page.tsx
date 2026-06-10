'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import PageLayout from '../../components/PageLayout';
import { Skeleton } from '../../components/ui/Skeleton';

// recharts is ~360KB — load the chart on demand so it stays out of the page's
// initial chunk. Placeholder matches the chart's 220px footprint.
const CodeSpendChart = dynamic(() => import('./components/CodeSpendChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

const PERIODS = ['7d', '30d', '90d'];
const fmt = (n: any) => `$${Number(n || 0).toFixed(2)}`;

// recharts renders stroke/fill/stop-color as SVG presentation attributes, where
// CSS var() is not reliably honored. Resolve the design tokens to concrete
// values at runtime so the chart stays token-driven (no hardcoded palette) and
// still paints. These initials mirror app/globals.css purely as a
// pre-hydration / getComputedStyle-failure fallback.
const FALLBACK_COLORS = { brand: '#f97316', tick: '#808088', tooltipBg: '#1a1a1a', tooltipBorder: 'rgba(255, 255, 255, 0.12)' };

export default function ClaudeCodeSpendPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [colors, setColors] = useState(FALLBACK_COLORS);

  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    setColors({
      brand: read('--color-brand', FALLBACK_COLORS.brand),
      tick: read('--color-text-tertiary', FALLBACK_COLORS.tick),
      tooltipBg: read('--color-bg-tertiary', FALLBACK_COLORS.tooltipBg),
      tooltipBorder: read('--color-border-hover', FALLBACK_COLORS.tooltipBorder),
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Reset so totals/chart can never show the previous period's numbers under the
    // newly-selected period label while the switch is in flight or fails.
    setData(null);
    // One retry absorbs a Neon cold-start blip on the first request (mirrors /spend).
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/finops/spend?lens=claude-code&period=${period}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    console.error('Failed to load Claude Code spend:', lastErr);
    setError(true);
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const cs = data?.code_sessions;
  const trend = (() => {
    if (!cs?.by_day) return [];
    return [...cs.by_day]
      .map((d: any) => ({ date: d.date, cost: Number(d.cost_usd || 0) }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  })();

  return (
    <PageLayout agentFilter={false}
      title="Your Claude Code"
      subtitle="Advisory — your own Claude Code token spend (your machine, not fleet governance)"
      breadcrumbs={['Spend', 'Your Claude Code']}
      maturity="beta"
      actions={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 text-xs rounded-md border transition-colors ${period === p ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-secondary hover:border-border-hover'}`}
            >
              {p}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center">
          <div className="text-sm text-error mb-3">Failed to load Claude Code spend.</div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-secondary hover:border-border-hover transition-colors"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-surface-secondary px-4 py-2.5 text-xs text-tertiary">
            Advisory lens — your personal Claude Code cost, aggregated from ingested sessions. Distinct from governed fleet spend.{' '}
            <Link href="/code-sessions" className="text-secondary transition-colors hover:text-brand">View sessions →</Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Your Claude Code spend ({period})</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.code_total_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Cache savings</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(cs?.total_cache_savings_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Sessions</div>
              <div className="text-2xl font-semibold tabular-nums">{Number(cs?.session_count || 0)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Daily Claude Code spend</div>
            {trend.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">No Claude Code spend in this period.</div>
            ) : (
              <CodeSpendChart trend={trend} colors={colors} />
            )}
          </div>

          {cs?.by_project?.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-3">By project</div>
              <div className="space-y-1.5">
                {cs.by_project.map((p: any) => (
                  <div key={p.project_id} className="flex items-center justify-between text-sm">
                    <span className="text-secondary truncate">{p.project_name}</span>
                    <span className="tabular-nums text-tertiary">{fmt(p.cost_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-tertiary">No Claude Code spend data.</div>
      )}
    </PageLayout>
  );
}
