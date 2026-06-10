'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Layers, Trash2 } from 'lucide-react';
import { useSelection } from '../../lib/useSelection';
import { useSelectAllHotkey } from '../../lib/useSelectAllHotkey';
import { bulkAction } from '../../lib/bulkAction';
import { SelectCheckbox } from '../../components/selection/SelectCheckbox';
import { BulkActionBar } from '../../components/selection/BulkActionBar';
import { EmptyState } from '../../components/ui/EmptyState';

interface SessionRow {
  id: string;
  session_uuid: string | null;
  source: string | null;
  model_primary: string | null;
  message_count: number | string;
  cost_usd: number | string | null;
  started_at: string | null;
}

/**
 * Client sessions table for a project page — shared multi-select pattern with
 * a bulk Delete hitting DELETE /api/code-sessions/sessions/{id} per row.
 */
export default function SessionsTable({ projectId, sessions: initialSessions }: { projectId: string; sessions: SessionRow[] }) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions);
  const [error, setError] = useState<string | null>(null);

  const selection = useSelection<SessionRow>(sessions, (s) => s.id);
  useSelectAllHotkey(selection.toggleAll);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(
      `Delete ${selection.count} ${selection.count === 1 ? 'session' : 'sessions'}? Messages, tool uses, and signals go with them. This cannot be undone.`
    )) return;
    const { ok, failed } = await bulkAction(selection.selectedIds, (id) =>
      fetch(`/api/code-sessions/sessions/${id}`, { method: 'DELETE' })
    );
    setSessions((prev) => prev.filter((s) => !ok.includes(s.id)));
    if (failed.length > 0) setError(`${failed.length} delete${failed.length === 1 ? '' : 's'} failed`);
    selection.clear();
  }

  if (!sessions.length) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Layers}
          title="No sessions yet"
          description="No sessions have been recorded for this project yet."
        />
      </div>
    );
  }

  return (
    <div>
      {(selection.count > 0 || error) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2.5">
          <BulkActionBar
            count={selection.count}
            actions={[{ id: 'delete', label: 'Delete', icon: Trash2, onClick: bulkDelete, danger: true }]}
            onClear={selection.clear}
          />
          {error && <span role="alert" className="text-xs text-error">{error}</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <th className="w-10 px-4 py-3">
                <SelectCheckbox checked={selection.allSelected} onToggle={() => selection.toggleAll()} label="Select all sessions" />
              </th>
              <th className="px-2 py-3">Session</th>
              <th className="px-5 py-3">Source</th>
              <th className="px-5 py-3">Model</th>
              <th className="px-5 py-3 text-right">Messages</th>
              <th className="px-5 py-3 text-right">Cost</th>
              <th className="px-5 py-3">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sessions.map((s) => (
              <tr key={s.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="w-10 px-4 py-3">
                  <SelectCheckbox checked={selection.isSelected(s.id)} onToggle={() => selection.toggle(s.id)} label={`Select session ${String(s.session_uuid || s.id).slice(0, 8)}`} />
                </td>
                <td className="px-2 py-3">
                  <Link
                    className="font-mono text-xs text-white transition-colors hover:text-brand"
                    href={`/code-sessions/${projectId}/${s.id}`}
                  >
                    {String(s.session_uuid || '').slice(0, 8)}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className="rounded bg-surface-tertiary px-2 py-0.5 text-xs text-tertiary">{s.source}</span>
                </td>
                <td className="px-5 py-3 text-xs text-secondary">{s.model_primary || '—'}</td>
                <td className="px-5 py-3 text-right tabular-nums text-secondary">{s.message_count}</td>
                <td className="px-5 py-3 text-right tabular-nums text-secondary">${Number(s.cost_usd || 0).toFixed(2)}</td>
                <td className="px-5 py-3 text-tertiary tabular-nums">
                  {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
