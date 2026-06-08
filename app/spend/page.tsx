'use client';

import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PageLayout from '../components/PageLayout';

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

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Daily fleet spend</div>
            {trend.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">No spend in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <defs>
                    <linearGradient id="fleetSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#808088', fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis tick={{ fill: '#808088', fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={45} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid #ffffff1f', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="#f97316" fill="url(#fleetSpendGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-tertiary">No spend data.</div>
      )}
    </PageLayout>
  );
}
