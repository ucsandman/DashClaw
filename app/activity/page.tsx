'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useRealtime } from '../hooks/useRealtime';
import {
  Activity, Zap, Shield, Terminal,
  ChevronRight, ChevronDown, AlertTriangle, ShieldAlert,
  Pause, Play,
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
  /** Distinct decision actors in the scope window. */
  distinctAgents: number;
}

// Update cadence for the live feed. 'live' applies SSE events immediately;
// 'batch' buffers and flushes every BATCH_FLUSH_MS; 'paused' buffers until an
// explicit resume / jump-to-live.
type Cadence = 'live' | 'batch' | 'paused';
const BATCH_FLUSH_MS = 10_000;
const PENDING_CAP = 200;

const categoryIconMap: Record<string, React.ElementType> = {
  decision: Zap,
  guard: Shield,
  audit: Terminal,
  signal: AlertTriangle,
};

// Plain-English recap of the activity in the selected scope window. The total
// comes from the windowed API count (true COUNT(*)), never the buffer length,
// and the subject pluralizes from the distinct actors actually seen.
function buildNarrative(scope: string, counts: NarrativeCounts, filteredToOneAgent: boolean): string {
  const when = scope === 'today' ? 'Today' : 'This week';
  const subject = filteredToOneAgent || counts.distinctAgents <= 1
    ? 'your agent'
    : `your ${counts.distinctAgents} agents`;
  if (counts.total === 0) {
    return `${when}, ${subject === 'your agent' ? 'your agent' : 'your agents'} ${subject === 'your agent' ? "hasn't" : "haven't"} run anything yet.`;
  }
  const cmd = `command${counts.total === 1 ? '' : 's'}`;
  const parts = [`${when} ${subject} ran ${counts.total} ${cmd}.`];
  if (counts.requiredApproval > 0) {
    parts.push(`${counts.requiredApproval} required approval.`);
  }
  if (counts.denied > 0) {
    const verb = counts.denied === 1 ? 'was' : 'were';
    parts.push(`${counts.denied} ${verb} denied.`);
  }
  return parts.join(' ');
}

// Merge one realtime event into the buffer: replace in place when the id is
// already present (prevents duplication when a realtime event arrives for an
// action that's already in the seed); otherwise prepend, sort, cap at 200.
// action.updated for an unknown action is ignored rather than prepended as a
// fragmented update.
function mergeEvent(prev: ActivityEvent[], newEvt: ActivityEvent, updateOnly: boolean): ActivityEvent[] {
  const idx = prev.findIndex((e) => e.id === newEvt.id);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = newEvt;
    return next;
  }
  if (updateOnly) return prev;
  const merged = [newEvt, ...prev];
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return merged.slice(0, 200);
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
  // True windowed action totals from the API (COUNT(*), not buffer lengths).
  const [apiTotals, setApiTotals] = useState<{ today: number | null; week: number | null; deniedWeek: number | null }>({ today: null, week: null, deniedWeek: null });

  // ── Live-feed cadence + buffer ──────────────────────────────────────────
  const [cadence, setCadence] = useState<Cadence>('live');
  const cadenceRef = useRef<Cadence>('live');
  cadenceRef.current = cadence;
  // Events received while not 'live'; flushed in order on resume/batch tick.
  const pendingRef = useRef<Array<{ evt: ActivityEvent; updateOnly: boolean }>>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cadence to restore when an auto-pause (row expansion) ends; null = manual.
  const autoPausedFromRef = useRef<Cadence | null>(null);
  // Lazy per-action detail for expanded decision rows.
  const [detailCache, setDetailCache] = useState<Record<string, any>>({});

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

      // Pull a week's worth of ROWS (limit=200) to render from; the narrative
      // totals come from the windowed COUNT(*) the API returns (`days=7`) plus
      // the 24h stats endpoint — never from the capped row buffer.
      const fetches = [
        safeJson(`/api/actions?limit=200&days=7${agentQs}`),
        safeJson(`/api/guard?limit=200&days=7${agentQs}`),
        safeJson(`/api/actions/stats${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`),
        // True weekly denied count: the windowed COUNT(*) `total` from
        // ?decision=block&days=7 (agent-scoped), not the capped row buffer.
        safeJson(`/api/guard?limit=1&decision=block&days=7${agentQs}`),
      ];
      if (!agentId) fetches.push(safeJson('/api/activity?limit=10'));

      const [actionsData, guardData, statsData = {}, deniedData = {}, auditData = {}] = await Promise.all(fetches);
      setApiTotals({
        week: Number.isFinite(Number(actionsData?.total)) ? Number(actionsData.total) : null,
        today: Number.isFinite(Number(statsData?.total)) ? Number(statsData.total) : null,
        deniedWeek: Number.isFinite(Number(deniedData?.total)) ? Number(deniedData.total) : null,
      });

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
      if (cadenceRef.current !== 'live') {
        // Buffered: the visible list stays frozen while paused/batched.
        // Dedupe by id (replace in place) and cap with oldest-drop.
        const pending = pendingRef.current;
        const idx = pending.findIndex((p) => p.evt.id === newEvt!.id);
        if (idx >= 0) pending[idx] = { evt: newEvt!, updateOnly };
        else {
          pending.push({ evt: newEvt!, updateOnly });
          if (pending.length > PENDING_CAP) pending.shift();
        }
        setPendingCount(pending.length);
        return;
      }
      setEvents((prev) => mergeEvent(prev, newEvt!, updateOnly));
      setLastUpdated(new Date().toLocaleTimeString());
    }
  });

  // Flush the pending buffer into the visible list, preserving arrival order.
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    setEvents((prev) => {
      let next = prev;
      for (const { evt, updateOnly } of pending) next = mergeEvent(next, evt, updateOnly);
      return next;
    });
    pendingRef.current = [];
    setPendingCount(0);
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const changeCadence = useCallback((next: Cadence) => {
    autoPausedFromRef.current = null; // an explicit choice overrides auto-pause
    setCadence(next);
    if (next === 'live') flushPending();
  }, [flushPending]);

  // Batched cadence: apply buffered events on a fixed tick.
  useEffect(() => {
    if (cadence !== 'batch') return;
    const interval = setInterval(flushPending, BATCH_FLUSH_MS);
    return () => clearInterval(interval);
  }, [cadence, flushPending]);

  // Row expansion auto-pauses the stream so the row can't move mid-read;
  // collapsing restores the previous cadence (and flushes if returning live).
  const toggleExpanded = useCallback((evt: ActivityEvent) => {
    setExpandedId((prev) => {
      const next = prev === evt.id ? null : evt.id;
      if (next !== null && cadenceRef.current === 'live') {
        autoPausedFromRef.current = 'live';
        setCadence('paused');
      } else if (next === null && autoPausedFromRef.current != null) {
        const restore = autoPausedFromRef.current;
        autoPausedFromRef.current = null;
        setCadence(restore);
        if (restore === 'live') flushPending();
      }
      return next;
    });
    // Decision rows lazily load their full record once.
    if (evt.category === 'decision') {
      const actionId = evt.id.replace(/^act-/, '');
      setDetailCache((cache) => {
        if (cache[actionId]) return cache;
        fetch(`/api/actions/${encodeURIComponent(actionId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.action) setDetailCache((c) => ({ ...c, [actionId]: data.action }));
          })
          .catch(() => { /* detail is best-effort; the row still expands */ });
        return cache;
      });
    }
  }, [flushPending]);

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
    let bufferTotal = 0;
    let requiredApproval = 0;
    let denied = 0;
    const actors = new Set<string>();
    for (const e of scopedEvents) {
      if (e.category === 'decision') {
        bufferTotal += 1;
        if (e.actorId) actors.add(e.actorId);
        // Approved AND still-pending approvals both count — the old
        // approved_by-only check undercounted in-flight approvals.
        if (e.approvedBy || e.status === 'pending_approval') requiredApproval += 1;
      } else if (e.category === 'guard' && (e.status === 'block' || e.status === 'deny')) {
        denied += 1;
      }
    }
    // The true windowed COUNT(*) from the API wins over the capped buffer;
    // max() keeps the number moving as live SSE arrivals land between loads.
    // Denied gets the same treatment for the week scope (?decision=block&days=7);
    // today keeps the buffer count — the week-scoped 200-row buffer covers it.
    const apiTotal = scope === 'today' ? apiTotals.today : apiTotals.week;
    const apiDenied = scope === 'today' ? null : apiTotals.deniedWeek;
    return {
      total: Math.max(apiTotal ?? 0, bufferTotal),
      requiredApproval,
      denied: Math.max(apiDenied ?? 0, denied),
      distinctAgents: actors.size,
    };
  }, [scopedEvents, scope, apiTotals]);

  const denials = useMemo(
    () => scopedEvents.filter((e) => e.category === 'guard' && (e.status === 'block' || e.status === 'deny')),
    [scopedEvents]
  );

  const hasAnyActivity = events.length > 0;

  // D-13: client-side day-grouping. Presentational layer only — wraps the
  // existing per-event render with a one-line English summary per day.
  // Live feed is capped at 50 events within the scope window.
  const groupedByDay = useMemo(() => groupEventsByDay(scopedEvents.slice(0, 50)), [scopedEvents]);

  const narrative = buildNarrative(scope, counts, !!agentId);
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${cadence === 'live' ? 'bg-status-success' : 'bg-status-warning'}`}
              />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary">
                {cadence === 'live' ? 'Live feed' : cadence === 'batch' ? 'Live feed · batched' : 'Live feed · paused'}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {cadence !== 'live' && pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => changeCadence('live')}
                  className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-brand transition-colors hover:bg-brand/20"
                >
                  {pendingCount} new · Back to live
                </button>
              )}
              {/* Update cadence: immediate / 10s batches / frozen. */}
              <div className="flex items-center overflow-hidden rounded-md border border-border" role="group" aria-label="Stream cadence">
                {(['live', 'batch', 'paused'] as Cadence[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => changeCadence(mode)}
                    aria-pressed={cadence === mode}
                    className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      cadence === mode ? 'bg-white/10 text-primary' : 'text-tertiary hover:text-secondary'
                    }`}
                  >
                    {mode === 'live' ? (
                      <span className="flex items-center gap-1"><Play size={10} aria-hidden="true" />Live</span>
                    ) : mode === 'batch' ? (
                      'Every 10s'
                    ) : (
                      <span className="flex items-center gap-1"><Pause size={10} aria-hidden="true" />Pause</span>
                    )}
                  </button>
                ))}
              </div>
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
                        const isExpanded = expandedId === evt.id;
                        const actionId = evt.category === 'decision' ? evt.id.replace(/^act-/, '') : null;
                        const detail = actionId ? detailCache[actionId] : null;
                        return (
                          <div key={evt.id} data-entity-type="auditEvent" data-entity-id={evt.id} className="group relative transition-colors hover:bg-white/[0.02]">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(evt)}
                              aria-expanded={isExpanded}
                              className="flex w-full items-start gap-4 p-4 text-left"
                            >
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
                                <div className={`${isExpanded ? '' : 'line-clamp-2'} text-sm leading-relaxed text-secondary`}>
                                  {evt.detail}
                                </div>
                              </div>

                              {/* Status & expand affordance */}
                              <div className="flex flex-col items-end gap-2 pt-1">
                                <div className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getStatusColor(evt.category, evt.status)}`}>
                                  {evt.status}
                                </div>
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-tertiary transition-colors group-hover:text-secondary">
                                  {isExpanded ? 'Collapse' : 'Expand'}
                                  <ChevronDown size={11} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`} />
                                </span>
                              </div>
                            </button>

                            {/* Inline detail — stream is auto-paused while open. */}
                            {isExpanded && (
                              <div className="border-t border-border bg-white/[0.015] px-4 py-3 pl-[92px] text-xs" data-testid="row-detail">
                                {evt.category === 'guard' ? (
                                  <div className="space-y-2">
                                    {evt.reason && <p className="text-secondary">{evt.reason}</p>}
                                    {Array.isArray(evt.matchedPolicies) && evt.matchedPolicies.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {evt.matchedPolicies.map((p: any, i: number) => (
                                          <span key={i} className="rounded-full border border-border bg-surface-tertiary px-2 py-0.5 font-mono text-[10px] text-secondary">
                                            {typeof p === 'string' ? p : p?.name || p?.id || 'policy'}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {!evt.reason && (!evt.matchedPolicies || evt.matchedPolicies.length === 0) && (
                                      <p className="text-tertiary">No policy detail recorded for this evaluation.</p>
                                    )}
                                  </div>
                                ) : evt.category === 'decision' ? (
                                  <div className="space-y-2">
                                    {detail ? (
                                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                                        <div><span className="text-tertiary">Risk </span><span className="font-mono tabular-nums text-secondary">{detail.risk_score ?? '—'}</span></div>
                                        <div><span className="text-tertiary">Status </span><span className="text-secondary">{detail.status}</span></div>
                                        <div><span className="text-tertiary">Duration </span><span className="font-mono tabular-nums text-secondary">{detail.duration_ms != null ? `${(detail.duration_ms / 1000).toFixed(1)}s` : '—'}</span></div>
                                        <div><span className="text-tertiary">Cost </span><span className="font-mono tabular-nums text-secondary">${Number(detail.cost_estimate || 0).toFixed(4)}</span></div>
                                        {detail.reasoning && <p className="col-span-full text-secondary">{detail.reasoning}</p>}
                                        {detail.output_summary && <p className="col-span-full text-secondary">{detail.output_summary}</p>}
                                      </div>
                                    ) : (
                                      <p className="text-tertiary">Loading record…</p>
                                    )}
                                    <Link
                                      href={evt.link}
                                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover"
                                    >
                                      Open full record
                                      <ChevronRight size={11} aria-hidden="true" />
                                    </Link>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <p className="text-secondary">{evt.detail}</p>
                                    <Link
                                      href={evt.link}
                                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover"
                                    >
                                      Open audit log
                                      <ChevronRight size={11} aria-hidden="true" />
                                    </Link>
                                  </div>
                                )}
                              </div>
                            )}
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
