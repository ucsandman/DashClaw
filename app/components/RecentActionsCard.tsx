'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Zap, Hammer, Rocket, FileText, Briefcase, Shield, MessageSquare,
  Link as LinkIcon, Calendar, Search, Eye, Wrench, RefreshCw, FlaskConical,
  Settings, Radio, AlertTriangle, Trash2, Package,
  CheckCircle2, XCircle, Clock, Loader2, Ban, HelpCircle, Inbox,
  ShieldCheck, ShieldAlert, ArrowRight
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { getAgentColor } from '../lib/colors';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

const TYPE_ICONS: Record<string, React.ElementType> = {
  build: Hammer,
  deploy: Rocket,
  post: FileText,
  apply: Briefcase,
  security: Shield,
  message: MessageSquare,
  api: LinkIcon,
  calendar: Calendar,
  research: Search,
  review: Eye,
  fix: Wrench,
  refactor: RefreshCw,
  test: FlaskConical,
  config: Settings,
  monitor: Radio,
  alert: AlertTriangle,
  cleanup: Trash2,
  sync: RefreshCw,
  migrate: Package,
};

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={14} className="text-success" />;
    case 'failed':
      return <XCircle size={14} className="text-error" />;
    case 'pending':
      return <Clock size={14} className="text-warning" />;
    case 'in-progress':
      return <Loader2 size={14} className="text-info" />;
    case 'cancelled':
      return <Ban size={14} className="text-tertiary" />;
    default:
      return <HelpCircle size={14} className="text-tertiary" />;
  }
}

export default function RecentActionsCard() {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  // Stable reference — passing an inline arrow to useRealtime fires its
  // ref-sync useEffect on every render. Memoizing by [agentId] keeps the
  // reference stable and the hook quiet.
  const handleRealtime = useCallback((event: any, payload: any) => {
    if (event === 'action.created') {
      // Filter if agentId is active
      if (agentId && payload.agent_id !== agentId) return;

      const newAction = {
        id: payload.action_id,
        type: payload.action_type || 'other',
        action: payload.declared_goal,
        agentId: payload.agent_id,
        agentName: payload.agent_name || payload.agent_id,
        platform: (() => {
          try {
            const systems = JSON.parse(payload.systems_touched || '[]');
            return systems[0] || 'System';
          } catch { return 'System'; }
        })(),
        timestamp: payload.timestamp_start,
        status: payload.status === 'running' ? 'in-progress' : payload.status,
        verified: payload.verified
      };
      setActions(prev => [newAction, ...prev].slice(0, 10));
    } else if (event === 'action.updated') {
      setActions(prev => prev.map(a => {
        if (a.id === payload.action_id) {
          return {
            ...a,
            status: payload.status === 'running' ? 'in-progress' : payload.status,
            timestamp: payload.timestamp_end || a.timestamp // Update time on completion
          };
        }
        return a;
      }));
    }
  }, [agentId]);
  useRealtime(handleRealtime);

  useEffect(() => {
    async function fetchActions() {
      try {
        const res = await fetch(`/api/actions?limit=10${agentId ? `&agent_id=${agentId}` : ''}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setActions((data.actions || []).map((a: any) => ({
          id: a.action_id,
          type: a.action_type || 'other',
          action: a.declared_goal,
          agentId: a.agent_id,
          agentName: a.agent_name || a.agent_id,
          platform: (() => {
            try {
              const systems = JSON.parse(a.systems_touched || '[]');
              return systems[0] || 'System';
            } catch { return 'System'; }
          })(),
          timestamp: a.timestamp_start,
          status: a.status === 'running' ? 'in-progress' : a.status,
          verified: a.verified
        })));
      } catch (error) {
        console.error('Failed to fetch actions:', error);
        setActions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchActions();
  }, [agentId]);

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return { time: '--:--', date: '----' };
    try {
      const d = new Date(timestamp);
      return {
        time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    } catch {
      const parts = timestamp.split(' ');
      return { time: parts[1] || '--:--', date: parts[0] || '----' };
    }
  };

  if (loading) {
    return (
      <Card className="h-full animate-pulse">
        <CardHeader title={<span className="flex items-center">Decision Ledger<HelpIcon sectionKey="actions" tip={HELP_TIPS['actions']} /></span>} icon={Zap} />
        <CardContent className="h-80 bg-secondary/50 rounded-lg" />
      </Card>
    );
  }

  const ITEM_H = 56;
  const OVERFLOW_LINK_H = 28;
  const maxVisible = tileHeight > 0 ? fitItems(tileHeight, ITEM_H, OVERFLOW_LINK_H) : 3;
  const visibleActions = actions.slice(0, maxVisible);
  const overflow = actions.length - visibleActions.length;

  const completed = actions.filter(a => a.status === 'completed').length;
  const running = actions.filter(a => a.status === 'in-progress').length;
  const pending = actions.filter(a => a.status === 'pending').length;
  const failed = actions.filter(a => a.status === 'failed').length;

  const viewAllLink = (
    <Link href="/decisions" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Decision Ledger<HelpIcon sectionKey="actions" tip={HELP_TIPS['actions']} /></span>} icon={Zap} count={actions.length} action={viewAllLink} />

      <CardContent>
        <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 space-y-2">
          {actions.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No recent actions"
              description="Use the SDK's createAction() or POST /api/actions to record governed decisions"
            />
          ) : (
            visibleActions.map((action) => {
              const { time, date } = formatTimestamp(action.timestamp);
              // Fallback for unknown types
              const TypeIcon = TYPE_ICONS[action.type] || Zap;
              // Generate consistent color based on agent ID
              const agentColorClass = getAgentColor(action.agentId);

              return (
                <Link
                  key={action.id}
                  href={`/actions/${action.id}`}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-zinc-800 hover:bg-tertiary/30 transition-all duration-200"
                >
                  {/* Type icon */}
                  <div className={`p-1.5 rounded-md bg-secondary/50 text-secondary group-hover:text-secondary transition-colors`}>
                    <TypeIcon size={14} />
                  </div>

                  {/* Action name + agent + system */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-secondary truncate group-hover:text-white transition-colors">
                      {action.action}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${agentColorClass} bg-opacity-10`}>
                        {action.agentName}
                        {action.verified && (
                          <ShieldCheck size={10} className="ml-1 text-success" aria-label="Verified Identity" />
                        )}
                      </span>
                      <span className="text-[10px] text-tertiary">•</span>
                      <span className="text-[10px] text-tertiary truncate max-w-[100px]">{action.platform}</span>
                    </div>
                  </div>

                  {/* Status + timestamp */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 pl-2 border-l border-zinc-800/50 ml-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-medium capitalize ${
                        action.status === 'completed' ? 'text-success' :
                        action.status === 'failed' ? 'text-error' :
                        action.status === 'in-progress' ? 'text-info' :
                        'text-warning'
                      }`}>
                        {action.status}
                      </span>
                      {action.status === 'completed' ? <CheckCircle2 size={12} className="text-success" /> :
                       action.status === 'failed' ? <XCircle size={12} className="text-error" /> :
                       action.status === 'in-progress' ? <Loader2 size={12} className="text-info animate-spin" /> :
                       <Clock size={12} className="text-warning" />}
                    </div>
                    <div className="text-[10px] text-disabled font-mono tracking-tight">
                      {date} {time}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
