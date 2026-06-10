'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Clock, Play, CheckCircle2, XCircle, AlertTriangle, CircleDot, Brain,
  ArrowRight, Shield, Loader2, Target, EyeOff, Eye, Siren, ShieldCheck,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import {
  buildActionEvent,
  buildAssumptionEvent,
  buildGuardEvent,
  buildLearningEvent,
  buildLoopEvent,
  collapseRoutineTelemetry,
  isPriorityEvent,
  OPERATOR_CHANNEL_OPTIONS,
} from '../lib/missionControl';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

interface ActivityTimelineProps {
  activeCategory?: string;
  onCategoryChange?: ((id: any) => void) | null;
  showTelemetry?: boolean;
  onToggleTelemetry?: (() => void) | null;
}

function getEventIcon(event: any) {
  switch (event.category) {
    case 'decision':
      if (event.status === 'completed') return <CheckCircle2 size={14} className="text-success" />;
      if (event.status === 'failed') return <XCircle size={14} className="text-error" />;
      if (event.status === 'running') return <Loader2 size={14} className="text-info animate-spin" />;
      if (event.status === 'pending_approval') return <AlertTriangle size={14} className="text-warning" />;
      return <Play size={14} className="text-sky-400" />;
    case 'intervention':
      return event.status === 'resolved'
        ? <CheckCircle2 size={14} className="text-success" />
        : <Siren size={14} className="text-warning" />;
    case 'governance':
      if (event.status === 'block') return <Shield size={14} className="text-error" />;
      if (event.status === 'require_approval') return <AlertTriangle size={14} className="text-warning" />;
      return <ShieldCheck size={14} className="text-success" />;
    case 'outcome':
      return <Brain size={14} className="text-cyan-400" />;
    case 'telemetry':
      return <CircleDot size={14} className="text-tertiary" />;
    default:
      return <Clock size={14} className="text-secondary" />;
  }
}

function getCategoryLabel(category: any) {
  switch (category) {
    case 'decision': return 'Decision';
    case 'intervention': return 'Intervention';
    case 'governance': return 'Governance';
    case 'outcome': return 'Outcome';
    case 'telemetry': return 'Telemetry';
    default: return 'Event';
  }
}

function getCategoryColor(category: any) {
  switch (category) {
    case 'decision': return 'text-sky-300';
    case 'intervention': return 'text-warning';
    case 'governance': return 'text-error';
    case 'outcome': return 'text-cyan-300';
    case 'telemetry': return 'text-tertiary';
    default: return 'text-secondary';
  }
}

function getCategoryBorder(event: any) {
  if (event.category === 'governance') return 'border-l-2 border-l-amber-500/60';
  if (event.category === 'intervention' || event.status === 'block' || event.status === 'failed') return 'border-l-2 border-l-red-500/60';
  if (['completed', 'resolved'].includes(event.status) && event.category === 'outcome') return 'border-l-2 border-l-emerald-500/60';
  if (event.category === 'decision') return 'border-l-2 border-l-blue-500/40';
  return 'border-l-2 border-l-border';
}

function getStatusVariant(status: any) {
  if (['completed', 'resolved', 'allow', 'success', 'validated'].includes(status)) return 'success';
  if (['failed', 'block', 'failure', 'invalidated'].includes(status)) return 'error';
  if (['running', 'pending', 'pending_approval', 'unresolved_assumption', 'warn', 'open', 'require_approval'].includes(status)) return 'warning';
  return 'default';
}

function formatTimestamp(ts: any) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatLifecycle(event: any) {
  if (event.category === 'decision') {
    if (event.status === 'running' && event.startedAt) {
      return `Started ${formatTimestamp(event.startedAt)}`;
    }
    if (event.endedAt) {
      return `${event.statusLabel} ${formatTimestamp(event.endedAt)}`;
    }
    if (event.startedAt) {
      return `${event.statusLabel} ${formatTimestamp(event.startedAt)}`;
    }
  }

  if (event.category === 'intervention') {
    if (event.status === 'open' && event.startedAt) return `Opened ${formatTimestamp(event.startedAt)}`;
    if (event.endedAt) return `${event.statusLabel} ${formatTimestamp(event.endedAt)}`;
  }

  return formatTimestamp(event.timestamp);
}

function groupByDay(events: any[]): [string, any[]][] {
  const groups: Record<string, any[]> = {};
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const event of events) {
    const dateStr = new Date(event.timestamp).toDateString();
    let label;
    if (dateStr === today) label = 'Today';
    else if (dateStr === yesterday) label = 'Yesterday';
    else label = new Date(event.timestamp).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const bucket = (groups[label] ??= []);
    bucket.push(event);
  }
  return Object.entries(groups);
}

function buildChainRows(events: any[]) {
  const actionMap = new Map(
    events
      .filter((event) => event.entityType === 'action')
      .map((event) => [event.entityId, event])
  );
  const childMap = new Map<any, any[]>();
  const childIds = new Set();

  for (const event of events) {
    if (event.entityType !== 'action' || !event.parentActionId) continue;
    if (!actionMap.has(event.parentActionId)) continue;
    const existing = childMap.get(event.parentActionId) || [];
    existing.push(event);
    childMap.set(event.parentActionId, existing);
    childIds.add(event.id);
  }

  return events
    .filter((event) => !childIds.has(event.id))
    .map((event) => ({
      ...event,
      spawnedChildren: (childMap.get(event.entityId) || []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    }));
}

export default function ActivityTimeline({
  activeCategory = 'all',
  onCategoryChange = null,
  showTelemetry = false,
  onToggleTelemetry = null,
}: ActivityTimelineProps) {
  const { agentId } = useAgentFilter();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChains, setExpandedChains] = useState<Record<string, boolean>>({});
  // Uncontrolled fallback: the dashboard mounts this tile with no controller
  // props (DraggableDashboard renders bare <Component />), so without internal
  // state every pill click is a no-op. Controlled props still win when passed.
  const [internalCategory, setInternalCategory] = useState('all');
  const [internalTelemetry, setInternalTelemetry] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const queryAgent = agentId ? `agent_id=${encodeURIComponent(agentId)}` : '';
      const withPrefix = (base: string, extra: string[] = []) => {
        const params = [...extra];
        if (queryAgent) params.push(queryAgent);
        return `${base}${params.length ? `?${params.join('&')}` : ''}`;
      };

      const [actionsRes, loopsRes, guardRes, assumptionsRes] = await Promise.all([
        fetch(withPrefix('/api/actions', ['limit=24'])),
        fetch(withPrefix('/api/actions/loops', ['limit=12'])),
        fetch(withPrefix('/api/guard', ['limit=12'])),
        fetch(withPrefix('/api/assumptions', ['limit=16'])),
      ]);

      const merged = [];

      if (actionsRes.ok) {
        const actionsData = await actionsRes.json();
        merged.push(...(actionsData.actions || []).map(buildActionEvent));
      }

      if (loopsRes.ok) {
        const loopsData = await loopsRes.json();
        merged.push(...(loopsData.loops || []).map(buildLoopEvent));
      }

      if (guardRes.ok) {
        const guardData = await guardRes.json();
        merged.push(...(guardData.decisions || []).map(buildGuardEvent));
      }

      if (assumptionsRes.ok) {
        const assumptionsData = await assumptionsRes.json();
        merged.push(...(assumptionsData.assumptions || []).map(buildAssumptionEvent));
      }

      setEvents(collapseRoutineTelemetry(merged).slice(0, 60));
    } catch (error) {
      console.error('Timeline fetch error:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useRealtime(useCallback((event: any, payload: any) => {
    let next = null;

    if (event === 'action.created' || event === 'action.updated') {
      const action = payload.action || payload;
      if (agentId && action.agent_id !== agentId) return;
      next = buildActionEvent(action);
    } else if (event === 'decision.created') {
      const decision = payload.decision || payload;
      if (agentId && decision.agent_id !== agentId) return;
      next = buildLearningEvent(decision);
    } else if (event === 'loop.created' || event === 'loop.updated') {
      const loop = payload.loop || payload;
      if (agentId && loop.agent_id !== agentId) return;
      next = buildLoopEvent(loop);
    } else if (event === 'guard.decision.created') {
      const guard = payload.guardDecision || payload.decision || payload;
      if (agentId && guard.agent_id !== agentId) return;
      next = buildGuardEvent(guard);
    }

    if (!next) return;

    setEvents((prev) => {
      const filtered = prev.filter((item) => item.id !== next.id);
      return collapseRoutineTelemetry([next, ...filtered]).slice(0, 60);
    });
  }, [agentId]));

  if (loading) return <CardSkeleton />;

  // Controlled when a parent supplies onCategoryChange/onToggleTelemetry;
  // otherwise the internal state owns the filter (dashboard tile case).
  const category = onCategoryChange ? activeCategory : internalCategory;
  const setCategory = onCategoryChange || setInternalCategory;
  const telemetryOn = onToggleTelemetry ? showTelemetry : internalTelemetry;
  const toggleTelemetry = onToggleTelemetry || (() => setInternalTelemetry((v) => !v));
  const isPriority = category === 'priority';
  const baseEvents = telemetryOn ? events : events.filter((event) => !event.lowSignal);
  const filteredEvents = isPriority
    ? baseEvents.filter(isPriorityEvent).slice(0, 15)
    : category === 'all'
      ? baseEvents
      : baseEvents.filter((event) => event.category === category);
  const telemetryCount = events.filter((event) => event.lowSignal).reduce((sum, event) => sum + (event.count || 1), 0);
  const prominentCount = filteredEvents.length;
  const grouped = groupByDay(buildChainRows(filteredEvents));
  const emptyForCategory = category !== 'all' && category !== 'priority' && filteredEvents.length === 0;
  const hasAnyEvents = events.length > 0;

  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader title={<span className="flex items-center">Activity Timeline<HelpIcon sectionKey="activity-timeline" tip={HELP_TIPS['activity-timeline']} /></span>} icon={Clock}>
        <div className="flex items-center gap-2">
          <Badge variant="brand" size="sm">{prominentCount} {isPriority ? 'priority' : 'shown'}</Badge>
          {telemetryCount > 0 && isPriority && (
            <button
              type="button"
              onClick={toggleTelemetry}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-secondary transition-colors hover:text-white"
            >
              {telemetryOn ? <EyeOff size={11} /> : <Eye size={11} />}
              {telemetryOn ? 'Hide routine telemetry' : `Show ${telemetryCount} routine updates`}
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-tertiary">
            <span>Priority events stay visible by default.</span>
            {telemetryCount > 0 && <span>Routine monitor churn is collapsed until you ask for it.</span>}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {OPERATOR_CHANNEL_OPTIONS.map((option: any) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCategory(option.id)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                  category === option.id
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-white/10 text-tertiary hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {!hasAnyEvents ? (
            <EmptyState
              icon={Target}
              title="No governed decisions yet"
              description="Mission Control will turn agent goals, guard interventions, assumptions, and outcomes into an operator-readable timeline."
            />
          ) : isPriority && filteredEvents.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No priority events right now"
              description="No governance actions, interventions, or failed outcomes require your attention. Switch to ALL to see the full event stream."
            />
          ) : emptyForCategory ? (
            <EmptyState
              icon={Target}
              title={`No ${category} events right now`}
              description="This filter is empty for the current dataset. Switch to another category or show routine telemetry to inspect lower-signal updates."
            />
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {grouped.map(([dayLabel, dayEvents]) => (
                  <div key={dayLabel} className="mb-4 last:mb-0">
                    <div className="mb-2 bg-surface-secondary py-1 text-[10px] font-semibold uppercase tracking-wider text-disabled">
                      {dayLabel}
                    </div>
                    <div className="relative">
                      <div className="absolute left-[7px] top-4 bottom-4 w-px bg-white/[0.06]" />

                      <div className="space-y-2">
                        {dayEvents.map((event: any) => {
                          const href =
                            event.entityType === 'action'
                              ? `/actions/${event.entityId}`
                              : event.entityType === 'loop' && event.actionId
                                ? `/actions/${event.actionId}`
                                : null;

                          const isExpanded = !!expandedChains[event.id];

                          const content = (
                            <div className={`rounded-lg border px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${getCategoryBorder(event)} ${event.lowSignal ? 'border-border bg-white/[0.015]' : 'border-border-hover bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))]'} transition-colors ${href ? 'group-hover:border-white/20 hover:bg-white/5 cursor-pointer' : ''}`}>
                              <div className="flex items-start gap-3">
                                <div className="relative z-[1] mt-1 flex-shrink-0">
                                  {getEventIcon(event)}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 flex flex-wrap items-center gap-2">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${getCategoryColor(event.category)}`}>
                                      {getCategoryLabel(event.category)}
                                    </span>
                                    <span className="truncate text-sm font-medium text-white">{event.title}</span>
                                    <Badge variant={getStatusVariant(event.status)} size="xs">{event.statusLabel}</Badge>
                                    {event.priority === 'critical' && <Badge variant="error" size="xs">Critical</Badge>}
                                    {event.priority === 'high' && <Badge variant="warning" size="xs">High priority</Badge>}
                                  </div>

                                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-tertiary">
                                    {event.goal && <span><span className="text-disabled">Goal:</span> {event.goal}</span>}
                                    {event.actionType && <span><span className="text-disabled">Action:</span> {event.actionType}</span>}
                                    {event.agentName && <span className="font-mono">{event.agentName}</span>}
                                    {event.parentActionId && <span><span className="text-disabled">Parent:</span> {event.parentActionId}</span>}
                                  </div>

                                  {event.outputSummary && (
                                    <p className={`mb-2 text-xs leading-5 ${event.lowSignal ? 'text-tertiary' : 'text-secondary'}`}>
                                      {event.outputSummary}
                                    </p>
                                  )}

                                  {event.spawnedChildren?.length > 0 && (
                                    <div className="mb-2">
                                      <button
                                        type="button"
                                        onClick={(clickEvent) => {
                                          clickEvent.preventDefault();
                                          clickEvent.stopPropagation();
                                          setExpandedChains((prev) => ({ ...prev, [event.id]: !prev[event.id] }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-secondary transition-colors hover:border-white/20 hover:text-white"
                                      >
                                        {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                        {event.spawnedChildren.length} spawned {event.spawnedChildren.length === 1 ? 'action' : 'actions'}
                                      </button>

                                      {isExpanded && (
                                        <div className="mt-2 space-y-2 border-l border-white/10 pl-3">
                                          {event.spawnedChildren.map((child: any) => (
                                            <Link
                                              key={child.id}
                                              href={`/actions/${child.entityId}`}
                                              className="block rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/15"
                                            >
                                              <div className="mb-1 flex items-center gap-2">
                                                <span className="text-xs font-medium text-white">{child.title}</span>
                                                <Badge variant={getStatusVariant(child.status)} size="xs">{child.statusLabel}</Badge>
                                              </div>
                                              <div className="text-[11px] text-tertiary">
                                                {child.actionType && <span>Action: {child.actionType}</span>}
                                                {child.goal && <span className="ml-3">Goal: {child.goal}</span>}
                                              </div>
                                              {child.outputSummary && (
                                                <div className="mt-1 text-xs text-secondary">{child.outputSummary}</div>
                                              )}
                                            </Link>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                                    <span>{formatLifecycle(event)}</span>
                                    {event.riskScore != null && (
                                      <span className={`inline-flex items-center gap-1 ${event.riskScore >= 70 ? 'text-error' : 'text-tertiary'}`}>
                                        <AlertTriangle size={10} />
                                        Risk {event.riskScore}
                                      </span>
                                    )}
                                    {event.confidence != null && (
                                      <span>Confidence {event.confidence}%</span>
                                    )}
                                    {event.aggregate && (
                                      <span>{event.count} items collapsed</span>
                                    )}
                                  </div>
                                </div>

                                {href && (
                                  <ArrowRight size={14} className="mt-1 flex-shrink-0 text-disabled transition-colors group-hover:text-white" />
                                )}
                              </div>
                            </div>
                          );

                          if (href) {
                            return (
                              <Link key={event.id} href={href} className="group block">
                                {content}
                              </Link>
                            );
                          }

                          return <div key={event.id}>{content}</div>;
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
