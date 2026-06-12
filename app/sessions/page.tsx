'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Activity, RotateCw, ChevronRight, Circle,
  CheckCircle, Play, PauseCircle, Flag, XCircle, Copy,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';

function timeAgo(dateString: string) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(start: string, end: string | null) {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}m`;
}

const statusBadge: Record<string, string> = {
  spawning: 'bg-zinc-500/20 text-secondary',
  ready: 'bg-info-subtle text-info',
  running: 'bg-success-subtle text-success',
  blocked: 'bg-warning-subtle text-warning',
  finished: 'bg-zinc-500/20 text-secondary',
  // Terminal aliases emitted by session_end (completed/cancelled) and the
  // hard-close path (closed) — styled like 'finished' so ended sessions don't
  // render as an unstyled grey badge.
  completed: 'bg-zinc-500/20 text-secondary',
  cancelled: 'bg-zinc-500/20 text-secondary',
  closed: 'bg-zinc-500/20 text-secondary',
  failed: 'bg-error-subtle text-error',
};

// Statuses the "Finished" filter rolls up (any non-failed terminal state).
const FINISHED_STATUSES = ['finished', 'completed', 'closed', 'cancelled'];
// All terminal statuses — a session in any of these has ended, so its duration
// is frozen at updated_at. Includes 'failed' so OpenClaw 'completed' / 'failed'
// sessions stop showing an ever-growing live duration.
const TERMINAL_STATUSES = ['finished', 'failed', 'closed', 'completed', 'cancelled'];
const FILTERS = ['all', 'running', 'blocked', 'failed', 'finished'];

export default function SessionsPage() {
  const { agentId } = useAgentFilter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [lastUpdated, setLastUpdated] = useState('');
  const [stale, setStale] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?limit=100${agentId ? `&agent_id=${encodeURIComponent(agentId)}` : ''}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        setLastUpdated(new Date().toLocaleTimeString());
        setStale(false);
      } else {
        // Keep the last good list (don't flicker the poll), but mark it stale so the
        // displayed data isn't silently presented as live.
        setStale(true);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const filtered = sessions.filter((s) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'finished') return FINISHED_STATUSES.includes(s.status);
    return s.status === filterStatus;
  });

  const selection = useSelection<any>(filtered, (s) => s.id);
  useSelectAllHotkey(selection.toggleAll);

  const stats = {
    total: sessions.length,
    running: sessions.filter((s) => s.status === 'running').length,
    blocked: sessions.filter((s) => s.status === 'blocked').length,
    failed: sessions.filter((s) => s.status === 'failed').length,
  };

  return (
    <PageLayout
      title="Agent Sessions"
      subtitle="Track active sessions, detect stalls, monitor health"
      breadcrumbs={['Observe', 'Sessions']}
      maturity="beta"
      actions={
        <>
          <BulkActionBar
            count={selection.count}
            actions={[{
              id: 'copy',
              label: 'Copy IDs',
              icon: Copy,
              onClick: () => { navigator.clipboard?.writeText(selection.selectedIds.join('\n')); },
            }]}
            onClear={selection.clear}
          />
          <button
            onClick={() => { setLoading(true); fetchSessions(); }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-white/[0.06] rounded-lg hover:border-white/[0.12] transition-colors duration-150"
          >
            <RotateCw size={14} className={loading ? 'motion-safe:animate-spin' : ''} />
            Refresh
          </button>
        </>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <div className="p-4 text-center">
            <div className="text-2xl font-semibold text-white">{stats.total}</div>
            <div className="text-xs text-tertiary mt-1">Total Sessions</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4 text-center">
            <div className="text-2xl font-semibold text-success">{stats.running}</div>
            <div className="text-xs text-tertiary mt-1">Running</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4 text-center">
            <div className="text-2xl font-semibold text-warning">{stats.blocked}</div>
            <div className="text-xs text-tertiary mt-1">Blocked</div>
          </div>
        </Card>
        <Card hover={false}>
          <div className="p-4 text-center">
            <div className="text-2xl font-semibold text-error">{stats.failed}</div>
            <div className="text-xs text-tertiary mt-1">Failed</div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilterStatus(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors duration-150 capitalize ${
              filterStatus === f
                ? 'bg-brand/10 border-brand text-brand'
                : 'bg-surface-secondary border-white/5 text-secondary hover:text-white'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        {lastUpdated && (
          <span className={`ml-auto text-[10px] ${stale ? 'text-warning' : 'text-disabled'}`}>
            {stale ? `Stale — last updated ${lastUpdated}` : `Updated ${lastUpdated}`}
          </span>
        )}
      </div>

      {/* Sessions Table */}
      <Card hover={false}>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12">
              <EmptyState
                icon={Activity}
                title="No sessions found"
                description={filterStatus === 'all'
                  ? 'Sessions will appear here once agents start running.'
                  : `No ${filterStatus} sessions right now.`}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] uppercase tracking-widest text-tertiary font-semibold">
                    <th className="px-6 py-4 w-8"><SelectCheckbox checked={selection.allSelected} onToggle={() => selection.toggleAll()} label="Select all" /></th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Agent</th>
                    <th className="px-6 py-4">Workspace</th>
                    <th className="px-6 py-4">Actions</th>
                    <th className="px-6 py-4">Last Activity</th>
                    <th className="px-6 py-4">Duration</th>
                    <th className="px-6 py-4 text-right">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((session) => (
                    <tr key={session.id} data-entity-type="session" data-entity-id={session.id} data-entity-status={session.status} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-3"><SelectCheckbox checked={selection.isSelected(session.id)} onToggle={(e) => { e.stopPropagation(); selection.selectClick(session.id, e.shiftKey); }} label="Select row" /></td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium capitalize ${statusBadge[session.status] || 'bg-zinc-500/20 text-secondary'}`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/sessions/${session.id}`} className="group/name">
                          <div className="text-sm font-medium text-white group-hover/name:text-brand transition-colors">{session.agent_id}</div>
                          <div className="text-[10px] text-tertiary mt-0.5">{session.id}</div>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-secondary">{session.workspace || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-secondary tabular-nums">{session.action_count ?? 0}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-secondary">
                          {session.last_activity ? timeAgo(session.last_activity) : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-secondary">
                          {session.created_at ? duration(session.created_at, TERMINAL_STATUSES.includes(session.status) ? session.updated_at : null) : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/sessions/${session.id}`}
                          className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand/80 transition-colors"
                        >
                          View <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
