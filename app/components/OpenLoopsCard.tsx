'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  CircleDot, ClipboardList, HelpCircle, Link as LinkIcon, Hand, Eye,
  ArrowRightLeft, RefreshCw, CheckCircle2, ArrowRight
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

const LOOP_TYPE_ICONS: Record<string, React.ElementType> = {
  followup: ClipboardList,
  question: HelpCircle,
  dependency: LinkIcon,
  approval: Hand,
  review: Eye,
  handoff: ArrowRightLeft,
};

function getPriorityVariant(priority: string) {
  switch (priority) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    default: return 'default';
  }
}

export default function OpenLoopsCard() {
  const [loops, setLoops] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchLoops() {
      try {
        const res = await fetch(`/api/actions/loops?status=open&limit=5${agentId ? `&agent_id=${agentId}` : ''}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setLoops(data.loops || []);
        setStats(data.stats || {});
      } catch (error) {
        console.error('Failed to fetch open loops:', error);
        setLoops([]);
        setStats({});
      } finally {
        setLoading(false);
      }
    }
    fetchLoops();
  }, [agentId]);

  useRealtime(useCallback((event: string, payload: any) => {
    if (event === 'loop.created') {
      if (agentId && payload.agent_id !== agentId) return;
      if (payload.status !== 'open') return;

      setLoops(prev => {
        if (prev.some(l => l.loop_id === payload.loop_id)) return prev;
        return [payload, ...prev].slice(0, 10);
      });
      setStats((prev: any) => ({
        ...prev,
        open_count: String(parseInt(prev.open_count || '0', 10) + 1),
        critical_open: payload.priority === 'critical' ? String(parseInt(prev.critical_open || '0', 10) + 1) : prev.critical_open,
        high_open: payload.priority === 'high' ? String(parseInt(prev.high_open || '0', 10) + 1) : prev.high_open,
      }));
    } else if (event === 'loop.updated') {
      if (payload.status !== 'open') {
        // If resolved/cancelled, remove from list and update stats
        setLoops(prev => prev.filter(l => l.loop_id !== payload.loop_id));
        setStats((prev: any) => ({
          ...prev,
          open_count: String(Math.max(0, parseInt(prev.open_count || '0', 10) - 1)),
          resolved_count: payload.status === 'resolved' ? String(parseInt(prev.resolved_count || '0', 10) + 1) : prev.resolved_count,
          critical_open: payload.priority === 'critical' ? String(Math.max(0, parseInt(prev.critical_open || '0', 10) - 1)) : prev.critical_open,
          high_open: payload.priority === 'high' ? String(Math.max(0, parseInt(prev.high_open || '0', 10) - 1)) : prev.high_open,
        }));
      } else {
        // Just update in list
        setLoops(prev => prev.map(l => l.loop_id === payload.loop_id ? { ...l, ...payload } : l));
      }
    }
  }, [agentId]));

  const handleResolve = useCallback(async (loopId: string, status: string) => {
    try {
      const res = await fetch(`/api/actions/loops/${loopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution: resolutionText || `${status} from dashboard` })
      });
      if (!res.ok) throw new Error('Failed');
      setLoops(prev => prev.filter(l => l.loop_id !== loopId));
      setResolving(null);
      setResolutionText('');
      // Decrement open count
      setStats((prev: any) => ({
        ...prev,
        open_count: String(Math.max(0, parseInt(prev.open_count || '0', 10) - 1)),
        resolved_count: status === 'resolved'
          ? String(parseInt(prev.resolved_count || '0', 10) + 1)
          : prev.resolved_count
      }));
    } catch (error) {
      console.error('Failed to resolve loop:', error);
    }
  }, [resolutionText]);

  if (loading) {
    return <CardSkeleton />;
  }

  const openCount = parseInt(stats.open_count || '0', 10);
  const criticalCount = parseInt(stats.critical_open || '0', 10);
  const highCount = parseInt(stats.high_open || '0', 10);
  const resolvedCount = parseInt(stats.resolved_count || '0', 10);

  const LOOP_ITEM_H = 52;
  const STATS_H = 70;
  const maxVisibleLoops = tileHeight > 0 ? fitItems(tileHeight, LOOP_ITEM_H, STATS_H) : 3;
  const visibleLoops = loops.slice(0, maxVisibleLoops);
  const loopOverflow = loops.length - visibleLoops.length;

  const viewAllLink = (
    <Link href="/mission-control" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Open Loops<HelpIcon sectionKey="open-loops" tip={HELP_TIPS['open-loops']} /></span>} icon={CircleDot} action={viewAllLink}>
        {openCount > 0 && (
          <Badge variant="brand" size="sm">{openCount} Open</Badge>
        )}
        {criticalCount > 0 && (
          <Badge variant="error" size="sm">{criticalCount} Crit</Badge>
        )}
      </CardHeader>

      <CardContent>
        <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0">
        {/* Summary stats */}
        <div className="bg-surface-tertiary rounded-lg px-3 py-2.5 mb-4 flex-shrink-0">
          <div className="grid grid-cols-3 gap-2">
            <StatCompact label="Open" value={openCount} color="text-white" />
            <StatCompact label="High" value={highCount} color="text-warning" />
            <StatCompact label="Resolved" value={resolvedCount} color="text-success" />
          </div>
        </div>

        <div className="flex-1 min-h-0 space-y-2">
          {visibleLoops.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No open loops"
              description="Register open loops via the SDK's registerOpenLoop() or POST /api/actions/loops"
            />
          ) : (
            loops.map((loop) => {
              const TypeIcon = LOOP_TYPE_ICONS[loop.loop_type] || RefreshCw;
              const isResolving = resolving === loop.loop_id;

              return (
                <div
                  key={loop.loop_id}
                  className="px-3 py-2.5 rounded-lg bg-surface-tertiary border border-border transition-colors duration-150 hover:border-border-hover"
                >
                  <div className="flex items-start gap-3">
                    <TypeIcon size={14} className="text-secondary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-secondary truncate">{loop.description}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-tertiary">
                          {loop.agent_name || loop.agent_id || 'Unknown agent'}
                        </span>
                        <span className="text-[10px] text-disabled">{loop.loop_type}</span>
                      </div>
                    </div>
                    <Badge variant={getPriorityVariant(loop.priority)} size="xs">
                      {loop.priority}
                    </Badge>
                  </div>

                  {/* Inline resolution */}
                  {isResolving ? (
                    <div className="mt-2 pl-7 space-y-2">
                      <input
                        type="text"
                        placeholder="Resolution note (optional)"
                        value={resolutionText}
                        onChange={(e) => setResolutionText(e.target.value)}
                        className="w-full bg-surface-primary border border-border-hover rounded px-2 py-1 text-xs text-secondary placeholder-zinc-600 focus:outline-none focus:border-brand/50"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResolve(loop.loop_id, 'resolved')}
                          className="px-2 py-1 text-xs bg-status-success/10 text-success border border-green-500/20 rounded hover:bg-status-success/20 transition-colors"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleResolve(loop.loop_id, 'cancelled')}
                          className="px-2 py-1 text-xs bg-error-subtle text-error border border-error/20 rounded hover:bg-error-subtle transition-colors"
                        >
                          Cancel Loop
                        </button>
                        <button
                          onClick={() => { setResolving(null); setResolutionText(''); }}
                          className="px-2 py-1 text-xs text-tertiary hover:text-secondary transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5 pl-7 flex gap-1">
                      <button
                        onClick={() => setResolving(loop.loop_id)}
                        className="text-[10px] text-tertiary hover:text-success transition-colors"
                      >
                        resolve
                      </button>
                      <span className="text-[10px] text-zinc-700">|</span>
                      <button
                        onClick={() => handleResolve(loop.loop_id, 'cancelled')}
                        className="text-[10px] text-tertiary hover:text-error transition-colors"
                      >
                        cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
