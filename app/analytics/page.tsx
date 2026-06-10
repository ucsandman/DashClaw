'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import HeroStats from './components/HeroStats';
import BreakdownCard from './components/BreakdownCard';
import TokenUsage from './components/TokenUsage';

// recharts is ~360KB — load the chart cards on demand so it stays out of the
// page's initial chunk. Placeholder mirrors the chart card footprint.
const chartSkeleton = () => (
  <div className="rounded-2xl border border-border bg-surface-secondary p-5">
    <Skeleton className="h-3 w-24 mb-4" />
    <Skeleton className="h-48 w-full" />
  </div>
);
const CostTrendChart = dynamic(() => import('./components/CostTrendChart'), { ssr: false, loading: chartSkeleton });
const ActionVolumeChart = dynamic(() => import('./components/ActionVolumeChart'), { ssr: false, loading: chartSkeleton });

const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

export default function AnalyticsPage() {
  const { agentId } = useAgentFilter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Reset so a failed range switch can't leave the prior range's numbers showing
    // under the newly-selected range label.
    setData(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/analytics?days=${days}${agentId ? `&agent_id=${encodeURIComponent(agentId)}` : ''}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
        setLoading(false);
        return;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    setError(true);
    setLoading(false);
  }, [days, agentId]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // Each enforcement row carries its guard decision value so rows can deep-link
  // into the ledger. 'warn' stays decision:null — warn evaluations never create
  // ledger entries, so a link would filter to nothing (the silent-no-op bug
  // class this sweep removes).
  const policyItems = data ? [
    { label: 'Blocked', decision: 'block', count: data.policy_enforcement.blocked, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.blocked / data.policy_enforcement.total) * 1000) / 10 : 0 },
    { label: 'Approvals', decision: 'require_approval', count: data.policy_enforcement.require_approval, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.require_approval / data.policy_enforcement.total) * 1000) / 10 : 0 },
    { label: 'Warnings', decision: null, count: data.policy_enforcement.warn, pct: data.policy_enforcement.total > 0 ? Math.round((data.policy_enforcement.warn / data.policy_enforcement.total) * 1000) / 10 : 0 },
  ] : [];

  return (
    <PageLayout
      title="Analytics"
      subtitle="Cost, usage, and efficiency metrics"
      breadcrumbs={['Measure', 'Analytics']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-tertiary p-0.5">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === r.value ? 'bg-brand/15 text-brand' : 'text-secondary hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-surface-secondary py-12 text-center">
          <div className="text-sm text-error mb-3">Failed to load analytics data.</div>
          <button
            onClick={fetchAnalytics}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <HeroStats hero={data.hero} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CostTrendChart daily={data.daily} />
            <ActionVolumeChart daily={data.daily} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BreakdownCard
              title="By Agent"
              items={data.by_agent}
              labelKey="agent_name"
              countLabel="cost"
              hrefFor={(i) => (i.agent_id ? `/agents/${encodeURIComponent(i.agent_id)}` : null)}
            />
            <BreakdownCard
              title="By Action Type"
              items={data.by_action_type}
              labelKey="action_type"
              countLabel="cost"
              hrefFor={(i) => (i.action_type ? `/decisions?action_type=${encodeURIComponent(i.action_type)}` : null)}
            />
            <BreakdownCard
              title="Policy Enforcement"
              items={policyItems}
              labelKey="label"
              countLabel="count"
              hrefFor={(i) => (i.decision ? `/decisions?decision=${encodeURIComponent(i.decision)}` : null)}
            />
          </div>

          <TokenUsage tokens={data.tokens} />
        </div>
      ) : (
        <div className="text-center py-12 text-sm text-tertiary">No analytics data.</div>
      )}
    </PageLayout>
  );
}
