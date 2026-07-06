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
  /** v8.2 enforcement-liveness tile. state is null until the first fetch lands or on fetch failure —
   *  callers must never treat null as healthy (a failed/absent fetch is not "holding"). */
  enforcementLiveness: { state: 'holding' | 'stale' | 'broken' | null; latest: any };
  enforcementLivenessError: string | null;
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
  enforcementLiveness: { state: null, latest: null },
  enforcementLivenessError: null,
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

/**
 * The single coordinated source of truth for Mission Control. Replaces the three
 * independent 30s polls (page-level fetchAll + OperationsFeed + RuntimeSummaryCard)
 * with ONE 30s heartbeat whose endpoints each paint their own state slice as
 * they land, plus a single shared SSE subscription whose bursts collapse into
 * one debounced reconcile (no per-event fetch storm). A backgrounded tab costs
 * nothing (visibility-gated).
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

    // ONE coordinated wave, but each endpoint paints its own slice the moment
    // it lands — the slow feed call never gates the fast posture/ledger slices.
    // A failed fetch leaves its slice untouched (same degrade-independently
    // semantics as before).
    const slice = (input: string, apply: (json: any) => Partial<MissionData>, onFail?: () => Partial<MissionData>) =>
      fetch(input)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(
          (json) => setData((prev) => ({ ...prev, loading: false, ...apply(json) })),
          () => {
            if (onFail) setData((prev) => ({ ...prev, loading: false, ...onFail() }));
          },
        );

    await Promise.allSettled([
      slice(withParams('/api/signals'), (j) => ({ signals: j })),
      slice(withParams('/api/actions/loops', ['status=open', 'limit=20']), (j) => ({ loops: j })),
      slice('/api/health', (j) => ({ health: j })),
      slice(withParams('/api/actions', ['limit=12']), (j) => ({ actions: j.actions || [] })),
      slice(withParams('/api/actions', ['status=pending_approval', 'limit=10']), (j) => ({ pendingActions: j.actions || [] })),
      slice(withParams('/api/actions/stats'), (j) => ({ decisionMetrics: j })),
      // limit high enough that the Capability Health denominator reflects the true org total
      // (capabilityHealth.length) rather than a truncated page once an org has >20 capabilities.
      slice(
        '/api/capabilities/health?limit=200',
        (j) => ({ capabilityHealth: j.capabilities || [], capabilityHealthError: null }),
        () => ({ capabilityHealthError: 'Capability health unavailable' }),
      ),
      // v8.2: a failed fetch here must degrade independently and never read as
      // "holding" — a silent probe is the exact v4.72.1 failure shape. // version-hardcode-allowed
      slice(
        '/api/enforcement-liveness?limit=1',
        (j) => ({
          enforcementLiveness: { state: j.state ?? null, latest: (j.runs || [])[0] ?? null },
          enforcementLivenessError: null,
        }),
        () => ({ enforcementLivenessError: 'Enforcement liveness unavailable' }),
      ),
      // Feed stays UNSCOPED so global capability/integration health survive even
      // when an agent is selected (the feed drops agent_id:null items when scoped).
      slice('/api/operations/feed?limit=50', (j) => ({ feedItems: (j.items || []).slice(0, FEED_CAP) })),
      slice('/api/operations/summary', (j) => ({ summary: j })),
    ]);
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
