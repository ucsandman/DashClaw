'use client';

import type { ReactNode } from 'react';
import { Activity, Clock, AlertTriangle, Workflow, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MetricRowProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
}

function MetricRow({ icon: Icon, label, value, sub, color = 'text-white' }: MetricRowProps) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="flex-shrink-0 text-tertiary" aria-hidden="true" />
      <span className="flex-1 text-[11px] text-tertiary">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-[11px] tabular-nums text-tertiary">{sub}</span>}
    </div>
  );
}

function Header() {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Runtime</div>;
}

/** Prop-fed refactor of the old RuntimeSummaryCard — no own fetch/poll; `data` is the
 *  `/api/operations/summary` slice from the coordinated store. */
export function RuntimeVitals({ data }: { data: any }) {
  if (!data) {
    return (
      <div className="space-y-3">
        <Header />
        <div className="text-xs text-tertiary">Runtime metrics unavailable.</div>
      </div>
    );
  }

  const approvalColor =
    data.approval_backlog.pending_count > 0
      ? data.approval_backlog.oldest_minutes > 240
        ? 'text-error'
        : 'text-warning'
      : 'text-success';
  const workflowFailColor = data.workflows.failed_24h > 0 ? 'text-error' : 'text-success';

  return (
    <div className="space-y-3">
      <Header />
      <div className="space-y-2.5">
        <MetricRow icon={Zap} label="Throughput · 1h" value={data.throughput.last_1h} />
        <MetricRow
          icon={Clock}
          label="Latency p95"
          value={`${(data.latency.p95_ms / 1000).toFixed(1)}s`}
          sub={data.latency.p50_ms != null ? `p50 ${(data.latency.p50_ms / 1000).toFixed(1)}s` : ''}
        />
        <MetricRow
          icon={AlertTriangle}
          label="Approval backlog"
          value={data.approval_backlog.pending_count}
          sub={
            data.approval_backlog.pending_count > 0
              ? `${data.approval_backlog.oldest_minutes}m oldest${data.approval_backlog.avg_wait_minutes != null ? ` · ${data.approval_backlog.avg_wait_minutes}m avg` : ''}`
              : ''
          }
          color={approvalColor}
        />
        <MetricRow
          icon={Workflow}
          label="Workflows · 24h"
          value={`${data.workflows.completed_24h}/${data.workflows.completed_24h + data.workflows.failed_24h}`}
          sub={data.workflows.running > 0 ? `${data.workflows.running} running` : ''}
          color={workflowFailColor}
        />
        <MetricRow
          icon={Activity}
          label="Capabilities"
          value={`${data.capabilities.healthy}/${data.capabilities.healthy + data.capabilities.degraded + data.capabilities.failing}`}
          sub={data.capabilities.failing > 0 ? `${data.capabilities.failing} failing` : ''}
          color={data.capabilities.failing > 0 ? 'text-error' : 'text-success'}
        />
      </div>
    </div>
  );
}
