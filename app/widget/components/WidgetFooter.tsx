import React from 'react';
import type { ConnectionState } from '../connection';

export type { ConnectionState };

interface ConnMeta {
  label: string;
  dot: string;
  tone: string;
  /** Only a genuine live event (reconnecting) animates — calm under pressure. */
  pulse: boolean;
}

const CONN: Record<ConnectionState, ConnMeta> = {
  live: { label: 'Live', dot: 'bg-status-success', tone: 'text-success', pulse: false },
  reconnecting: { label: 'Reconnecting', dot: 'bg-status-warning', tone: 'text-warning', pulse: true },
  offline: { label: 'Offline', dot: 'bg-text-tertiary', tone: 'text-tertiary', pulse: false },
};

function updatedAgo(lastUpdated: number | null): string {
  if (!lastUpdated) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000));
  if (diff < 5) return 'updated just now';
  if (diff < 60) return `updated ${diff}s ago`;
  if (diff < 3600) return `updated ${Math.floor(diff / 60)}m ago`;
  return `updated ${Math.floor(diff / 3600)}h ago`;
}

export function WidgetFooter({
  connection,
  lastUpdated,
}: {
  connection: ConnectionState;
  lastUpdated: number | null;
}) {
  const meta = CONN[connection] ?? CONN.offline;
  return (
    <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2 text-xs">
      <span role="status" aria-label={`Connection: ${meta.label}`} className="inline-flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'motion-safe:animate-pulse' : ''}`}
          aria-hidden="true"
        />
        <span className={meta.tone}>{meta.label}</span>
      </span>
      <span className="tabular-nums text-tertiary">{updatedAgo(lastUpdated)}</span>
    </div>
  );
}
