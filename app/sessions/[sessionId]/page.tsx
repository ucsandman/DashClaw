'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Circle, CheckCircle, Play, PauseCircle,
  Flag, XCircle, AlertTriangle, RotateCw,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import SessionRetroCard, { SessionRetroChip } from '../../components/SessionRetroCard';
import { Card, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const statusBadge: Record<string, string> = {
  spawning: 'bg-zinc-500/20 text-secondary',
  ready: 'bg-info-subtle text-info',
  running: 'bg-success-subtle text-success',
  blocked: 'bg-warning-subtle text-warning',
  finished: 'bg-zinc-500/20 text-secondary',
  completed: 'bg-zinc-500/20 text-secondary',
  cancelled: 'bg-zinc-500/20 text-secondary',
  closed: 'bg-zinc-500/20 text-secondary',
  failed: 'bg-error-subtle text-error',
};

const eventIcons: Record<string, typeof Circle> = {
  spawning: Circle,
  ready: CheckCircle,
  running: Play,
  blocked: PauseCircle,
  finished: Flag,
  completed: Flag,
  cancelled: Flag,
  closed: Flag,
  failed: XCircle,
};

const TERMINAL_STATUSES = ['finished', 'failed', 'closed', 'completed', 'cancelled'];

const ACTIONS_PAGE_SIZE = 50;

function fmtActionCost(value: unknown): string {
  const n = Number(value) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [retro, setRetro] = useState<any>(null);
  const [actionsTotal, setActionsTotal] = useState(0);
  const [actionsLoadingMore, setActionsLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [patching, setPatching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, eventsRes, actionsRes, retroRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}`),
        fetch(`/api/sessions/${sessionId}/events`),
        fetch(`/api/sessions/${sessionId}/actions?limit=${ACTIONS_PAGE_SIZE}`),
        fetch(`/api/sessions/${sessionId}/retro`),
      ]);

      if (sessionRes.ok) {
        const sData = await sessionRes.json();
        setSession(sData.session || null);
      }
      if (eventsRes.ok) {
        const eData = await eventsRes.json();
        setEvents(eData.events || []);
      }
      if (actionsRes.ok) {
        const aData = await actionsRes.json();
        setActions(aData.actions || []);
        setActionsTotal(Number(aData.total) || 0);
      }
      if (retroRes.ok) {
        const rData = await retroRes.json();
        setRetro(rData.retro || null);
      }
    } catch (error) {
      console.error('Failed to fetch session detail:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Append the next page of session actions (newest-first, server-paginated).
  const loadMoreActions = useCallback(async () => {
    setActionsLoadingMore(true);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/actions?limit=${ACTIONS_PAGE_SIZE}&offset=${actions.length}`
      );
      if (res.ok) {
        const data = await res.json();
        setActions((prev) => [...prev, ...(data.actions || [])]);
        setActionsTotal(Number(data.total) || 0);
      } else {
        setActionError('Failed to load more actions');
      }
    } catch {
      setActionError('Failed to load more actions');
    } finally {
      setActionsLoadingMore(false);
    }
  }, [sessionId, actions.length]);

  // Status controls — the PATCH route was unreachable from the UI, so a
  // blocked/stalled session could never be resolved or finished here. Honors
  // the closed-session 409 by surfacing the error instead of silently failing.
  const handlePatch = useCallback(async (updates: Record<string, any>) => {
    setPatching(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Update failed');
        return;
      }
      if (data.session) setSession(data.session);
    } catch {
      setActionError('Update failed');
    } finally {
      setPatching(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <PageLayout
        title="Loading..."
        subtitle={sessionId}
        breadcrumbs={['Observe', 'Sessions', sessionId]}
      >
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </PageLayout>
    );
  }

  if (!session) {
    return (
      <PageLayout
        title="Session Not Found"
        subtitle={sessionId}
        breadcrumbs={['Observe', 'Sessions', sessionId]}
      >
        <div className="text-center py-12">
          <div className="text-sm text-secondary">This session does not exist or you don&apos;t have access.</div>
          <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand/80 transition-colors mt-4">
            <ArrowLeft size={14} /> Back to Sessions
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={session.agent_id}
      subtitle={session.id}
      breadcrumbs={['Observe', 'Sessions', session.agent_id]}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          {session.status === 'blocked' && (
            <button
              onClick={() => handlePatch({ status: 'running' })}
              disabled={patching}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-success hover:text-success bg-success-subtle border border-success/20 rounded-lg disabled:opacity-50 transition-colors duration-150"
            >
              Clear block
            </button>
          )}
          {!TERMINAL_STATUSES.includes(session.status) && (
            <button
              onClick={() => handlePatch({ status: 'finished' })}
              disabled={patching}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-white/[0.06] rounded-lg hover:border-white/[0.12] disabled:opacity-50 transition-colors duration-150"
            >
              Mark finished
            </button>
          )}
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-white/[0.06] rounded-lg hover:border-white/[0.12] transition-colors duration-150"
          >
            <RotateCw size={14} />
            Refresh
          </button>
        </div>
      }
    >
      {/* Back link */}
      <div className="mb-6">
        <Link href="/sessions" className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back to Sessions
        </Link>
      </div>

      {actionError && (
        <div role="alert" className="mb-4 px-4 py-2 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {actionError}
        </div>
      )}

      {/* Status + Meta */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <span className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium capitalize ${statusBadge[session.status] || 'bg-zinc-500/20 text-secondary'}`}>
          {session.status}
        </span>
        {/* Retro posture above the fold; anchors to the full card below. */}
        <SessionRetroChip retro={retro} />
        {session.workspace && (
          <span className="text-xs text-secondary">
            <span className="text-disabled">Workspace:</span> {session.workspace}
          </span>
        )}
        {session.branch && (
          <span className="text-xs text-secondary">
            <span className="text-disabled">Branch:</span> {session.branch}
          </span>
        )}
      </div>

      {/* Blocked Alert */}
      {session.status === 'blocked' && session.blocked_reason && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-lg bg-warning-subtle border border-warning/20">
          <AlertTriangle size={16} className="text-warning mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-warning">Session Blocked</div>
            <div className="text-xs text-warning/80 mt-0.5">{session.blocked_reason}</div>
          </div>
        </div>
      )}

      {/* Action telemetry — grounded in action_records for this session
          (direct session_id link, falling back to agent + time window). The
          legacy CI cards (green level / branch freshness / commits behind)
          were never populated and have been retired. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1"># Actions</div>
            <div className="text-sm font-medium text-white tabular-nums">{session.action_count ?? 0}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Total Cost</div>
            <div className="text-sm font-medium text-white tabular-nums">${(Number(session.total_cost) || 0).toFixed(2)}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Max Risk</div>
            <div className="text-sm font-medium text-white tabular-nums">{session.max_risk != null ? session.max_risk : '-'}</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest text-tertiary mb-1">Lifecycle events</div>
            <div className="text-sm font-medium text-white tabular-nums">{session.event_count ?? events.length}</div>
          </div>
        </Card>
      </div>

      {/* Session Summary — the terminal session_event's detail. session_end
          sends a 'summary' that the PATCH route now records as the detail of
          the terminal event (instead of dropping it). Surface it here so the
          end-of-session narrative is first-class, not buried in the timeline. */}
      {(() => {
        const terminalEvent = [...events]
          .reverse()
          .find((e) => TERMINAL_STATUSES.includes(e.kind) && e.detail);
        if (!terminalEvent) return null;
        return (
          <Card hover={false}>
            <div className="p-5">
              <div className="text-[10px] uppercase tracking-widest text-tertiary mb-2">Session Summary</div>
              <div className="text-sm text-secondary whitespace-pre-wrap">{terminalEvent.detail}</div>
            </div>
          </Card>
        );
      })()}

      <SessionRetroCard retro={retro} />

      {/* Actions ledger — the action_records attributed to this session via the
          same predicate as the "# Actions" card, so list and count always agree. */}
      <Card hover={false} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-3">
          <span className="text-sm font-medium text-secondary uppercase tracking-wider">Actions</span>
          <span className="text-xs tabular-nums text-tertiary">
            Showing {actions.length} of {actionsTotal}
          </span>
        </div>
        <CardContent className="p-0">
          {actions.length === 0 ? (
            <div className="px-6 pb-6 text-xs text-tertiary">
              No actions attributed to this session yet.
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {actions.map((a) => (
                  <li key={a.action_id} data-entity-type="action" data-entity-id={a.action_id}>
                    <Link
                      href={`/decisions/${a.action_id}`}
                      className="flex items-start gap-4 px-5 py-3 transition-colors hover:bg-white/[0.02]"
                    >
                      <span className="mt-0.5 min-w-[72px] font-mono text-[11px] tabular-nums text-tertiary">
                        {a.created_at ? timeAgo(a.created_at) : '--'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-secondary">
                          {a.declared_goal || a.action_type || a.action_id}
                        </span>
                        {a.action_type && (
                          <span className="mt-0.5 block font-mono text-[10px] text-tertiary">{a.action_type}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-[11px] tabular-nums text-tertiary" title="Risk score">
                          {a.risk_score != null ? a.risk_score : '—'}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-tertiary" title="Cost estimate">
                          {fmtActionCost(a.cost_estimate)}
                        </span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium capitalize ${statusBadge[a.status] || 'bg-zinc-500/20 text-secondary'}`}>
                          {a.outcome_status || a.status || 'unknown'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {actions.length < actionsTotal && (
                <div className="border-t border-border px-5 py-3">
                  <button
                    type="button"
                    onClick={loadMoreActions}
                    disabled={actionsLoadingMore}
                    className="text-xs font-medium text-brand transition-colors hover:text-brand/80 disabled:opacity-50"
                  >
                    {actionsLoadingMore ? 'Loading…' : `Load ${Math.min(ACTIONS_PAGE_SIZE, actionsTotal - actions.length)} more`}
                  </button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle timeline — session status transitions (running/blocked/
          finished…), not actions. Actions live in the ledger above. */}
      <Card hover={false} className="mt-6">
        <div className="px-5 pt-5 pb-3">
          <span className="text-sm font-medium text-secondary uppercase tracking-wider">Lifecycle timeline</span>
        </div>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="px-6 pb-6 text-xs text-tertiary">No events recorded yet.</div>
          ) : (
            <div className="px-6 pb-6">
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/5" />

                <div className="space-y-4">
                  {events.map((event) => {
                    const Icon = eventIcons[event.kind] || Circle;
                    const badgeClass = statusBadge[event.kind];
                    return (
                      <div key={event.id || event.seq} className="flex items-start gap-3 relative">
                        <div className="relative z-10 flex-shrink-0 mt-0.5">
                          <Icon size={14} className={`${badgeClass ? badgeClass.split(' ')[1] : 'text-secondary'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-secondary capitalize">{event.kind}</span>
                            <span className="text-[10px] text-disabled">{event.created_at ? timeAgo(event.created_at) : ''}</span>
                          </div>
                          {event.detail && (
                            <div className="text-xs text-tertiary mt-0.5">{event.detail}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
