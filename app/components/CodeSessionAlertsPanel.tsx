'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

// Reads and clears Code Session alerts (cost-anomaly / cache-crater / stuck-loop)
//   GET  /api/code-sessions/alerts          → { alerts, unread_count }
//   POST /api/code-sessions/alerts/read-all → marks all (or given ids) read
// Mounted on the Code Sessions index, which otherwise only shows an unread count.

const SEVERITY_VARIANT: Record<string, string> = { critical: 'error', high: 'error', warn: 'warning', warning: 'warning', info: 'info' };

export default function CodeSessionAlertsPanel() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/code-sessions/alerts?limit=50');
      if (!res.ok) throw new Error(`alerts request failed: ${res.status}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setUnread(data.unread_count || 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markAllRead = async () => {
    setMarking(true);
    try {
      const res = await fetch('/api/code-sessions/alerts/read-all', { method: 'POST' });
      if (res.ok) await load();
    } catch {
      // best-effort
    } finally {
      setMarking(false);
    }
  };

  // Nothing to show (and nothing loading, no error): stay out of the way.
  if (!loading && !error && alerts.length === 0) return null;

  return (
    <Card className="mb-6" hover={false}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <BellRing size={14} className="text-brand" aria-hidden="true" />
          Alerts
          {unread > 0 && <Badge variant="warning" size="xs">{unread} unread</Badge>}
        </span>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="rounded-md border border-border bg-surface-tertiary px-2.5 py-1 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
          >
            {marking ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-5 py-4 text-sm text-tertiary">Loading alerts…</div>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <div className="mb-3 text-sm text-error">Failed to load alerts.</div>
            <button
              onClick={load}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
            >
              Retry
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => {
              const isUnread = !a.read_at;
              const session = a.project_id && a.session_id
                ? `/code-sessions/${a.project_id}/${a.session_id}`
                : null;
              const row = (
                <div className={`flex items-start gap-3 px-5 py-3 ${isUnread ? '' : 'opacity-60'}`}>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isUnread ? 'bg-brand' : 'bg-border'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SEVERITY_VARIANT[a.severity] || 'info'} size="xs">{a.severity}</Badge>
                      {a.kind && <span className="text-[11px] uppercase tracking-wider text-tertiary">{a.kind.replace(/_/g, ' ')}</span>}
                      <span className="text-sm font-medium text-secondary">{a.title}</span>
                    </div>
                    {a.body && <p className="mt-0.5 text-xs text-tertiary">{a.body}</p>}
                  </div>
                  {a.created_at && (
                    <span className="shrink-0 tabular-nums text-[11px] text-tertiary">{new Date(a.created_at).toLocaleDateString()}</span>
                  )}
                </div>
              );
              return (
                <li key={a.id}>
                  {session ? (
                    <Link href={session} className="block transition-colors hover:bg-white/[0.02]">{row}</Link>
                  ) : row}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
