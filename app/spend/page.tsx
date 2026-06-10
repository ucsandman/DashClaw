'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';

// recharts is ~360KB — load the chart on demand so it stays out of the page's
// initial chunk. Placeholder matches the chart's 220px footprint.
const FleetSpendChart = dynamic(() => import('./components/FleetSpendChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

const PERIODS = ['7d', '30d', '90d'];
const fmt = (n: any) => `$${Number(n || 0).toFixed(2)}`;

export default function SpendOverviewPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Reset so the headline/chart can never show the previous period's numbers
    // under the newly-selected period label while the switch is in flight or fails.
    setData(null);
    // One retry absorbs a Neon cold-start blip on the first request (page mount),
    // which otherwise surfaced as a sticky "Failed to load" with no recovery.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/finops/spend?period=${period}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    console.error('Failed to load fleet spend:', lastErr);
    setError(true);
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const trend = (() => {
    if (!data) return [];
    const byDate: Record<string, any> = {};
    for (const d of data.agent?.by_day || []) byDate[d.date] = { date: d.date, agent: Number(d.cost_usd || 0), x402: 0 };
    for (const d of data.x402?.by_day || []) (byDate[d.date] ||= { date: d.date, agent: 0, x402: 0 }).x402 = Number(d.spend_usd || 0);
    return Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date)).map((r: any) => ({ ...r, total: r.agent + r.x402 }));
  })();

  return (
    <PageLayout
      title="Spend"
      subtitle="Fleet spend — agent LLM cost and x402 capability purchases"
      breadcrumbs={['Spend', 'Overview']}
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
          <div className="text-sm text-error mb-3">Failed to load spend.</div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-secondary hover:border-border-hover transition-colors"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Fleet spend ({period})</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.fleet_total_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">Agent Spend (LLM)</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.agent?.total_cost_usd)}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-2">x402 Purchases</div>
              <div className="text-2xl font-semibold tabular-nums">{fmt(data.x402?.total_spend_usd)}</div>
            </div>
          </div>

          {Number(data.unpriced?.action_count) > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm" role="status">
              <div className="font-medium text-warning mb-1">
                {data.unpriced.action_count} action{data.unpriced.action_count === 1 ? '' : 's'} in this period reported tokens but carry $0 cost
              </div>
              <div className="text-secondary text-xs">
                Unpriced models:{' '}
                <span className="font-mono">
                  {data.unpriced.models.map((m: any) => m.model || '(none)').join(', ')}
                </span>
                {' — '}extend DEFAULT_PRICING (npm run pricing:refresh) or set org custom pricing, then re-run the cost backfill.
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Daily fleet spend</div>
            {trend.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">No spend in this period.</div>
            ) : (
              <FleetSpendChart trend={trend} />
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-tertiary">No spend data.</div>
      )}
    </PageLayout>
  );
}
