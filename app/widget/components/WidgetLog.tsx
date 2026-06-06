import React from 'react';
import {
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Loader2,
  Clock,
  AlertTriangle,
  Circle,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import type { WidgetAction } from '../../lib/widget/summary.js';

function timeAgo(ts: string | null): string {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface RowMeta {
  Icon: LucideIcon;
  tone: string;
  /** Human-readable status word so meaning is never conveyed by color alone. */
  statusLabel: string;
  highlight: boolean;
}

function rowMeta(action: WidgetAction): RowMeta {
  const risk = action.riskScore ?? 0;
  switch (action.status) {
    case 'pending_approval':
      return { Icon: Clock, tone: 'text-brand', statusLabel: 'awaiting approval', highlight: true };
    case 'failed':
      return { Icon: XCircle, tone: 'text-error', statusLabel: 'failed', highlight: true };
    case 'blocked':
      return { Icon: ShieldAlert, tone: 'text-error', statusLabel: 'blocked', highlight: true };
    case 'running':
      return { Icon: Loader2, tone: 'text-info', statusLabel: 'running', highlight: false };
    case 'completed':
      if (risk >= 70) return { Icon: AlertTriangle, tone: 'text-warning', statusLabel: 'high risk', highlight: true };
      return { Icon: CheckCircle2, tone: 'text-success', statusLabel: 'done', highlight: false };
    default:
      if (risk >= 70) return { Icon: AlertTriangle, tone: 'text-warning', statusLabel: 'high risk', highlight: true };
      return { Icon: Circle, tone: 'text-tertiary', statusLabel: action.status ?? 'action', highlight: false };
  }
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="h-3 w-3 shrink-0 rounded-full bg-surface-tertiary" />
      <div className="h-3 flex-1 rounded bg-surface-tertiary" />
      <div className="h-3 w-6 shrink-0 rounded bg-surface-tertiary" />
    </div>
  );
}

/**
 * Live recent-action log. Handles loading (skeleton), error, and empty states.
 * Each row pairs a status-distinct icon shape + a status word + a tone color so
 * meaning survives without color (WCAG). Summaries are pre-sanitized + truncated
 * upstream; long values truncate cleanly here too.
 */
export function WidgetLog({
  actions,
  loading = false,
  error = null,
}: {
  actions: WidgetAction[];
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading recent activity" className="motion-safe:animate-pulse">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-2 px-3 py-6 text-xs text-error">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="truncate">{error}</span>
      </div>
    );
  }

  if (!actions || actions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
        <Inbox size={20} className="text-tertiary" aria-hidden="true" />
        <span className="text-xs text-secondary">No recent activity</span>
        <span className="text-[10px] text-tertiary">Governed actions will appear here</span>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {actions.map((action, i) => {
        const meta = rowMeta(action);
        const Icon = meta.Icon;
        const risk = action.riskScore ?? 0;
        return (
          <li
            key={action.actionId ?? i}
            className={`flex items-start gap-2 px-3 py-1.5 ${meta.highlight ? 'bg-white/[0.02]' : ''}`}
          >
            <Icon
              size={13}
              className={`mt-0.5 shrink-0 ${meta.tone} ${action.status === 'running' ? 'motion-safe:animate-spin' : ''}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-primary">
                  {action.summary || action.actionType || 'action'}
                </span>
                <time className="shrink-0 tabular-nums text-[10px] text-tertiary">{timeAgo(action.ts)}</time>
              </div>
              <div className="truncate text-[10px] text-tertiary">
                {action.agentName || 'agent'} · {meta.statusLabel}
                {risk >= 70 ? ` · risk ${risk}` : ''}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
