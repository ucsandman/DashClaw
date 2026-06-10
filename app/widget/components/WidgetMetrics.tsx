import React from 'react';
import type { WidgetSummary } from '../../lib/widget/summary';
import type { WidgetMetricPrefs } from '../../lib/widgetPrefs';

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function Metric({ label, value, tone = 'text-primary' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs font-medium uppercase tracking-[0.12em] text-tertiary">{label}</div>
      <div className={`truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const ALL_ENABLED: WidgetMetricPrefs = { agents: true, pending: true, signals: true, spend: true };

/**
 * Compact metrics strip, prefs-driven: only enabled metrics render (flex
 * handles 1-4 gracefully). Severity color enters only when a value warrants
 * attention (pending > 0 → brand; signals > 0 → warning) — otherwise neutral,
 * so brand orange stays a signal, not decoration.
 */
export function WidgetMetrics({
  metrics,
  enabled = ALL_ENABLED,
}: {
  metrics: WidgetSummary['metrics'];
  enabled?: WidgetMetricPrefs;
}) {
  const pendingTone = metrics.pendingApprovals > 0 ? 'text-brand' : 'text-primary';
  const signalsTone = metrics.signals > 0 ? 'text-warning' : 'text-primary';
  const any = enabled.agents || enabled.pending || enabled.signals || enabled.spend;
  if (!any) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      {enabled.agents ? <Metric label="Agents" value={metrics.activeAgents} /> : null}
      {enabled.pending ? <Metric label="Pending" value={metrics.pendingApprovals} tone={pendingTone} /> : null}
      {enabled.signals ? <Metric label="Signals" value={metrics.signals} tone={signalsTone} /> : null}
      {enabled.spend ? <Metric label="24h spend" value={formatUsd(metrics.spend)} /> : null}
    </div>
  );
}
