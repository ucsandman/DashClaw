'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useRealtime } from '../hooks/useRealtime';
import {
  Activity, Zap, Shield, Terminal,
  ChevronRight, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { getAgentColor } from '../lib/colors';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { groupEventsByDay, summarizeDay } from './dayGrouping';

// Re-export day-grouping helpers so consumers that previously imported
// from the page module continue to resolve.
export { groupEventsByDay, summarizeDay };

const DAY_MS = 24 * 60 * 60 * 1000;

interface ActivityEvent {
  id: string;
  timestamp: string;
  category: 'decision' | 'guard' | 'audit';
  label: string;
  actor: string;
  actorId: string;
  detail: string;
  status: string;
  approvedBy?: string | null;
  reason?: string;
  matchedPolicies?: any[];
  link: string;
}

interface NarrativeCounts {
  total: number;
  requiredApproval: number;
  denied: number;
}

const categoryIconMap: Record<string, React.ElementType> = {
  decision: Zap,
  guard: Shield,
  audit: Terminal,
  signal: AlertTriangle,
};

// Plain-English recap of the activity in the selected scope window.
// Ported from the retired /my-agent surface.
function buildNarrative(scope: string, counts: NarrativeCounts): string {
  const when = scope === 'today' ? 'Today' : 'This week';
  if (counts.total === 0) {
    return `${when}, your agent hasn't run anything yet.`;
  }
  const cmd = `command${counts.total === 1 ? '' : 's'}`;
  const parts = [`${when} your agent ran ${counts.total} ${cmd}.`];
  if (counts.requiredApproval > 0) {
    parts.push(`${counts.requiredApproval} required approval.`);
  }
  if (counts.denied > 0) {
    const verb = counts.denied === 1 ? 'was' : 'were';
    parts.push(`${counts.denied} ${verb} denied.`);
  }
  return parts.join(' ');
}

function extractPolicyName(matchedPolicies: any): string | null {
  if (!Array.isArray(matchedPolicies) || matchedPolicies.length === 0) return null;
  const top = matchedPolicies[0];
  if (!top) return null;
  return top.name || top.policy_name || top.id || top.policy_id || null;
}

export default function GlobalActivityFeed() {
  const { agentId } = useAgentFilter();
  const [scope, setScope] = useState('today'); // 'today' | 'week'
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // Pull recent data from multiple sources to seed the activity feed.
      // When an agent is selected, scope actions + guard evaluations to it.
      // activity_logs is keyed on the human actor_id, so it's skipped when
      // filtering by agent — there are no agent-scoped audit events yet.
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      // Each fetch is independently failure-tolerant: a single 500 (e.g.
      // schema drift on guard_decisions) used to take down the entire feed
      // because Promise.all rejects on first failure. Now each source is
      // wrapped to resolve with {} on error, so the surviving endpoints
      // still render their data.
      const safeJson = (url: string): Promise<any> =>
        fetch(url)
          .then((r) => (r.ok ? r.json() : Promise.resolve({})))
          .catch(() => ({}));

      // Pull a week's worth (limit=200) so the scope toggle and narrative
      // counts have data to work with — the live feed itself stays capped
      // at 50 below.
      const fetches = [
        safeJson(`/api/actions?limit=200${agentQs}`),
        safeJson(`/api/guard?limit=200${agentQs}`),
      ];
      if (!agentId) fetches.push(safeJson('/api/activity?limit=10'));

      const [actionsData, guardData, auditData = {}] = await Promise.all(fetches);

      const actions = actionsData.actions || [];
      // /api/guard returns { decisions, total, stats }. The page used to read
      // .evaluations — a key this endpoint never returned — so guard rows
      // silently produced [] on every page load. POLICY EVALUATION events
      // would only survive in the live-stream buffer; on refresh they
      // vanished. Match the API contract.
      const guards = guardData.decisions || [];
      // /api/activity returns { events, stats, pagination }. Same bug class
      // as the guards key. Reading .logs silently produced [] forever, so
      // system-event audit rows never appeared on the activity feed at all
      // (there's also no realtime handler for them).
      const audits = auditData.events || [];

      // Normalize into unified event format
      const normalized: ActivityEvent[] = [
        ...actions.map((a: any) => ({
          id: `act-${a.action_id}`,
          timestamp: a.timestamp_start,
          category: 'decision' as const,
          label: a.status === 'completed' ? 'Decision finalized' : 'Intent declared',
          actor: a.agent_name || a.agent_id,
          actorId: a.agent_id,
          detail: a.declared_goal,
          status: a.status,
          // approved_by drives the narrative's "required approval" count.
          approvedBy: a.approved_by || null,
          link: `/decisions/${a.action_id}`
        })),
        ...guards.map((g: any) => ({
          id: `grd-${g.id}`,
          timestamp: g.created_at,
          category: 'guard' as const,
          label: 'Policy evaluation',
          actor: g.agent_name || g.agent_id,
          actorId: g.agent_id,
          // The /api/guard endpoint returns the joined-reason field as
          // `reasons` (guardrails compat aliases `reason AS reasons` for legacy
          // schemas). The realtime SSE payload publishes the same string as
          // `reason` (singular — see app/lib/guard.js publishOrgEvent). Read
          // both so neither code path renders "ALLOW: undefined".
          detail: `${g.decision.toUpperCase()}: ${g.reasons || g.reason || ''}`,
          status: g.decision,
          // Raw reason + matched policies feed the pinned denials section.
          reason: g.reasons || g.reason || '',
          matchedPolicies: g.matched_policies || [],
          link: `/decisions` // Guard doesn't have deep detail yet
        })),
        ...audits.map((l: any) => ({
          id: `aud-${l.id}`,
          timestamp: l.created_at,
          category: 'audit' as const,
          label: 'System event',
          actor: l.actor_name || 'System',
          actorId: l.actor_id,
          detail: `${l.action.replace(/\./g, ' ')}`,
          status: 'info',
          link: `/audit-log`
        }))
      ];

      // Sort by time
      normalized.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      // Keep enough history to cover the week scope; the live feed slices to
      // 50 at render time.
      setEvents(normalized);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to seed activity feed:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Handle real-time updates. Drop events from other agents when filtering.
  //
  // Three event types are handled here, mirroring the three normalized
  // categories the initial-load seed produces:
  //
  //   action.created / action.updated → 'decision' category. Status drives
  //     the label (running → "Intent declared", completed → "Decision
  //     finalized") so a record arriving as already-completed (the canonical
  //     dashclaw_record pattern) doesn't display "Intent declared" until the
  //     next refresh. action.updated is handled so live status transitions
  //     update the existing card instead of being silently dropped.
  //
  //   guard.decision.created → 'guard' category. SSE publishes `reason`
  //     (singular, joined string from app/lib/guard.js:257) but the REST
  //     API returns `reasons` — fallback reads both so the cell never
  //     renders "undefined".
  //
  //   decision.created is intentionally NOT handled here. That event is
  //     published by /api/learning POST when a learning record is created,
  //     and its payload shape (learning_decisions row: id, decision,
  //     context, outcome, confidence, agent_id, created_at) doesn't match
  //     the action shape the rest of this handler assumes. Learning events
  //     have their own UI at /learning.
  //
  // IDs are stable (no Date.now() suffix) so a realtime event updates the
  // matching seed row in place instead of duplicating it.
  useRealtime((event: string, payload: any) => {
    if (agentId && payload?.agent_id && payload.agent_id !== agentId) return;

    let newEvt: ActivityEvent | null = null;
    let updateOnly = false;

    if (event === 'action.created' || event === 'action.updated') {
      const status = payload.status || 'running';
      newEvt = {
        id: `act-${payload.action_id}`,
        timestamp: payload.timestamp_start || payload.created_at || new Date().toISOString(),
        category: 'decision',
        label: status === 'completed' ? 'Decision finalized' : 'Intent declared',
        actor: payload.agent_name || payload.agent_id,
        actorId: payload.agent_id,
        detail: payload.declared_goal,
        status,
        approvedBy: payload.approved_by || null,
        link: payload.action_id ? `/decisions/${payload.action_id}` : `/decisions`,
      };
      updateOnly = event === 'action.updated';
    } else if (event === 'guard.decision.created') {
      newEvt = {
        id: `grd-${payload.id}`,
        timestamp: payload.created_at || new Date().toISOString(),
        category: 'guard',
        label: 'Policy evaluation',
        actor: payload.agent_name || payload.agent_id,
        actorId: payload.agent_id,
        detail: `${(payload.decision || 'unknown').toUpperCase()}: ${payload.reason || payload.reasons || ''}`,
        status: payload.decision,
        reason: payload.reason || payload.reasons || '',
        matchedPolicies: payload.matched_policies || [],
        link: `/decisions`,
      };
    }

    if (newEvt) {
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.id === newEvt!.id);
        if (idx >= 0) {
          // Replace in place — preserves position, prevents duplication when
          // a realtime event arrives for an action that's already in the seed.
          const next = prev.slice();
          next[idx] = newEvt!;
          return next;
        }
        // action.updated for an action not currently in our window — ignore
        // rather than prepending a fragmented update at the top.
        if (updateOnly) return prev;
        // Keep a week's worth of history (cap at the fetch limit) so the
        // scope toggle + narrative counts stay accurate; the live feed
        // slices to 50 at render time.
        const merged = [newEvt!, ...prev];
        merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return merged.slice(0, 200);
      });
      setLastUpdated(new Date().toLocaleTimeString());
    }
  });

  // Scope the unified event stream to the selected time window. The narrative,
  // denials pin, and live feed all read from this filtered set.
  const scopedEvents = useMemo(() => {
    const cutoff = Date.now() - (scope === 'today' ? DAY_MS : 7 * DAY_MS);
    return events.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [events, scope]);

  const counts = useMemo<NarrativeCounts>(() => {
    let total = 0;
    let requiredApproval = 0;
    let denied = 0;
    for (const e of scopedEvents) {
      if (e.category === 'decision') {
        total += 1;
        if (e.approvedBy) requiredApproval += 1;
      } else if (e.category === 'guard' && (e.status === 'block' || e.status === 'deny')) {
        denied += 1;
      }
    }
    return { total, requiredApproval, denied };
  }, [scopedEvents]);

  const denials = useMemo(
    () => scopedEvents.filter((e) => e.category === 'guard' && (e.status === 'block' || e.status === 'deny')),
    [scopedEvents]
  );

  const hasAnyActivity = events.length > 0;

  // D-13: client-side day-grouping. Presentational layer only — wraps the
  // existing per-event render with a one-line English summary per day.
  // Live feed is capped at 50 events within the scope window.
  const groupedByDay = useMemo(() => groupEventsByDay(scopedEvents.slice(0, 50)), [scopedEvents]);

  const narrative = buildNarrative(scope, counts);
  const narrativeClass = counts.denied > 0 ? 'text-status-warning' : 'text-primary';

  const getStatusColor = (category: string, status: string) => {
    if (category === 'guard') {
      if (status === 'block') return 'text-error bg-error-subtle border-error/30';
      if (status === 'warn') return 'text-warning bg-warning-subtle border-warning/30';
      if (status === 'require_approval') return 'text-info bg-info-subtle border-blue-500/30';
      return 'text-success bg-success-subtle border-success/30';
    }
    if (status === 'completed' || status === 'success') return 'text-success bg-success-subtle border-success/30';
    if (status === 'failed' || status === 'error') return 'text-error bg-error-subtle border-error/30';
    if (status === 'running' || status === 'pending') return 'text-warning bg-warning-subtle border-warning/30';
    return 'text-secondary bg-white/5 border-border';
  };

  const formatTime = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return '--'; }
  };

  // Install-prompt hero for zero-activity instances (ported from /my-agent).
  if (!loading && !hasAnyActivity) {
    return <InstallPromptHero />;
  }

  return (
    <PageLayout
      title="Activity stream"
      subtitle={`Real-time operational telemetry across decisions, governance, and system events${lastUpdated ? ` · Updated ${lastUpdated}` : ''}`}
      breadcrumbs={['Command', 'Activity']}
      maturity="beta"
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Narrative hero — a plain-English recap of the scope window. */}
        <Card hover={false}>
          <CardContent className="py-6">
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <p className={`text-xl font-semibold leading-snug ${narrativeClass}`}>
                {narrative}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Today / This week scope toggle */}
        <div className="flex items-center gap-2" role="group" aria-label="Scope">
          <button
            type="button"
            onClick={() => setScope('today')}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === 'today'
                ? 'border-active bg-white/5 text-primary'
                : 'border-border text-secondary hover:border-border-hover'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setScope('week')}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === 'week'
                ? 'border-active bg-white/5 text-primary'
                : 'border-border text-secondary hover:border-border-hover'
            }`}
          >
            This week
          </button>
        </div>

        {/* Pinned denials — surfaced above the live feed. */}
        {denials.length > 0 && (
          <section data-testid="denials-section">
            <header className="mb-2 flex items-center gap-2">
              <ShieldAlert size={14} className="text-status-warning" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-status-warning">
                Denied actions
              </span>
            </header>
            <Card hover={false}>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {denials.map((d) => {
                    const policy = extractPolicyName(d.matchedPolicies);
                    return (
                      <li key={d.id} className="flex items-start gap-3 p-4">
                        <AlertTriangle
                          size={14}
                          className="mt-1 shrink-0 text-status-warning"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(d.actorId)}`}
                            >
                              {d.actor || 'unknown'}
                            </span>
                            {policy && (
                              <span className="rounded-full border border-border bg-surface-tertiary px-2 py-0.5 font-mono text-[10px] text-secondary">
                                {policy}
                              </span>
                            )}
                            <span className="font-mono text-[10px] tabular-nums text-tertiary">
                              {formatTime(d.timestamp)}
                            </span>
                          </div>
                          <p className="text-sm text-secondary">{d.reason}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Live feed */}
        <Card hover={false}>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-success" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">Live feed</h2>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] tabular-nums text-tertiary">
              Retention · 50 events
            </div>
          </div>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 p-6">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
              </div>
            ) : scopedEvents.length === 0 ? (
              <div className="p-12">
                <EmptyState
                  icon={Activity}
                  title="No activity in this window"
                  description={scope === 'today' ? 'Switch to This week for a broader view.' : 'No activity in the last 7 days.'}
                />
              </div>
            ) : (
              <div>
                {groupedByDay.map((group) => (
                  <section key={group.dayKey}>
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-tertiary/40 px-4 py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">
                        {group.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-tertiary">
                        {summarizeDay(group)}
                      </span>
                    </header>
                    <div className="divide-y divide-border">
                      {group.events.map((evt: ActivityEvent) => {
                        const Icon = categoryIconMap[evt.category] || Activity;
                        return (
                          <div key={evt.id} data-entity-type="auditEvent" data-entity-id={evt.id} className="group relative p-4 transition-colors hover:bg-white/[0.02]">
                            <div className="flex items-start gap-4">
                              {/* Time & Icon */}
                              <div className="flex min-w-[60px] flex-col items-center gap-2 pt-1">
                                <span className="font-mono text-[11px] tabular-nums text-tertiary">
                                  {formatTime(evt.timestamp)}
                                </span>
                                <div className="rounded-lg border border-border bg-surface-tertiary p-1.5 transition-colors group-hover:border-border-hover">
                                  <Icon size={14} className="text-secondary" aria-hidden="true" />
                                </div>
                              </div>

                              {/* Content */}
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                    {evt.label}
                                  </span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(evt.actorId)}`}>
                                    {evt.actor}
                                  </span>
                                </div>
                                <div className="line-clamp-2 text-sm leading-relaxed text-secondary">
                                  {evt.detail}
                                </div>
                              </div>

                              {/* Status & Action */}
                              <div className="flex flex-col items-end gap-2 pt-1">
                                <div className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusColor(evt.category, evt.status)}`}>
                                  {evt.status}
                                </div>
                                {evt.link && (
                                  <a
                                    href={evt.link}
                                    className="flex items-center gap-0.5 text-[11px] font-medium text-secondary transition-colors hover:text-brand"
                                  >
                                    Details
                                    <ChevronRight size={11} aria-hidden="true" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

// Empty-state install-prompt hero for zero-activity instances. Ported from the
// retired /my-agent surface: 3-step hook install + Claude Code/Codex/Hermes
// guide links.
function InstallPromptHero() {
  return (
    <PageLayout title="Activity stream" breadcrumbs={['Command', 'Activity']} maturity="beta">
      <div className="mx-auto max-w-2xl">
        <Card hover={false}>
          <CardContent className="py-10 text-center">
            <Terminal
              size={28}
              className="mx-auto mb-4 text-tertiary"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <h2 className="text-xl font-semibold text-primary">
              Your agent hasn&apos;t run anything yet.
            </h2>
            <p className="mt-2 text-sm text-secondary">
              Three steps to get a coding agent governed, with Discord approvals
              on your phone. Works with Claude Code, Codex, and Hermes Agent.
            </p>
            <ol className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-secondary">
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">1.</span>
                <span>
                  Install the hook{' '}
                  <code className="font-mono text-xs text-primary">npm run hooks:install</code>{' '}
                  (or{' '}
                  <code className="font-mono text-xs text-primary">dashclaw install codex</code>{' '}
                  /{' '}
                  <code className="font-mono text-xs text-primary">bash scripts/install-hermes-plugin.sh</code>)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">2.</span>
                <span>Connect Discord (bot token + approver user ID)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="font-mono text-tertiary tabular-nums">3.</span>
                <span>Trigger a tool call from your agent</span>
              </li>
            </ol>
            <Link
              href="/guides/claude-code"
              className="mt-6 inline-flex items-center gap-1 rounded-md border border-active/30 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/20"
            >
              Open the full guide
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
            <div className="mt-3 text-xs text-tertiary">
              <Link href="/guides/codex" className="underline decoration-border hover:decoration-secondary">
                Codex
              </Link>
              {' · '}
              <Link href="/guides/hermes" className="underline decoration-border hover:decoration-secondary">
                Hermes Agent
              </Link>
              {' · '}
              <Link href="/connect" className="underline decoration-border hover:decoration-secondary">
                all guides
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
