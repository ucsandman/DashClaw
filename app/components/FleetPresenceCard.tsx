'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, ShieldCheck, ShieldAlert, Cpu, Timer, Wifi, WifiOff } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { StatCompact } from './ui/Stat';
import { CardSkeleton } from './ui/Skeleton';
import { useRealtime } from '../hooks/useRealtime';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips.js';

export default function FleetPresenceCard() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasLoaded = useRef(false);

  // useCallback so handleRealtime closes over a stable reference rather than
  // capturing the inaugural fetchAgents — without this, the realtime handler
  // would keep calling whichever fetchAgents identity existed when it was
  // first memoized.
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
        setError(false);
        hasLoaded.current = true;
      } else if (!hasLoaded.current) {
        // Initial load failed with no prior data — surface a visible error.
        setError(true);
      } else {
        // Periodic refresh failed; keep prior data rather than blanking it.
        console.warn('Failed to refresh fleet presence (status=', res.status, ')');
      }
    } catch (err) {
      if (!hasLoaded.current) {
        setError(true);
      } else {
        console.warn('Failed to refresh fleet presence:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 60000); // Poll once a minute as fallback
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const handleRealtime = useCallback((event: any) => {
    if (event === 'agent.heartbeat' || event === 'action.created') {
      fetchAgents();
    }
  }, [fetchAgents]);
  useRealtime(handleRealtime);

  if (loading) return <CardSkeleton />;

  if (error) {
    return (
      <Card className="h-full">
        <CardHeader
          title={<span className="flex items-center">Agent Fleet Presence<HelpIcon sectionKey="fleet-presence" tip={HELP_TIPS['fleet-presence']} /></span>}
          icon={Cpu}
        />
        <CardContent>
          <div className="rounded-2xl border border-border bg-surface-secondary py-12 text-center">
            <div className="text-sm text-error mb-3">Failed to load fleet presence.</div>
            <button
              onClick={fetchAgents}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const onlineAgents = agents.filter(a => a.presence_state === 'online');
  const staleAgents = agents.filter(a => a.presence_state === 'stale');
  const totalAgents = agents.length;
  const inactiveCount = totalAgents - onlineAgents.length;

  // Format helper for display
  const formatTime = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return 'Never';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <Card className="h-full">
      <CardHeader
        title={<span className="flex items-center">Agent Fleet Presence<HelpIcon sectionKey="fleet-presence" tip={HELP_TIPS['fleet-presence']} /></span>}
        icon={Cpu}
        count={onlineAgents.length}
      />
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-status-success/5 border border-success/10">
              <div className="text-xl font-bold text-success tabular-nums">{onlineAgents.length}</div>
              <div className="text-[10px] text-tertiary uppercase font-semibold">Online</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-500/5 border border-zinc-500/10">
              <div className="text-xl font-bold text-secondary tabular-nums">{inactiveCount}</div>
              <div className="text-[10px] text-tertiary uppercase font-semibold">Inactive</div>
            </div>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {agents.map((agent) => {
              const isOnline = agent.presence_state === 'online';
              const isStale = agent.presence_state === 'stale';

              let statusColor = 'text-disabled';
              let ringColor = 'ring-zinc-600';
              let dotColor = 'bg-zinc-500';
              let statusTextClass = 'text-tertiary';

              if (isOnline) {
                statusColor = 'text-success';
                ringColor = 'ring-emerald-500';
                dotColor = 'bg-status-success';
                statusTextClass = 'text-success';
              } else if (isStale) {
                statusColor = 'text-warning';
                ringColor = 'ring-amber-500';
                dotColor = 'bg-status-warning';
                statusTextClass = 'text-warning';
              }

              return (
                <div key={agent.agent_id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <Cpu size={16} className={isOnline ? 'text-brand' : 'text-disabled'} />
                      {(isOnline || isStale) && (
                        <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${dotColor} ring-2 ring-surface-primary`} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-secondary truncate">{agent.agent_name || agent.agent_id}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-tertiary font-mono" title={agent.agent_id}>
                          {agent.agent_id.slice(0, 8)}...
                        </span>
                        {agent.current_task_id && (
                          <Badge variant="info" size="xs" className="px-1 py-0 h-3.5 max-w-[80px] truncate">
                            task:{agent.current_task_id.slice(0, 6)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className={`text-[10px] font-medium flex items-center gap-1 ${statusTextClass}`}>
                      {isOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
                      {agent.presence_state ? (agent.presence_state.charAt(0).toUpperCase() + agent.presence_state.slice(1)) : 'Unknown'}
                    </div>
                    <div className="text-[9px] text-disabled mt-0.5" title={agent.last_seen_at}>
                      {formatTime(agent.seconds_since_seen)}
                    </div>
                  </div>
                </div>
              );
            })}

            {agents.length === 0 && (
              <div className="py-8 text-center text-xs text-tertiary italic">No agents registered in fleet</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
