'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type ElementType } from 'react';
import { useParams } from 'next/navigation';
import {
  Clock, HelpCircle, Search, ShieldCheck, ShieldAlert, Info,
  LayoutPanelLeft, ExternalLink, Package, IdCard, Database,
  CheckCircle2, Ban, AlertTriangle, RefreshCw,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import ContainmentDbEvidence, { type PatchArtifactContent } from '../../components/ContainmentDbEvidence';
import AssumptionGraph from '../../components/AssumptionGraph';
import ExecutionGraph from '../../components/ExecutionGraph';
import ArtifactsTab from '../../components/ArtifactsTab';
import RiskBreakdownPanel from '../../components/RiskBreakdownPanel';
import { buildTimelineEvents, getRiskColor } from './_components/helpers';
import ChronologicalTimeline from './_components/ChronologicalTimeline';
import CausalTimeline from './_components/CausalTimeline';
import PoliciesTab from './_components/PoliciesTab';
import AssumptionsTab from './_components/AssumptionsTab';
import SignalsTab from './_components/SignalsTab';
import EvidenceTab from './_components/EvidenceTab';
import ReplaySidebar from './_components/ReplaySidebar';

// Containment Verdicts lifecycle chip — containment_status is a separate
// column from action.status (an action can be 'completed' and still be
// 'contained'/'awaiting_promotion'/'promoted'/'discarded'). 'awaiting_promotion'
// is the one state that needs an operator, hence the brand-orange cue; every
// other state pairs an icon with the label so status is never color-only.
const CONTAINMENT_CHIP: Record<string, { variant: string; label: string; icon: ElementType }> = {
  contained: { variant: 'info', label: 'Contained', icon: Info },
  awaiting_promotion: { variant: 'brand', label: 'Awaiting promotion', icon: AlertTriangle },
  promoted: { variant: 'success', label: 'Promoted', icon: CheckCircle2 },
  discarded: { variant: 'default', label: 'Discarded', icon: Ban },
};

export default function DecisionReplayPage() {
  const params = useParams();
  const actionId = params.actionId as string;

  const [activeTab, setActiveTab] = useState('timeline');
  const [action, setAction] = useState<any>(null);
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [trace, setTrace] = useState<any>(null);
  const [graph, setGraph] = useState<any>(null);
  const [guardDecision, setGuardDecision] = useState<any>(null);
  const [containmentPatch, setContainmentPatch] = useState<PatchArtifactContent | null>(null);
  const [defense, setDefense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Record<string, any>>({});
  const [invalidateReasons, setInvalidateReasons] = useState<Record<string, string>>({});
  const [reissuing, setReissuing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const fetchData = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const { signal } = controller;
    setError(null);
    setTrace(null);
    setGraph(null);
    setGuardDecision(null);
    setContainmentPatch(null);
    try {
      // Optional graph evidence must never hold the primary decision open.
      void fetch(`/api/actions/${actionId}/graph`, { signal })
        .then(async res => {
          if (res.ok) {
            const graphData = await res.json();
            if (!signal.aborted) setGraph(graphData);
          }
        }).catch(() => { /* graph is optional */ });
      const res = await fetch(`/api/actions/${actionId}`, { signal });
      if (signal.aborted) return;
      if (!res.ok) {
        if (res.status === 404) { setError('Decision not found'); return; }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      if (signal.aborted) return;
      setAction(data.action);
      setAssumptions(data.assumptions || []);
      setDefense(data.agent_defense || null);
      // Exact FK-linked guard decision (action_records.guard_decision_id) —
      // when present it supersedes the legacy time-window correlation below.
      if (data.guard_decision) setGuardDecision(data.guard_decision);
      setLoading(false);

      // trace/artifacts/guard each depend only on fields of `data` above, not
      // on each other — run them together instead of a sequential waterfall.
      // Each keeps its own condition, try/catch isolation, and state set.
      void Promise.allSettled([
        (async () => {
          // Fetch trace data for failed/completed actions
          if (data.action.status === 'failed' || data.action.status === 'completed') {
            try {
              const traceRes = await fetch(`/api/actions/${actionId}/trace`, { signal });
              if (traceRes.ok) {
                const traceData = await traceRes.json();
                if (!signal.aborted) setTrace(traceData.trace);
              }
            } catch { /* trace is optional */ }
          }
        })(),
        (async () => {
          // Containment evidence: the newest 'patch' artifact for a contained
          // action. Only fetched when the row actually carries a containment
          // status — every other decision pays nothing.
          if (data.action.containment_status) {
            try {
              const artifactsRes = await fetch(`/api/actions/${actionId}/artifacts`, { signal });
              if (artifactsRes.ok) {
                const artifactsData = await artifactsRes.json();
                const patch = (artifactsData.artifacts || []).find((a: any) => a && a.artifact_type === 'patch');
                if (!signal.aborted) setContainmentPatch(patch?.content ?? null);
              }
            } catch { /* containment evidence is optional */ }
          }
        })(),
        (async () => {
          // Fetch correlated guard decision (policy governance) — legacy
          // heuristic, only for rows written before guard_decision_id stamping.
          if (data.action.agent_id && !data.guard_decision) {
            try {
              const guardRes = await fetch(`/api/guard?agent_id=${encodeURIComponent(data.action.agent_id)}&limit=10`, { signal });
              if (guardRes.ok) {
                const guardData = await guardRes.json();
                const actionStart = new Date(data.action.timestamp_start).getTime();
                const match = (guardData.decisions || []).find((gd: any) =>
                  gd.action_type === data.action.action_type &&
                  Math.abs(new Date(gd.created_at).getTime() - actionStart) <= 60000
                );
                if (match && !signal.aborted) setGuardDecision(match);
              }
            } catch { /* guard correlation is optional */ }
          }
        })(),
      ]);

    } catch (err) {
      if (signal.aborted) return;
      console.error('Failed to fetch decision:', err);
      setError('Failed to load decision details');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [actionId]);

  useEffect(() => {
    setLoading(true);
    setReissuing(false);
    if (actionId) fetchData();
    return () => loadController.current?.abort();
  }, [actionId, fetchData]);

  // Re-issue merge grant (CRITICAL 1, final fix wave 2026-07-27): the
  // /approvals Containment section only shows rows still awaiting_promotion,
  // so an already-`promoted` action whose 15-minute grant expired or was
  // consumed by a failed merge has no path back through that surface. This
  // hits the same POST /api/actions/[actionId]/containment route with
  // verdict 'promote' — legal now for a 'promoted' action — to re-stamp or
  // re-mint the grant.
  const handleReissue = async () => {
    const controller = loadController.current;
    setReissuing(true);
    try {
      const res = await fetch(`/api/actions/${actionId}/containment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: 'promote' }),
      });
      if (controller?.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Re-issue failed (${res.status})`);
      }
      showToast('Merge grant re-issued — a fresh 15-minute approval window is open.');
      fetchData();
    } catch (err) {
      if (!controller?.signal.aborted) showToast(err instanceof Error ? err.message : 'Re-issue failed');
    } finally {
      if (!controller?.signal.aborted) setReissuing(false);
    }
  };

  const timelineEvents = useMemo(
    () => buildTimelineEvents({ action, guardDecision, assumptions }),
    [action, guardDecision, assumptions]
  );

  // --- Assumption actions ---
  const handleValidateAssumption = async (assumptionId: any) => {
    setPendingOps(prev => ({ ...prev, [assumptionId]: 'validating' }));
    try {
      const res = await fetch(`/api/actions/assumptions/${assumptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validated: true })
      });
      if (res.ok) {
        const data = await res.json();
        setAssumptions(prev => prev.map(a => a.assumption_id === assumptionId ? data.assumption : a));
      } else {
        showToast('Validate assumption failed');
      }
    } catch (err) {
      console.error('Failed to validate assumption:', err);
      showToast('Validate assumption failed');
    }
    setPendingOps(prev => { const n = { ...prev }; delete n[assumptionId]; return n; });
  };

  const handleInvalidateAssumption = async (assumptionId: any) => {
    const reason = invalidateReasons[assumptionId]?.trim();
    if (!reason) return;
    setPendingOps(prev => ({ ...prev, [assumptionId]: 'invalidating' }));
    try {
      const res = await fetch(`/api/actions/assumptions/${assumptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validated: false, invalidated_reason: reason })
      });
      if (res.ok) {
        const data = await res.json();
        setAssumptions(prev => prev.map(a => a.assumption_id === assumptionId ? data.assumption : a));
        setInvalidateReasons(prev => { const n = { ...prev }; delete n[assumptionId]; return n; });
      } else {
        showToast('Invalidate assumption failed');
      }
    } catch (err) {
      console.error('Failed to invalidate assumption:', err);
      showToast('Invalidate assumption failed');
    }
    setPendingOps(prev => { const n = { ...prev }; delete n[assumptionId]; return n; });
  };

  if (loading) {
    return (
      <PageLayout title="Loading..." breadcrumbs={['Governance', 'Decisions']}>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full motion-safe:animate-spin" />
        </div>
      </PageLayout>
    );
  }

  if (error || !action) {
    return (
      <PageLayout title="Decision Not Found" breadcrumbs={['Governance', 'Decisions', actionId]}>
        <Card hover={false} className="max-w-md mx-auto mt-12 text-center">
          <CardContent className="pt-8">
            <Search size={32} className="text-disabled mx-auto mb-3" />
            <div className="text-lg font-medium text-white mb-2">{error || 'Decision not found'}</div>
            <div className="text-sm text-tertiary">Decision ID: {actionId}</div>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const tabs = [
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'graph', label: 'Graph', icon: LayoutPanelLeft },
    { id: 'policies', label: 'Policies', icon: ShieldCheck },
    { id: 'assumptions', label: 'Assumptions', icon: HelpCircle },
    { id: 'signals', label: 'Signals', icon: ShieldAlert },
    { id: 'artifacts', label: 'Artifacts', icon: Package },
    { id: 'evidence', label: 'Evidence', icon: IdCard },
  ];

  return (
    <PageLayout
      title="Decision Replay"
      subtitle={`${action.agent_name || action.agent_id} -- ${
        // Header is orientation only — the full goal renders in the causal
        // timeline below. Goals can now run to 2000 chars (full commands).
        (action.declared_goal || '').length > 140
          ? `${action.declared_goal.slice(0, 140)}…`
          : action.declared_goal
      }`}
      breadcrumbs={['Governance', 'Decisions', action.action_id]}
      maturity="stable"
      actions={
        <div className="flex items-center gap-3">
          {action.containment_status && CONTAINMENT_CHIP[action.containment_status] && (() => {
            const chip = CONTAINMENT_CHIP[action.containment_status];
            if (!chip) return null;
            const ChipIcon = chip.icon;
            return (
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${
                  chip.variant === 'brand' ? 'bg-brand/10 border-brand/20 text-brand' :
                  chip.variant === 'success' ? 'bg-success-subtle border-success/20 text-success' :
                  chip.variant === 'info' ? 'bg-info-subtle border-blue-500/20 text-info' :
                  'bg-white/5 border-white/10 text-tertiary'
                }`}
                title={`Containment status: ${chip.label}`}
              >
                <ChipIcon size={12} /> {chip.label}
              </div>
            );
          })()}
          {action.containment_status === 'promoted' && (
            <button
              onClick={handleReissue}
              disabled={reissuing}
              title="Mint a fresh 15-minute merge-approval window for this promoted action"
              className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded text-xs font-semibold text-secondary hover:bg-white/10 hover:text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} className={reissuing ? 'motion-safe:animate-spin' : ''} />
              {reissuing ? 'Re-issuing…' : 'Re-issue merge grant'}
            </button>
          )}
          {action.verified ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-success-subtle border border-success/20 text-[10px] font-bold text-success uppercase tracking-wider" title="Decision cryptographically signed by agent">
              <ShieldCheck size={12} /> Verified Agent
            </div>
          ) : action.signature ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-error-subtle border border-error/20 text-[10px] font-bold text-error uppercase tracking-wider" title="Cryptographic signature is invalid">
              <ShieldAlert size={12} /> Invalid Signature
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-tertiary uppercase tracking-wider" title="No cryptographic signature provided">
              <Info size={12} /> Unsigned Decision
            </div>
          )}

          {/* Dominant Decision Signal */}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border font-black text-xs tracking-tighter ${
            !guardDecision ? 'bg-white/5 border-white/10 text-secondary' :
            guardDecision?.decision === 'block' ? 'bg-error-subtle border-error/40 text-error' :
            guardDecision?.decision === 'require_approval' ? 'bg-warning-subtle border-warning/40 text-warning' :
            'bg-success-subtle border-success/40 text-success'
          }`}>
            <div className={`w-2 h-2 rounded-full motion-safe:animate-pulse ${
              !guardDecision ? 'bg-current' :
              guardDecision?.decision === 'block' ? 'bg-status-error' :
              guardDecision?.decision === 'require_approval' ? 'bg-status-warning' :
              'bg-status-success'
            }`} />
            {(guardDecision?.decision || 'Decision unavailable').toUpperCase()}
          </div>

          <button
            onClick={() => {
              const url = `${window.location.origin}/replay/${action.action_id}`;
              navigator.clipboard.writeText(url);
              alert('Replay link copied to clipboard!');
            }}
            className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded text-xs font-semibold text-secondary hover:bg-white/10 hover:text-white transition-all"
          >
            <ExternalLink size={14} /> Share
          </button>
        </div>
      }
    >
      {toast && (
        <div className="fixed inset-x-4 bottom-4 z-30 rounded-lg border border-error/30 bg-error-subtle p-3 text-center text-sm text-error" role="alert">
          {toast}
        </div>
      )}

      {/* ═══ Key Metrics ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card hover={false} className={`border ${getRiskColor(action.risk_score)}`}>
          <CardContent className="pt-4 pb-4 text-center">
            {/* NULL = never scored (no client/guard risk) — render an em dash, not a fake 0. */}
            <div className="text-2xl font-semibold tabular-nums">{action.risk_score ?? '—'}</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Risk Score</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">{action.confidence || 50}%</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Confidence</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4 text-center">
            <div className={`text-2xl font-semibold tabular-nums ${action.reversible ? 'text-success' : 'text-error'}`}>
              {action.reversible ? 'Yes' : 'No'}
            </div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Reversible</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">
              {action.duration_ms ? `${(action.duration_ms / 1000).toFixed(1)}s` : '--'}
            </div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Duration</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-semibold tabular-nums text-purple-400">${parseFloat(action.cost_estimate || 0).toFixed(4)}</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Cost</div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ Risk derivation (from the correlated guard decision) ═══ */}
      {guardDecision?.risk_breakdown && (
        <div className="mb-6">
          <RiskBreakdownPanel breakdown={guardDecision.risk_breakdown} />
        </div>
      )}

      {/* ═══ Model + learning-recommendation linkage ═══ */}
      {(action.model || action.recommendation_id) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-white/5 bg-surface-tertiary px-4 py-3 text-xs">
          {action.model && (
            <span className="text-tertiary">Model: <span className="font-mono text-secondary">{action.model}</span></span>
          )}
          {action.recommendation_id && (
            <span className="text-tertiary">
              {action.recommendation_applied ? (
                <>Applied recommendation <span className="font-mono text-success">{action.recommendation_id}</span></>
              ) : (
                <>Overrode recommendation <span className="font-mono text-warning">{action.recommendation_id}</span>
                  {action.recommendation_override_reason ? <>: <span className="text-secondary">{action.recommendation_override_reason}</span></> : null}</>
              )}
            </span>
          )}
        </div>
      )}

      {/* ═══ Tab Navigation ═══ */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/5 pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-brand'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Database containment evidence (RFC 2026-09-04): the same artifact
              the /approvals card renders, shown here on every tab because it is
              the record of WHAT was staged — the Artifacts tab only has its
              raw JSON. File containments keep rendering their diff on
              /approvals (and as an artifact here) — unchanged. */}
          {containmentPatch && containmentPatch.kind === 'db' && (
            <Card hover={false}>
              <CardHeader title="Contained on a database branch" icon={Database} />
              <CardContent>
                <ContainmentDbEvidence content={containmentPatch} />
              </CardContent>
            </Card>
          )}
          {activeTab === 'graph' && (
            <ExecutionGraph graph={graph} />
          )}
          {activeTab === 'timeline' && (
            <>
              <ChronologicalTimeline
                timelineEvents={timelineEvents}
              />

              <CausalTimeline
                action={action}
                guardDecision={guardDecision}
                assumptions={assumptions}
                trace={trace}
              />

              {/* Causality Graph */}
              {trace && (
                <AssumptionGraph
                  trace={trace}
                  currentActionId={actionId}
                  onNodeClick={({ type, actionId: nodeActionId }: any) => {
                    if ((type === 'action' || type === 'related') && nodeActionId && nodeActionId !== actionId) {
                      window.location.href = `/decisions/${nodeActionId}`;
                    }
                  }}
                />
              )}
            </>
          )}

          {activeTab === 'policies' && (
            <PoliciesTab
              actionId={actionId}
              action={action}
              guardDecision={guardDecision}
              trace={trace}
              assumptions={assumptions}
            />
          )}

          {activeTab === 'assumptions' && (
            <AssumptionsTab
              assumptions={assumptions}
              pendingOps={pendingOps}
              invalidateReasons={invalidateReasons}
              setInvalidateReasons={setInvalidateReasons}
              onValidate={handleValidateAssumption}
              onInvalidate={handleInvalidateAssumption}
            />
          )}

          {activeTab === 'signals' && (
            <SignalsTab trace={trace} />
          )}

          {activeTab === 'artifacts' && (
            <ArtifactsTab actionId={actionId} />
          )}

          {activeTab === 'evidence' && (
            <EvidenceTab action={action} />
          )}
        </div>

        {/* ═══ Sidebar Content ═══ */}
        <ReplaySidebar
          action={action}
          defense={defense}
          trace={trace}
        />
      </div>
    </PageLayout>
  );
}
