import React from 'react';
import type { WidgetSummary } from '../../lib/widget/summary';

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function Metric({ label, value, tone = 'text-primary' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">{label}</div>
      <div className={`truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

/**
 * Compact metrics strip. Severity color enters only when a value warrants
 * attention (pending > 0 → brand; signals > 0 → warning) — otherwise neutral,
 * so brand orange stays a signal, not decoration.
 */
export function WidgetMetrics({ metrics }: { metrics: WidgetSummary['metrics'] }) {
  const pendingTone = metrics.pendingApprovals > 0 ? 'text-brand' : 'text-primary';
  const signalsTone = metrics.elevated > 0 ? 'text-warning' : 'text-primary';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Metric label="Agents" value={metrics.activeAgents} />
      <Metric label="Pending" value={metrics.pendingApprovals} tone={pendingTone} />
      <Metric label="Signals" value={metrics.elevated} tone={signalsTone} />
      <Metric label="24h" value={formatUsd(metrics.spend)} />
    </div>
  );
}
