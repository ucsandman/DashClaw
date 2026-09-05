'use client';

import { BellOff, AlertTriangle } from 'lucide-react';

/**
 * The "stop asking about this" panel that expands inside an approval card.
 *
 * Scope is displayed, never chosen. The server derives it from the action with
 * extractDecisionShape and will reject anything else, so offering the operator
 * a folder-level widening here would be a promise the guard refuses to keep —
 * and prefix widening on file paths is a bug this codebase already fixed once
 * (see targetPrefixOf in app/lib/policy-shapes.ts).
 */

export const TTL_CHOICES = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

interface DontAskAgainPanelProps {
  actionType: string;
  targetLabel: string;
  ttlHours: number;
  onTtlChange: (hours: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** How many pending approvals this grant is expected to release, including this one. */
  matchCount: number;
  truncated?: boolean;
  previewError?: string | null;
  previewPending?: boolean;
  busy: boolean;
}

export default function DontAskAgainPanel({
  actionType,
  targetLabel,
  ttlHours,
  onTtlChange,
  onConfirm,
  onCancel,
  matchCount,
  truncated,
  previewError,
  previewPending,
  busy,
}: DontAskAgainPanelProps) {
  const extras = Math.max(0, matchCount - 1);

  return (
    <div
      role="group"
      aria-label="Stop asking about this action"
      className="mt-4 space-y-3 rounded-lg border border-border bg-surface-tertiary p-4"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        <BellOff size={10} /> Stop asking about
      </div>

      <div className="space-y-1">
        <code className="block break-all rounded border border-border bg-surface-secondary px-2.5 py-2 font-mono text-xs text-secondary">
          {actionType} → {targetLabel}
        </code>
        <p className="text-xs text-tertiary">Covers this exact target only.</p>
      </div>

      <label className="flex items-center gap-2 text-xs text-secondary">
        <span>for</span>
        <select
          value={ttlHours}
          onChange={(e) => onTtlChange(Number(e.target.value))}
          disabled={busy}
          className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-primary focus:outline-none disabled:opacity-50"
        >
          {TTL_CHOICES.map((c) => (
            <option key={c.hours} value={c.hours}>{c.label}</option>
          ))}
        </select>
      </label>

      {extras > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning-subtle px-2.5 py-2 text-xs text-warning">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This also releases {truncated ? 'at least ' : ''}{extras} waiting {extras === 1 ? 'action' : 'actions'} that {extras === 1 ? 'matches' : 'match'}.
          </span>
        </div>
      )}
      {previewError && <p className="text-xs text-error" role="alert">Preview unavailable: {previewError}</p>}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary transition-colors hover:text-primary focus:outline-none disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy || previewPending || Boolean(previewError)}
          className="flex-1 rounded-lg border border-success/20 bg-success-subtle px-3 py-2 text-sm font-semibold text-success transition-colors hover:border-success/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? 'Working…'
            : previewError
              ? 'Preview unavailable'
            : previewPending
              ? 'Checking…'
              : matchCount > 1
                ? `Allow ${truncated ? 'at least ' : 'all '}${matchCount}`
                : 'Allow'}
        </button>
      </div>
    </div>
  );
}
