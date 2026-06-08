'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../../hooks/useRealtime';

export interface MissionData {
  signals: any;
  loops: any;
  health: any;
  actions: any[];
  pendingActions: any[];
  decisionMetrics: any;
  capabilityHealth: any[];
  capabilityHealthError: string | null;
  summary: any;
  feedItems: any[];
  loading: boolean;
  /** Briefly true right after a live SSE event, for the "Live" pulse cue. */
  livePulse: boolean;
}

const EMPTY: MissionData = {
  signals: null,
  loops: null,
  health: null,
  actions: [],
  pendingActions: [],
  decisionMetrics: null,
  capabilityHealth: [],
  capabilityHealthError: null,
  summary: null,
  feedItems: [],
  loading: true,
  livePulse: false,
};

const RELEVANT_EVENTS = [
  'action.created',
  'action.updated',
  'loop.created',
  'loop.updated',
  'guard.decision.created',
  'signal.detected',
];

const SSE_RECONCILE_MS = 750;
const POLL_MS = 30_000;
const FEED_CAP = 200;

async function okJson(res: PromiseSettledResult<Response>): Promise<any | null> {
  if (res.status !== 'fulfilled' || !res.value.ok) return null;
  try {
    return await res.value.json();
  } catch {
    return null;
  }
}

/**
 * The single coordinated source of truth for Mission Control. Replaces the three
 * independent 30s polls (page-level fetchAll + OperationsFeed + RuntimeSummaryCard)
 * with ONE 30s heartbeat firing one Promise.allSettled, plus a single shared SSE
 * subscription whose bursts collapse into one debounced reconcile (no per-event
 * fetch storm). A backgrounded tab costs nothing (visibility-gated).
 */
export function useMissionData(agentId: any): MissionData & { refresh: () => void } {
  const [data, setData] = useState<MissionData>(EMPTY);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    const agentParam = agentId ? `agent_id=${encodeURIComponent(agentId)}` : '';
    const withParams = (base: string, extra: string[] = []) => {
      const params = [...extra];
      if (agentParam) params.push(agentParam);
      return `${base}${params.length ? `?${params.join('&')}` : ''}`;
    };

    // ONE coordinated wave. allSettled (not all) so a slow/failed feed never
    // blocks the fast posture slices — each consumer degrades independently.
    const [signalsR, loopsR, healthR, actionsR, pendingR, metricsR, capR, feedR, summaryR] =
      await Promise.allSettled([
        fetch(withParams('/api/signals')),
        fetch(withParams('/api/actions/loops', ['status=open', 'limit=20'])),
        fetch('/api/health'),
        fetch(withParams('/api/actions', ['limit=12'])),
        fetch(withParams('/api/actions', ['status=pending_approval', 'limit=10'])),
        fetch(withParams('/api/actions/stats')),
        // limit high enough that the Capability Health denominator reflects the true org total
        // (capabilityHealth.length) rather than a truncated page once an org has >20 capabilities.
        fetch('/api/capabilities/health?limit=200'),
        // Feed stays UNSCOPED so global capability/integration health survive even
        // when an agent is selected (the feed drops agent_id:null items when scoped).
        fetch('/api/operations/feed?limit=50'),
        fetch('/api/operations/summary'),
      ]);

    const [signals, loops, health, actionsJson, pendingJson, metrics, cap, feed, summary] =
      await Promise.all([
        okJson(signalsR),
        okJson(loopsR),
        okJson(healthR),
        okJson(actionsR),
        okJson(pendingR),
        okJson(metricsR),
        okJson(capR),
        okJson(feedR),
        okJson(summaryR),
      ]);

    setData((prev) => ({
      ...prev,
      loading: false,
      signals: signals ?? prev.signals,
      loops: loops ?? prev.loops,
      health: health ?? prev.health,
      decisionMetrics: metrics ?? prev.decisionMetrics,
      summary: summary ?? prev.summary,
      actions: actionsJson ? actionsJson.actions || [] : prev.actions,
      pendingActions: pendingJson ? pendingJson.actions || [] : prev.pendingActions,
      capabilityHealth: cap ? cap.capabilities || [] : prev.capabilityHealth,
      capabilityHealthError: cap ? null : 'Capability health unavailable',
      feedItems: feed ? (feed.items || []).slice(0, FEED_CAP) : prev.feedItems,
    }));
  }, [agentId]);

  // ONE 30s heartbeat, visibility-gated. agentId change → one coordinated refetch.
  useEffect(() => {
    setData((prev) => ({ ...prev, loading: true }));
    tick();
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) tick();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tick]);

  // Single shared SSE subscription. A burst of N events → one debounced reconcile
  // (not N fetches). The pulse gives instant perceived freshness while the network
  // coalesces. Reconcile is skipped on a hidden tab.
  useRealtime(
    useCallback(
      (event: any, payload: any) => {
        if (!RELEVANT_EVENTS.includes(event)) return;
        if (agentId) {
          const source = payload?.action || payload?.loop || payload?.decision || payload || {};
          if (source.agent_id && source.agent_id !== agentId) return;
        }
        setData((prev) => (prev.livePulse ? prev : { ...prev, livePulse: true }));
        if (pulseTimer.current) clearTimeout(pulseTimer.current);
        pulseTimer.current = setTimeout(() => setData((prev) => ({ ...prev, livePulse: false })), 1500);

        if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
        reconcileTimer.current = setTimeout(() => {
          reconcileTimer.current = null;
          if (typeof document === 'undefined' || !document.hidden) tick();
        }, SSE_RECONCILE_MS);
      },
      [agentId, tick],
    ),
  );

  useEffect(
    () => () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  return { ...data, refresh: tick };
}
