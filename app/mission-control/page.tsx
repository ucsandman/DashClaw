'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { getAgentColor } from '../lib/colors';
import QuickStart from '../components/QuickStart';
import { isDemoMode } from '../lib/isDemoMode';
import { computePosture } from '../components/SystemStatusBar';
import { useMissionData } from './lib/useMissionData';
import { buildInterventionList, isSignalDismissed } from './lib/missionHelpers';
import { signalDismissKey as getSignalHashShared } from '../lib/signal-hash';
import { CommandStrip } from './components/CommandStrip';
import HaltControl from './components/HaltControl';
import { PostureScorecard } from './components/PostureScorecard';
import { LiveLedger } from './components/LiveLedger';

export default function MissionControlPage() {
  const { agentId, agents } = useAgentFilter() as { agentId: any; agents: any[] };
  const {
    signals, loops, health, actions, pendingActions, decisionMetrics,
    capabilityHealth, summary, feedItems, loading, livePulse, refresh,
  } = useMissionData(agentId);

  const [showQuickStart, setShowQuickStart] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const isDemo = isDemoMode();

  /* ---------- Mutation handlers (reuse the per-item governed routes, then reconcile) ---------- */

  const onDecision = useCallback(
    async (actionId: string, decision: 'allow' | 'deny') => {
      try {
        const res = await fetch(`/api/approvals/${actionId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision }),
        });
        if (res.ok) refresh();
      } catch { /* reconcile on next tick */ }
    },
    [refresh],
  );

  const onRetry = useCallback(
    async (metadata: any) => {
      if (!metadata?.template_id || !metadata?.run_action_id) return;
      try {
        const res = await fetch(`/api/workflows/templates/${metadata.template_id}/runs/${metadata.run_action_id}/resume`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
        });
        if (res.ok) refresh();
      } catch { /* ignore */ }
    },
    [refresh],
  );

  const onCancel = useCallback(
    async (metadata: any) => {
      if (!metadata?.template_id || !metadata?.run_action_id) return;
      try {
        const res = await fetch(`/api/workflows/templates/${metadata.template_id}/runs/${metadata.run_action_id}/cancel`, { method: 'POST' });
        if (res.ok) refresh();
      } catch { /* ignore */ }
    },
    [refresh],
  );

  const onDisable = useCallback(
    async (metadata: any) => {
      if (!metadata?.capability_id) return;
      try {
        const res = await fetch(`/api/capabilities/${metadata.capability_id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ health_status: 'disabled' }),
        });
        if (res.ok) refresh();
      } catch { /* ignore */ }
    },
    [refresh],
  );

  const handlers = useMemo(
    () => ({
      onApprove: (id: string) => onDecision(id, 'allow'),
      onDeny: (id: string) => onDecision(id, 'deny'),
      onRetry, onCancel, onDisable,
    }),
    [onDecision, onRetry, onCancel, onDisable],
  );

  /* ---------- Derived state ---------- */

  // Client-side dismissal filter shared with the Security page.
  const getSignalHash = getSignalHashShared;

  const [dismissedSet, setDismissedSet] = useState<Set<any>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('dashclaw_dismissed_signals');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Dismiss one or many signal instances from the live feed. Shares the
  // localStorage key + per-instance hash with the Security page, so a signal
  // cleared here disappears there (and from posture counts) and vice versa.
  const dismissSignalKeys = useCallback((keys: string[]) => {
    setDismissedSet((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      localStorage.setItem('dashclaw_dismissed_signals', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const activeSignalList = useMemo(() => {
    const list = signals?.signals || [];
    return list.filter((s: any) => !dismissedSet.has(getSignalHash(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, dismissedSet]);

  const signalCounts = {
    red: activeSignalList.filter((s: any) => s.severity === 'red').length,
    amber: activeSignalList.filter((s: any) => s.severity === 'amber').length,
    total: activeSignalList.length,
  };
  const posture = computePosture(signalCounts.red, signalCounts.amber);

  // The live feed must hide the same signal instances dismissed in posture, so the ledger
  // can't show CRITICAL rows while the header reads "All clear". Each feed signal item carries
  // a `dismiss_key` (operations-feed mapSignals) matching the dismissedSet keys.
  const visibleFeedItems = useMemo(
    () => feedItems.filter((i: any) => !isSignalDismissed(i, dismissedSet)),
    [feedItems, dismissedSet],
  );

  const loopList = useMemo(() => loops?.loops || [], [loops]);
  const interventions = useMemo(() => buildInterventionList(pendingActions, loopList), [pendingActions, loopList]);
  const lastActivity = actions[0]?.timestamp_start || loopList[0]?.created_at || null;

  const criticalAgentIds = useMemo(() => {
    const ids = new Set();
    for (const loop of loopList) {
      if (loop.priority === 'critical' && loop.agent_id) ids.add(loop.agent_id);
    }
    return ids;
  }, [loopList]);

  const failedAgentIds = useMemo(() => {
    const ids = new Set();
    const seen = new Set();
    for (const action of actions) {
      if (!action.agent_id || seen.has(action.agent_id)) continue;
      seen.add(action.agent_id);
      if (action.status === 'failed' || action.status === 'blocked') ids.add(action.agent_id);
    }
    return ids;
  }, [actions]);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a: any, b: any) => {
      const aDeg = criticalAgentIds.has(a.agent_id) || failedAgentIds.has(a.agent_id) || a.status === 'degraded' || a.status === 'blocked';
      const bDeg = criticalAgentIds.has(b.agent_id) || failedAgentIds.has(b.agent_id) || b.status === 'degraded' || b.status === 'blocked';
      if (aDeg && !bDeg) return -1;
      if (!aDeg && bDeg) return 1;
      return 0;
    });
  }, [agents, criticalAgentIds, failedAgentIds]);

  const toggleCategory = useCallback((cat: string) => setActiveCategory((prev) => (prev === cat ? null : cat)), []);

  const actionButton = (
    <Link
      href="/decisions"
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
    >
      View Decisions <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );

  return (
    <PageLayout
      title="Mission Control"
      subtitle="Fleet posture, interventions, and a live governance ledger"
      breadcrumbs={['Mission Control']}
      actions={actionButton}
      maturity="stable"
    >
      {!loading && (agents.length === 0 || isDemo) && showQuickStart && (
        <QuickStart onDismiss={() => setShowQuickStart(false)} />
      )}

      <CommandStrip
        posture={posture as any}
        fleetCount={agents.length}
        healthStatus={health?.status || 'unknown'}
        interventionCount={interventions.length}
        lastActivity={lastActivity}
      >
        <HaltControl />
      </CommandStrip>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PostureScorecard
          agentId={agentId}
          decisionMetrics={decisionMetrics}
          pendingActions={pendingActions}
          signalCounts={signalCounts}
          capabilityHealth={capabilityHealth}
          feedItems={visibleFeedItems}
          summary={summary}
          sortedAgents={sortedAgents}
          criticalAgentIds={criticalAgentIds}
          failedAgentIds={failedAgentIds}
          agentColor={getAgentColor}
          activeCategory={activeCategory}
          onToggleCategory={toggleCategory}
        />
        <LiveLedger
          interventions={interventions}
          feedItems={visibleFeedItems}
          agentId={agentId}
          activeCategory={activeCategory}
          onClearFilter={() => setActiveCategory(null)}
          livePulse={livePulse}
          loading={loading}
          onDecision={onDecision}
          refresh={refresh}
          handlers={handlers}
          onDismissSignals={dismissSignalKeys}
        />
      </div>
    </PageLayout>
  );
}
