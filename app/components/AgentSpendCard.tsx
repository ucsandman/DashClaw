'use client';

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCost } from '../lib/formatCost';

interface AgentSpendCardProps {
  agentId?: string;
}

export default function AgentSpendCard({ agentId }: AgentSpendCardProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ period: '30d' });
    if (agentId) params.set('agent_id', agentId);

    try {
      const res = await fetch(`/api/actions/costs?${params}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-3 w-20 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-8 w-24 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-surface-secondary py-12 text-center">
        <div className="text-sm text-error mb-3">Failed to load agent spend.</div>
        <button
          onClick={load}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.total_cost_usd == null) return null;

  const totalCost = data.total_cost_usd;
  // Compare against 0 since we have a single period — trend improves once we have history
  const isPositiveTrend = totalCost > 0;

  // Build sparkline bars from by_day data
  const days = Array.isArray(data.by_day) ? data.by_day : [];
  const maxDayCost = days.reduce((m: number, d: any) => Math.max(m, d.cost_usd || 0), 0);

  // Top 3 agents by spend
  const byAgent = Array.isArray(data.by_agent) ? data.by_agent : [];
  const top3 = byAgent.slice(0, 3);

  return (
    <div className="space-y-3">
      <div
        className="text-[10px] font-semibold uppercase tracking-widest text-tertiary"
        title="Estimated at public API list prices — a what-if cost signal, not your actual subscription bill."
      >
        Agent Spend (30d)
      </div>

      {/* Total spend */}
      <div>
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-bold tabular-nums text-white">
            {formatCost(totalCost)}
          </div>
          <div
            className={`flex items-center gap-0.5 text-xs font-medium ${
              isPositiveTrend ? 'text-success' : 'text-tertiary'
            }`}
          >
            {isPositiveTrend ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          </div>
        </div>
        <div className="mt-0.5 text-[10px] text-disabled">est. at API list prices</div>
      </div>

      {/* Sparkline */}
      {days.length > 0 && (
        <div className="flex items-end gap-0.5 h-8">
          {days.map((d: any, i: number) => {
            const height =
              maxDayCost > 0 ? Math.max(2, Math.round(((d.cost_usd || 0) / maxDayCost) * 32)) : 2;
            return (
              <div
                key={i}
                title={`${d.date}: ${formatCost(d.cost_usd)}`}
                className="flex-1 rounded-sm bg-brand/40 hover:bg-brand/70 transition-colors"
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
      )}

      {/* Top agents */}
      {top3.length > 0 && (
        <div className="space-y-1 pt-1">
          {top3.map((a: any) => (
            <div key={a.agent_id} className="flex items-center justify-between text-xs">
              <span className="truncate max-w-[120px] text-secondary">
                {a.agent_name || a.agent_id}
              </span>
              <span className="font-mono text-white tabular-nums">{formatCost(a.cost_usd)}</span>
            </div>
          ))}
        </div>
      )}

      {totalCost === 0 && (
        <div className="text-xs text-disabled">No cost data yet</div>
      )}
    </div>
  );
}
