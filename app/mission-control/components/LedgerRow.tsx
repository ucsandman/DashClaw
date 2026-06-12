'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { formatRelativeTime } from '../lib/missionHelpers';

const SEVERITY: Record<string, { dot: string; word: string }> = {
  critical: { dot: 'bg-status-error', word: 'Critical' },
  high: { dot: 'bg-brand', word: 'High' },
  medium: { dot: 'bg-status-warning', word: 'Medium' },
  low: { dot: 'bg-status-info', word: 'Low' },
};

// Token-only category pills (the old raw-palette escapes are replaced with design tokens).
const CATEGORY_PILL: Record<string, { label: string; cls: string }> = {
  approval: { label: 'Approval', cls: 'bg-brand-subtle text-brand border-brand/20' },
  failure: { label: 'Failure', cls: 'bg-error-subtle text-error border-error/20' },
  signal: { label: 'Signal', cls: 'bg-warning-subtle text-warning border-warning/20' },
  health: { label: 'Health', cls: 'bg-info-subtle text-info border-info/20' },
  stale: { label: 'Stale', cls: 'bg-surface-tertiary text-secondary border-border' },
};

interface LedgerRowProps {
  item: any;
  onApprove?: (sourceId: string) => void;
  onDeny?: (sourceId: string) => void;
  onRetry?: (metadata: any) => void;
  onDisable?: (metadata: any) => void;
  onCancel?: (metadata: any) => void;
  /** Signal rows only: hide this occurrence (same dismissal store as the Security page). */
  onDismiss?: () => void;
}

export function LedgerRow({ item, onApprove, onDeny, onRetry, onDisable, onCancel, onDismiss }: LedgerRowProps) {
  const sev = SEVERITY[item.severity] || SEVERITY.low!;
  const pill = CATEGORY_PILL[item.category] || CATEGORY_PILL.signal!;
  const entityStatus = item.category === 'approval' ? 'pending_approval' : item.severity;

  return (
    <div
      data-entity-type={item.source}
      data-entity-id={item.source_id ?? undefined}
      data-entity-status={entityStatus}
      className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 transition-colors animate-[fadeSlideIn_180ms_ease-out] hover:border-border-hover hover:bg-white/[0.02]"
    >
      <span className="mt-1.5 flex shrink-0 items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${sev.dot}`} aria-hidden="true" />
        <span className="sr-only">{sev.word}</span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${pill.cls}`}>{pill.label}</span>
          {(item.occurrence_count ?? 1) > 1 && (
            <span
              className="rounded border border-border bg-white/5 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-tertiary"
              title={`${item.occurrence_count} occurrences collapsed — dismissing clears all of them`}
            >
              ×{item.occurrence_count}
            </span>
          )}
          <span className="text-[10px] font-medium uppercase tracking-wide text-tertiary">{sev.word}</span>
          {item.agent_id && <span className="max-w-[140px] truncate text-[11px] text-tertiary">{item.agent_id}</span>}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-tertiary">{formatRelativeTime(item.timestamp)}</span>
        </div>

        <Link href={item.action_url || '#'} className="text-sm text-secondary transition-colors hover:text-white">
          {item.title}
        </Link>

        {item.detail && <p className="mt-0.5 truncate text-xs text-tertiary">{item.detail}</p>}
      </div>

      <div className="mt-1 flex shrink-0 items-center gap-1.5">
        {item.category === 'approval' && onApprove && onDeny && (
          <>
            <button
              onClick={() => onApprove(item.source_id)}
              className="rounded-md border border-success/20 bg-success-subtle px-2 py-1 text-[11px] font-medium text-success transition-colors hover:border-success/40"
            >
              Approve
            </button>
            <button
              onClick={() => onDeny(item.source_id)}
              className="rounded-md border border-error/20 bg-error-subtle px-2 py-1 text-[11px] font-medium text-error transition-colors hover:border-error/40"
            >
              Deny
            </button>
          </>
        )}
        {item.suggested_action === 'retry' && onRetry && (
          <button
            onClick={() => onRetry(item.metadata)}
            className="rounded-md border border-info/20 bg-info-subtle px-2 py-1 text-[11px] font-medium text-info transition-colors hover:border-info/40"
          >
            Retry
          </button>
        )}
        {item.suggested_action === 'cancel' && onCancel && (
          <button
            onClick={() => onCancel(item.metadata)}
            className="rounded-md border border-error/20 bg-error-subtle px-2 py-1 text-[11px] font-medium text-error transition-colors hover:border-error/40"
          >
            Cancel
          </button>
        )}
        {item.suggested_action === 'disable' && onDisable && (
          <button
            onClick={() => onDisable(item.metadata)}
            className="rounded-md border border-warning/20 bg-warning-subtle px-2 py-1 text-[11px] font-medium text-warning transition-colors hover:border-warning/40"
          >
            Disable
          </button>
        )}
        {item.category !== 'approval' && (
          <Link
            href={item.action_url || '#'}
            className="rounded-md border border-border bg-white/5 px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-border-hover hover:bg-white/10"
          >
            View
          </Link>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss signal"
            title="Dismiss this signal. A new occurrence re-fires."
            className="rounded-md border border-border bg-white/5 p-1 text-tertiary transition-colors hover:border-border-hover hover:bg-white/10 hover:text-secondary"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
