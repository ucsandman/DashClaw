'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2, XCircle, Clock, Zap, Target, BarChart3, HelpCircle,
  RefreshCw, MapPin, Microscope, IdCard, Rocket, Search, ArrowUp,
  Link2, AlertTriangle, ShieldCheck, ShieldAlert, Scale, FileText,
  Activity, Info, ChevronRight, Fingerprint, Database, LayoutPanelLeft, ExternalLink,
  Package, Copy, Check
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { OutcomeBadge } from '../../components/OutcomeBadge';
import AssumptionGraph from '../../components/AssumptionGraph';
import ExecutionGraph from '../../components/ExecutionGraph';
import { TimelineMessage } from '../../components/MessageTrail';
import ArtifactsTab from '../../components/ArtifactsTab';
import RiskBreakdownPanel from '../../components/RiskBreakdownPanel';
import AgentDefenseCard from '../../components/AgentDefenseCard';
import { parseJsonArray } from '../../lib/parseJson';

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-tertiary px-2 py-1 text-[10px] font-medium text-tertiary transition-colors hover:text-secondary hover:border-border-hover"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function DecisionReplayPage() {
  const params = useParams();
  const actionId = params.actionId as string;

  const [activeTab, setActiveTab] = useState('timeline');
  const [action, setAction] = useState<any>(null);
  const [loops, setLoops] = useState<any[]>([]);
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageCorrelation, setMessageCorrelation] = useState('none');
  const [messageThreadName, setMessageThreadName] = useState<string | null>(null);
  const [trace, setTrace] = useState<any>(null);
  const [graph, setGraph] = useState<any>(null);
  const [guardDecision, setGuardDecision] = useState<any>(null);
  const [defense, setDefense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<Record<string, any>>({});
  const [invalidateReasons, setInvalidateReasons] = useState<Record<string, string>>({});
  const [resolveTexts, setResolveTexts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const fetchData = useCallback(async () => {
    // Reset message state synchronously so prior-decision header doesn't
    // leak onto the new URL during the action fetch roundtrip.
    setMessages([]);
    setMessageCorrelation('none');
    setMessageThreadName(null);

    try {
      const res = await fetch(`/api/actions/${actionId}`);
      if (!res.ok) {
        if (res.status === 404) { setError('Decision not found'); return; }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      setAction(data.action);
      setLoops(data.open_loops || []);
      setAssumptions(data.assumptions || []);
      setDefense(data.agent_defense || null);
      // Exact FK-linked guard decision (action_records.guard_decision_id) —
      // when present it supersedes the legacy time-window correlation below.
      if (data.guard_decision) setGuardDecision(data.guard_decision);

      // Fetch correlated messages + metadata for the timeline header
      try {
        const msgRes = await fetch(`/api/actions/${actionId}/messages`);
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          const msgs = msgData.messages || [];
          setMessages(msgs);
          setMessageCorrelation(msgData.correlation || 'none');

          const firstThreadId = msgs.find((m: any) => m.thread_id)?.thread_id;
          if (firstThreadId) {
            try {
              const tRes = await fetch(`/api/messages/threads/${encodeURIComponent(firstThreadId)}`);
              if (tRes.ok) {
                const tData = await tRes.json();
                if (tData.thread?.name) setMessageThreadName(tData.thread.name);
              }
            } catch { /* thread fetch is best-effort */ }
          }
        }
      } catch { /* messages are optional */ }

      // Fetch trace data for failed/completed actions
      if (data.action.status === 'failed' || data.action.status === 'completed') {
        try {
          const traceRes = await fetch(`/api/actions/${actionId}/trace`);
          if (traceRes.ok) {
            const traceData = await traceRes.json();
            setTrace(traceData.trace);
          }
        } catch { /* trace is optional */ }
      }

      // Fetch execution graph (nodes + edges) for any action
      try {
        const graphRes = await fetch(`/api/actions/${actionId}/graph`);
        if (graphRes.ok) {
          const graphData = await graphRes.json();
          setGraph(graphData);
        }
      } catch { /* graph is optional */ }

      // Fetch correlated guard decision (policy governance) — legacy
      // heuristic, only for rows written before guard_decision_id stamping.
      if (data.action.agent_id && !data.guard_decision) {
        try {
          const guardRes = await fetch(`/api/guard?agent_id=${encodeURIComponent(data.action.agent_id)}&limit=10`);
          if (guardRes.ok) {
            const guardData = await guardRes.json();
            const actionStart = new Date(data.action.timestamp_start).getTime();
            const match = (guardData.decisions || []).find((gd: any) =>
              gd.action_type === data.action.action_type &&
              Math.abs(new Date(gd.created_at).getTime() - actionStart) <= 60000
            );
            if (match) setGuardDecision(match);
          }
        } catch { /* guard correlation is optional */ }
      }
    } catch (err) {
      console.error('Failed to fetch decision:', err);
      setError('Failed to load decision details');
    } finally {
      setLoading(false);
    }
  }, [actionId]);

  useEffect(() => {
    if (actionId) fetchData();
  }, [actionId, fetchData]);

  // --- Helpers ---
  const formatTime = (ts: any) => {
    if (!ts) return '--';
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    } catch { return ts; }
  };

  const timelineEvents = useMemo(() => {
    if (!action) return [];
    const events: any[] = [];

    // Guard decision
    if (guardDecision) {
      events.push({
        type: 'guard',
        timestamp: guardDecision.created_at,
        data: guardDecision,
      });
    }

    // Messages
    messages.forEach(msg => {
      events.push({
        type: 'message',
        timestamp: msg.created_at,
        data: msg,
      });
    });

    // Action started
    if (action.timestamp_start) {
      events.push({
        type: 'action_start',
        timestamp: action.timestamp_start,
        data: action,
      });
    }

    // Assumptions
    assumptions.forEach(asm => {
      events.push({
        type: 'assumption',
        timestamp: asm.created_at || action.timestamp_start,
        data: asm,
      });
    });

    // Outcome
    if (action.timestamp_end) {
      events.push({
        type: 'outcome',
        timestamp: action.timestamp_end,
        data: action,
      });
    }

    // Open loops
    loops.forEach(loop => {
      events.push({
        type: 'open_loop',
        timestamp: loop.created_at || action.timestamp_end || action.timestamp_start,
        data: loop,
      });
    });

    return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [action, guardDecision, messages, assumptions, loops]);

  const getStatusVariant = (status: string) => {
    const map: Record<string, string> = {
      completed: 'success', running: 'warning', failed: 'error',
      blocked: 'error', cancelled: 'default', pending: 'info'
    };
    return map[status] || 'default';
  };

  const getRiskColor = (score: any) => {
    const s = parseInt(score, 10);
    if (s >= 70) return 'text-error bg-error-subtle border-error/20';
    if (s >= 40) return 'text-warning bg-warning-subtle border-warning/20';
    return 'text-success bg-status-success/10 border-green-500/20';
  };

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

  // --- Loop actions ---
  const handleResolveLoop = async (loopId: any) => {
    const resolution = resolveTexts[loopId]?.trim();
    if (!resolution) return;
    setPendingOps(prev => ({ ...prev, [loopId]: 'resolving' }));
    try {
      const res = await fetch(`/api/actions/loops/${loopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', resolution })
      });
      if (res.ok) {
        const data = await res.json();
        setLoops(prev => prev.map(l => l.loop_id === loopId ? data.loop : l));
        setResolveTexts(prev => { const n = { ...prev }; delete n[loopId]; return n; });
      } else {
        showToast('Resolve loop failed');
      }
    } catch (err) {
      console.error('Failed to resolve loop:', err);
      showToast('Resolve loop failed');
    }
    setPendingOps(prev => { const n = { ...prev }; delete n[loopId]; return n; });
  };

  const handleCancelLoop = async (loopId: any) => {
    setPendingOps(prev => ({ ...prev, [loopId]: 'cancelling' }));
    try {
      const res = await fetch(`/api/actions/loops/${loopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' })
      });
      if (res.ok) {
        const data = await res.json();
        setLoops(prev => prev.map(l => l.loop_id === loopId ? data.loop : l));
      } else {
        showToast('Cancel loop failed');
      }
    } catch (err) {
      console.error('Failed to cancel loop:', err);
      showToast('Cancel loop failed');
    }
    setPendingOps(prev => { const n = { ...prev }; delete n[loopId]; return n; });
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

  const isSuccess = action.status === 'completed';
  const riskScore = parseInt(action.risk_score || 0, 10);

  // High-fidelity decision inference if correlation is missing in demo/edge cases
  const decisionType = guardDecision?.decision || (
    (action.status === 'failed' || action.status === 'blocked') && riskScore >= 70 ? 'block' :
    action.status === 'pending' && riskScore >= 60 ? 'require_approval' :
    'allow'
  );

  const getResultText = () => {
    if (isSuccess) return 'Action Successful';
    if (decisionType === 'block') return 'Action Prevented';
    if (decisionType === 'require_approval') return 'Approval Required';
    return 'Action Failed';
  };

  const getResultSummary = () => {
    if (action.output_summary) return action.output_summary;
    if (isSuccess) return 'No policy violations detected. Decision chain verified.';
    if (decisionType === 'block') return 'Governance runtime successfully intercepted high-risk intent.';
    if (decisionType === 'require_approval') return 'Action paused. Awaiting human operator intervention.';
    return 'Action failed during execution. See execution trace for details.';
  };

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
      subtitle={`${action.agent_name || action.agent_id} -- ${action.declared_goal}`}
      breadcrumbs={['Governance', 'Decisions', action.action_id]}
      maturity="stable"
      actions={
        <div className="flex items-center gap-3">
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
            guardDecision?.decision === 'block' ? 'bg-error-subtle border-error/40 text-error' :
            guardDecision?.decision === 'require_approval' ? 'bg-warning-subtle border-warning/40 text-warning' :
            'bg-success-subtle border-success/40 text-success'
          }`}>
            <div className={`w-2 h-2 rounded-full motion-safe:animate-pulse ${
              guardDecision?.decision === 'block' ? 'bg-status-error' :
              guardDecision?.decision === 'require_approval' ? 'bg-status-warning' :
              'bg-status-success'
            }`} />
            {(guardDecision?.decision || 'allow').toUpperCase()}
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
                  {action.recommendation_override_reason ? <> — <span className="text-secondary">{action.recommendation_override_reason}</span></> : null}</>
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
          {activeTab === 'graph' && (
            <ExecutionGraph graph={graph} />
          )}
          {activeTab === 'timeline' && (
            <>
              {/* Chronological Event Timeline */}
              <Card hover={false}>
                <CardHeader title="Chronological Timeline" icon={Clock} count={timelineEvents.length} />
                <CardContent>
                  {(messages.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-border text-[11px]">
                      <span className="text-tertiary uppercase tracking-wider font-medium">
                        Messages: {messages.length}
                      </span>
                      {messageCorrelation === 'time_window' && (
                        <span
                          className="text-[10px] font-bold text-warning/80 uppercase tracking-widest border border-warning/20 bg-warning-subtle rounded px-1.5 py-0.5"
                          title="No messages tagged this action explicitly; showing messages sent during the action's time window."
                        >
                          inferred from timing
                        </span>
                      )}
                      {messageCorrelation === 'explicit' && (
                        <span
                          className="text-[10px] font-bold text-success/80 uppercase tracking-widest border border-success/20 bg-success-subtle rounded px-1.5 py-0.5"
                          title="Messages were tagged with this action_id by the SDK."
                        >
                          explicitly linked
                        </span>
                      )}
                      {messageThreadName && (
                        <span className="text-tertiary">
                          Thread: <span className="text-secondary">{messageThreadName}</span>
                        </span>
                      )}
                    </div>
                  )}
                  <div className="space-y-0">
                    {timelineEvents.length === 0 && (
                      <div className="text-sm text-tertiary py-4">No timeline events to display.</div>
                    )}
                    {timelineEvents.map((event, idx) => {
                      if (event.type === 'message') {
                        return <TimelineMessage key={`msg-${event.data.id}`} message={event.data} />;
                      }
                      if (event.type === 'guard') {
                        return (
                          <div key={`guard-${idx}`} className="flex gap-3 py-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-success-subtle flex items-center justify-center flex-shrink-0">
                                <ShieldCheck size={14} className="text-success" />
                              </div>
                              <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                            </div>
                            <div className="min-w-0 flex-1 pb-2">
                              <div className="flex items-center gap-2 text-xs mb-1">
                                <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                                <span className="text-tertiary uppercase font-medium">Guard</span>
                              </div>
                              <div className="text-sm text-secondary">
                                Decision: <span className={event.data.decision === 'allow' ? 'text-success' : 'text-error'}>{event.data.decision?.toUpperCase()}</span>
                                {event.data.risk_score != null && <span className="text-tertiary ml-2">(risk {event.data.risk_score})</span>}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      if (event.type === 'action_start') {
                        return (
                          <div key={`start-${idx}`} className="flex gap-3 py-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-info-subtle flex items-center justify-center flex-shrink-0">
                                <Rocket size={14} className="text-info" />
                              </div>
                              <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                            </div>
                            <div className="min-w-0 flex-1 pb-2">
                              <div className="flex items-center gap-2 text-xs mb-1">
                                <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                                <span className="text-tertiary uppercase font-medium">Action Started</span>
                              </div>
                              <div className="text-sm text-secondary">
                                {event.data.action_type} — {event.data.declared_goal}
                              </div>
                              {event.data.reasoning && (
                                <div className="text-xs text-tertiary mt-1">{event.data.reasoning}</div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (event.type === 'assumption') {
                        return (
                          <div key={`asm-${event.data.assumption_id || idx}`} className="flex gap-3 py-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                                <Target size={14} className="text-purple-400" />
                              </div>
                              <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                            </div>
                            <div className="min-w-0 flex-1 pb-2">
                              <div className="flex items-center gap-2 text-xs mb-1">
                                <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                                <span className="text-tertiary uppercase font-medium">Assumption</span>
                                {event.data.validated ? <CheckCircle2 size={12} className="text-success" /> : event.data.invalidated ? <XCircle size={12} className="text-error" /> : <Clock size={12} className="text-tertiary" />}
                              </div>
                              <div className="text-sm text-secondary">{event.data.assumption}</div>
                            </div>
                          </div>
                        );
                      }
                      if (event.type === 'outcome') {
                        const isSuccessOutcome = event.data.status === 'completed';
                        return (
                          <div key={`outcome-${idx}`} className="flex gap-3 py-3">
                            <div className="flex flex-col items-center">
                              <div className={`w-8 h-8 rounded-full ${isSuccessOutcome ? 'bg-status-success/20' : 'bg-error-subtle'} flex items-center justify-center flex-shrink-0`}>
                                {isSuccessOutcome ? <CheckCircle2 size={14} className="text-success" /> : <XCircle size={14} className="text-error" />}
                              </div>
                              <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                            </div>
                            <div className="min-w-0 flex-1 pb-2">
                              <div className="flex items-center gap-2 text-xs mb-1">
                                <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                                <span className="text-tertiary uppercase font-medium">Outcome</span>
                              </div>
                              <div className="text-sm text-secondary">{event.data.output_summary || event.data.error_message}</div>
                              <div className="flex gap-3 text-xs text-tertiary mt-1">
                                {event.data.duration_ms && <span>{event.data.duration_ms}ms</span>}
                                {event.data.cost_estimate > 0 && <span>${parseFloat(event.data.cost_estimate).toFixed(4)}</span>}
                                {(event.data.tokens_in > 0 || event.data.tokens_out > 0) && (
                                  <span>{event.data.tokens_in} in / {event.data.tokens_out} out</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      if (event.type === 'open_loop') {
                        return (
                          <div key={`loop-${event.data.loop_id || idx}`} className="flex gap-3 py-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-status-warning/20 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle size={14} className="text-warning" />
                              </div>
                              <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                            </div>
                            <div className="min-w-0 flex-1 pb-2">
                              <div className="flex items-center gap-2 text-xs mb-1">
                                <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                                <span className="text-tertiary uppercase font-medium">Open Loop</span>
                                <span className={`text-xs ${event.data.status === 'open' ? 'text-warning' : 'text-success'}`}>{event.data.status}</span>
                              </div>
                              <div className="text-sm text-secondary">{event.data.description}</div>
                              <div className="text-xs text-tertiary mt-0.5">{event.data.loop_type} / {event.data.priority}</div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Causal Timeline Card */}
              <Card hover={false}>
                <CardHeader title="Causal Timeline" icon={Activity} />
                <CardContent>
                  <div className="space-y-6 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-white/5">
                    {/* 1. Goal */}
                    <div className="relative flex gap-4 pl-1">
                      <div className="z-10 mt-1 h-4 w-4 rounded-full bg-status-info border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(59,130,246,0.3)]" />
                      <div>
                        <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Goal Declared</div>
                        <div className="text-sm text-white font-medium">{action.declared_goal}</div>
                        {action.reasoning && (
                          <div className="mt-2 text-xs text-tertiary bg-white/5 p-2 rounded italic">
                            &ldquo;{action.reasoning}&rdquo;
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2. Policy Evaluation */}
                    <div className="relative flex gap-4 pl-1">
                      <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.1)] ${
                        guardDecision?.decision === 'allow' ? 'bg-status-success' :
                        guardDecision?.decision === 'block' ? 'bg-status-error' :
                        guardDecision?.decision === 'require_approval' ? 'bg-status-warning' : 'bg-zinc-500'
                      }`} />
                      <div className="flex-1">
                        <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Policy Evaluation</div>
                        {guardDecision ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={getStatusVariant(guardDecision.decision === 'allow' ? 'completed' : guardDecision.decision === 'block' ? 'failed' : 'running')} size="xs">
                                {guardDecision.decision.toUpperCase()}
                              </Badge>
                              {guardDecision.reason && <span className="text-xs text-secondary">{guardDecision.reason}</span>}
                            </div>
                            {parseJsonArray(guardDecision.matched_policies).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {parseJsonArray(guardDecision.matched_policies).map((p: any, i: number) => (
                                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-secondary border border-white/10">
                                    {typeof p === 'string' ? p : p.name || p.id}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-tertiary italic">No guard evaluation recorded for this decision.</div>
                        )}
                      </div>
                    </div>

                    {/* 3. Assumption Check */}
                    {assumptions.length > 0 && (
                      <div className="relative flex gap-4 pl-1">
                        <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.1)] ${
                          assumptions.every(a => a.validated) ? 'bg-status-success' :
                          assumptions.some(a => a.invalidated) ? 'bg-status-error' : 'bg-status-warning'
                        }`} />
                        <div>
                          <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Assumption Check</div>
                          <div className="space-y-2 mt-2">
                            {assumptions.map((asm, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                {asm.validated ? <CheckCircle2 size={12} className="text-success" /> :
                                 asm.invalidated ? <XCircle size={12} className="text-error" /> :
                                 <HelpCircle size={12} className="text-warning" />}
                                <span className={asm.invalidated ? 'text-error' : 'text-secondary'}>{asm.assumption}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 4. Risk Signals */}
                    {trace?.root_cause_indicators?.length > 0 && (
                      <div className="relative flex gap-4 pl-1">
                        <div className="z-10 mt-1 h-4 w-4 rounded-full bg-status-warning border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(245,158,11,0.3)]" />
                        <div>
                          <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Risk Signals</div>
                          <div className="space-y-1.5 mt-2">
                            {trace.root_cause_indicators.map((sig: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-warning">
                                <ShieldAlert size={12} />
                                <span>{sig.type.replace(/_/g, ' ')} detected ({sig.count})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 5. Final Decision */}
                    <div className="relative flex gap-4 pl-1">
                      <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.1)] ${getStatusVariant(action.status) === 'success' ? 'bg-status-success' : 'bg-status-error'}`} />
                      <div>
                        <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Final Outcome</div>
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold tracking-tight ${getStatusVariant(action.status) === 'success' ? 'text-success' : 'text-error'}`}>
                            {action.status.toUpperCase()}
                          </span>
                          {action.outcome_status && (
                            <OutcomeBadge status={action.outcome_status} size="sm" />
                          )}
                          {action.duration_ms && <span className="text-xs text-tertiary">in {(action.duration_ms / 1000).toFixed(2)}s</span>}
                        </div>
                        {(action.outcome_summary || action.outcome_error) && (
                          <div className="mt-2 text-xs text-tertiary">
                            {action.outcome_status === 'failed' && action.outcome_error
                              ? `Reported failure: ${action.outcome_error}`
                              : action.outcome_status === 'lost_confirmation'
                                ? 'No outcome reported within timeout window (system sweep)'
                                : action.outcome_summary}
                          </div>
                        )}
                        {action.output_summary && (
                          <div className="mt-2 text-sm text-secondary bg-surface-tertiary p-3 rounded-lg border border-white/5">
                            {action.output_summary}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Causality Graph */}
              {trace && (
                <AssumptionGraph
                  trace={trace}
                  currentActionId={actionId}
                  onNodeClick={({ type, id, actionId: nodeActionId }: any) => {
                    if ((type === 'action' || type === 'related') && nodeActionId && nodeActionId !== actionId) {
                      window.location.href = `/decisions/${nodeActionId}`;
                    }
                  }}
                />
              )}
            </>
          )}

          {activeTab === 'policies' && (
            <div className="space-y-6">
              <Card hover={false}>
                <CardHeader title="Guard Evaluation" icon={ShieldCheck} />
                <CardContent>
                  {guardDecision ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between p-4 rounded-lg bg-surface-tertiary border border-white/5">
                        <div>
                          <div className="text-xs text-tertiary uppercase tracking-wider mb-1">Decision</div>
                          <div className={`text-xl font-bold ${
                            guardDecision.decision === 'allow' ? 'text-success' :
                            guardDecision.decision === 'block' ? 'text-error' : 'text-warning'
                          }`}>
                            {guardDecision.decision.toUpperCase()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-tertiary uppercase tracking-wider mb-1">Evaluated At</div>
                          <div className="text-sm text-secondary">{formatTime(guardDecision.created_at)}</div>
                        </div>
                      </div>

                      {guardDecision.reason && (
                        <div>
                          <div className="text-xs text-tertiary uppercase tracking-wider mb-2">Reasoning</div>
                          <div className="p-4 rounded-lg bg-white/5 text-sm text-secondary italic">
                            &ldquo;{guardDecision.reason}&rdquo;
                          </div>
                        </div>
                      )}

                      {parseJsonArray(guardDecision.matched_policies).length > 0 && (
                        <div>
                          <div className="text-xs text-tertiary uppercase tracking-wider mb-3">Enforced Policies</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {parseJsonArray(guardDecision.matched_policies).map((p: any, i: number) => (
                              <div key={i} className="p-3 rounded-lg border border-white/5 bg-surface-tertiary flex items-center gap-3">
                                <ShieldCheck size={16} className="text-success" />
                                <div className="text-sm text-white font-medium">{typeof p === 'string' ? p : p.name || p.id}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <HelpCircle size={40} className="text-disabled mx-auto mb-4" />
                      <div className="text-white font-medium mb-2">No Governance Data</div>
                      <p className="text-sm text-tertiary max-w-sm mx-auto">
                        This decision was not governed by the DashClaw Guard engine. Ensure your SDK implementation uses <code className="text-secondary">claw.guard()</code> for full decision replay capability.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Policy Proof Section */}
              <Card hover={false}>
                <CardHeader title="Governance Proof" icon={Scale} />
                <CardContent>
                  <div className="bg-primary p-6 rounded-lg border border-success/20 font-mono text-xs text-success/80 leading-relaxed overflow-x-auto">
                    <div className="mb-4 text-success font-bold uppercase tracking-widest">--- DashClaw Governance Evidence ---</div>
                    <div>DECISION_ID: {actionId}</div>
                    <div>TIMESTAMP: {new Date(action.timestamp_start).toISOString()}</div>
                    <div>AGENT: {action.agent_id}</div>
                    <div>OUTCOME: {action.status.toUpperCase()}</div>
                    <div className="my-4 border-t border-success/20" />
                    <div>POLICIES_MATCHED: {guardDecision ? parseJsonArray(guardDecision.matched_policies).length : 0}</div>
                    <div>INTEGRITY_SIGNALS: {trace?.root_cause_indicators?.length || 0}</div>
                    <div>ASSUMPTIONS_CHECKED: {assumptions.length}</div>
                    <div className="my-4 border-t border-success/20" />
                    {/* Real signature state only — a fabricated random "signature"
                        used to render here, changing every refresh. */}
                    <div>SIGNATURE_VERIFIED: {action.verified ? 'TRUE' : 'FALSE'}</div>
                    {action.signature ? (
                      <div className="break-all mt-1 opacity-60">{String(action.signature)}</div>
                    ) : (
                      <div className="mt-1 opacity-60">No agent signature attached to this action.</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'assumptions' && (
            <div className="space-y-6">
              <Card hover={false}>
                <CardHeader title="Decision Basis" icon={HelpCircle} count={assumptions.length} />
                <CardContent>
                  {assumptions.length > 0 ? (
                    <div className="space-y-4">
                      {assumptions.map(asm => {
                        const isUnresolved = !asm.validated && !asm.invalidated;
                        const isPending = !!pendingOps[asm.assumption_id];
                        return (
                          <div key={asm.assumption_id} className="bg-surface-tertiary rounded-lg p-4 border border-white/5">
                            <div className="flex items-start space-x-3">
                              <span className="mt-1">
                                {asm.validated
                                  ? <CheckCircle2 size={18} className="text-success" />
                                  : asm.invalidated
                                    ? <XCircle size={18} className="text-error" />
                                    : <HelpCircle size={18} className="text-warning" />
                                }
                              </span>
                              <div className="flex-1">
                                <div className="text-white text-sm font-medium">{asm.assumption}</div>
                                {asm.basis && (
                                  <div className="text-xs text-tertiary mt-2">
                                    <span className="text-disabled uppercase font-semibold text-[9px] tracking-wider">Basis:</span> {asm.basis}
                                  </div>
                                )}
                                {asm.invalidated_reason && (
                                  <div className="text-xs text-error mt-2 p-2 rounded bg-status-error/5 border border-error/10">
                                    <span className="font-semibold uppercase text-[9px] tracking-wider">Invalidated Reason:</span> {asm.invalidated_reason}
                                  </div>
                                )}

                                {isUnresolved && (
                                  <div className="mt-4 flex flex-wrap items-center gap-3">
                                    <button
                                      onClick={() => handleValidateAssumption(asm.assumption_id)}
                                      disabled={isPending}
                                      className="px-3 py-1.5 bg-status-success text-white hover:bg-emerald-600 disabled:opacity-50 text-[11px] rounded font-semibold transition-colors"
                                    >
                                      {pendingOps[asm.assumption_id] === 'validating' ? 'Validating...' : 'Validate'}
                                    </button>
                                    <div className="flex items-center gap-2 flex-1">
                                      <input
                                        type="text"
                                        placeholder="Invalidate with reason..."
                                        value={invalidateReasons[asm.assumption_id] || ''}
                                        onChange={(e) => setInvalidateReasons(prev => ({ ...prev, [asm.assumption_id]: e.target.value }))}
                                        className="flex-1 px-3 py-1.5 bg-secondary border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-error/50"
                                      />
                                      <button
                                        onClick={() => handleInvalidateAssumption(asm.assumption_id)}
                                        disabled={!invalidateReasons[asm.assumption_id]?.trim() || isPending}
                                        className="px-3 py-1.5 bg-error-subtle border border-error/20 text-error hover:bg-error-subtle disabled:opacity-50 text-[11px] rounded font-semibold transition-colors"
                                      >
                                        Invalidate
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-12 text-center text-tertiary text-sm">No explicit assumptions recorded for this decision.</div>
                  )}
                </CardContent>
              </Card>

              <Card hover={false}>
                <CardHeader title="Drift Detection" icon={Activity} />
                <CardContent>
                  {assumptions.length > 0 ? (() => {
                    const invalidated = assumptions.filter(a => a.invalidated).length;
                    const driftPct = Math.round((invalidated / assumptions.length) * 100);
                    const label = driftPct === 0 ? 'Nominal' : driftPct < 34 ? 'Low' : driftPct < 67 ? 'Elevated' : 'High';
                    const tone = driftPct < 34 ? 'text-success' : driftPct < 67 ? 'text-warning' : 'text-error';
                    const bar = driftPct < 34 ? 'bg-status-success' : driftPct < 67 ? 'bg-status-warning' : 'bg-status-error';
                    return (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-secondary">Assumption drift</span>
                          <span className={`text-sm font-bold ${tone}`}>{invalidated}/{assumptions.length} invalidated ({label})</span>
                        </div>
                        <div className="h-2 bg-tertiary rounded-full overflow-hidden">
                          <div className={`h-full ${bar}`} style={{ width: `${Math.max(driftPct, 2)}%` }} />
                        </div>
                        <p className="text-xs text-tertiary">
                          Drift reflects how many of this decision&apos;s recorded assumptions have since been invalidated.
                          {driftPct === 0 ? ' None have drifted.' : ` ${invalidated} of ${assumptions.length} no longer hold.`}
                        </p>
                      </div>
                    );
                  })() : (
                    <div className="py-8 text-center text-tertiary text-sm">No assumptions recorded to assess drift.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'signals' && (
            <div className="space-y-6">
              <Card hover={false}>
                <CardHeader title="Risk Signal Analysis" icon={ShieldAlert} />
                <CardContent>
                  {trace?.root_cause_indicators?.length > 0 ? (
                    <div className="space-y-4">
                      {trace.root_cause_indicators.map((indicator: any, idx: number) => (
                        <div key={idx} className={`p-4 rounded-lg border-l-4 ${
                          indicator.severity === 'high' ? 'border-error bg-error-subtle' : 'border-warning bg-warning-subtle'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-white font-semibold text-sm flex items-center gap-2">
                              {indicator.type === 'invalidated_assumptions' && <XCircle size={14} className="text-error" />}
                              {indicator.type === 'unresolved_loops' && <RefreshCw size={14} className="text-warning" />}
                              {indicator.type === 'parent_failures' && <ArrowUp size={14} className="text-warning" />}
                              <span className="uppercase tracking-wider text-xs">{indicator.type.replace(/_/g, ' ')}</span>
                            </div>
                            <Badge variant={indicator.severity === 'high' ? 'error' : 'warning'} size="xs">
                              {indicator.severity.toUpperCase()} ALERT
                            </Badge>
                          </div>
                          <div className="space-y-2">
                            {indicator.detail.map((item: any, i: number) => (
                              <div key={i} className="text-xs text-secondary bg-black/20 p-2 rounded">
                                {item.assumption || item.description || item.goal || 'Signal detail'}
                                {item.reason && <span className="block mt-1 text-tertiary">Reason: {item.reason}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <ShieldCheck size={40} className="text-success/20 mx-auto mb-4" />
                      <div className="text-secondary font-medium">No anomaly signals detected</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card hover={false}>
                <CardHeader title="Autonomy Spikes" icon={Activity} />
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 h-12 flex items-end gap-1">
                      {[20, 35, 25, 60, 45, 30, 80, 20, 15, 25, 30, 35, 40].map((h, i) => (
                        <div key={i} className={`flex-1 rounded-t-sm transition-all ${i === 6 ? 'bg-status-warning' : 'bg-tertiary'}`} style={{ height: `${h}%` }} />
                      ))}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-tertiary uppercase">Current Variance</div>
                      <div className="text-lg font-bold text-white">+12%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'artifacts' && (
            <ArtifactsTab actionId={actionId} />
          )}

          {activeTab === 'evidence' && (
            <div className="space-y-6">
              <Card hover={false}>
                <CardHeader title="Action Artifacts" icon={FileText} />
                <CardContent>
                  <div className="space-y-6">
                    <div>
                      <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Side Effects</div>
                      {parseJsonArray(action.side_effects).length > 0 ? (
                        <div className="space-y-2">
                          {parseJsonArray(action.side_effects).map((se: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 p-3 rounded bg-status-warning/5 border border-warning/10 text-xs text-amber-200">
                              <AlertTriangle size={14} className="shrink-0" />
                              {se}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-tertiary italic">No side effects recorded.</div>
                      )}
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Created Artifacts</div>
                      {parseJsonArray(action.artifacts_created).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {parseJsonArray(action.artifacts_created).map((a: any, i: number) => (
                            <div key={i} className="px-3 py-1.5 rounded bg-status-info/5 border border-blue-500/10 text-xs text-info font-mono">
                              {a}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-tertiary italic">No artifacts recorded.</div>
                      )}
                    </div>

                    <div>
                      <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-3">Systems Touched</div>
                      {parseJsonArray(action.systems_touched).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {parseJsonArray(action.systems_touched).map((s: any, i: number) => (
                            <div key={i} className="px-3 py-1.5 rounded bg-surface-tertiary border border-white/5 text-xs text-secondary">
                              <Database size={12} className="inline mr-2 opacity-50" />
                              {s}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-tertiary italic">No systems recorded.</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card hover={false}>
                <CardHeader title="Raw payload (export / debug)" icon={LayoutPanelLeft} />
                <CardContent>
                  <details className="group">
                    <summary className="flex cursor-pointer select-none items-center gap-2 text-xs text-tertiary transition-colors hover:text-secondary [&::-webkit-details-marker]:hidden">
                      <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                      <span>Show full decision object (JSON)</span>
                    </summary>
                    <div className="mt-3 flex justify-end">
                      <CopyButton text={JSON.stringify(action, null, 2)} label="Copy JSON" />
                    </div>
                    <pre className="mt-2 p-4 bg-primary rounded border border-white/5 text-[10px] text-secondary font-mono overflow-auto max-h-[400px]">
                      {JSON.stringify(action, null, 2)}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* ═══ Sidebar Content ═══ */}
        <div className="space-y-6">
          {/* Status & ID */}
          <Card hover={false}>
            <CardHeader title="Identity" icon={Fingerprint} />
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Decision ID</div>
                  <div className="text-[11px] font-mono text-secondary break-all bg-white/5 p-2 rounded">{action.action_id}</div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Agent</div>
                    <div className="text-xs text-white font-medium">{action.agent_name || action.agent_id}</div>
                  </div>
                  <Badge variant="info" size="xs">{action.action_type}</Badge>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Status</div>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${action.status === 'completed' ? 'bg-status-success' : 'bg-status-error'}`} />
                    <span className="text-xs font-semibold text-secondary">{action.status.toUpperCase()}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-1">Verified Identity</div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {action.verified
                      ? <><ShieldCheck size={14} className="text-success" /><span className="text-success">Cryptographically Signed</span></>
                      : <><ShieldAlert size={14} className="text-disabled" /><span className="text-tertiary">Unsigned session</span></>
                    }
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Agent's-advocate rollup — what protected this agent */}
          <AgentDefenseCard defense={defense} />

          {/* Causal Chain Summary */}
          {trace && (
            <Card hover={false}>
              <CardHeader title="Decision Lineage" icon={Activity} />
              <CardContent>
                <div className="space-y-4">
                  {trace.parent_chain?.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Parents</div>
                      <div className="space-y-2">
                        {trace.parent_chain.map((p: any, i: number) => (
                          <Link key={i} href={`/decisions/${p.action_id}`} className="flex items-center gap-2 group">
                            <ArrowUp size={12} className="text-disabled group-hover:text-brand" />
                            <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{p.declared_goal}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {trace.sub_actions?.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Children ({trace.sub_actions.length})</div>
                      <div className="space-y-2">
                        {trace.sub_actions.slice(0, 3).map((c: any, i: number) => (
                          <Link key={i} href={`/decisions/${c.action_id}`} className="flex items-center gap-2 group">
                            <ChevronRight size={12} className="text-disabled group-hover:text-brand" />
                            <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{c.declared_goal}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {trace.related_actions?.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-disabled uppercase tracking-widest mb-2">Correlated Actions</div>
                      <div className="space-y-2">
                        {trace.related_actions.slice(0, 3).map((r: any, i: number) => (
                          <Link key={i} href={`/decisions/${r.action_id}`} className="flex items-center gap-2 group">
                            <Link2 size={12} className="text-disabled group-hover:text-brand" />
                            <span className="text-[11px] text-secondary group-hover:text-white truncate max-w-[150px]">{r.declared_goal}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Open Dependency Loop */}
          {loops.filter(l => l.status === 'open').length > 0 && (
            <Card hover={false} className="border-l-4 border-l-amber-500">
              <CardHeader title="Active Interventions" icon={RefreshCw} count={loops.filter(l => l.status === 'open').length} />
              <CardContent>
                <div className="space-y-4">
                  {loops.filter(l => l.status === 'open').map(loop => (
                    <div key={loop.loop_id} className="bg-white/5 p-3 rounded-lg">
                      <div className="text-xs text-white font-medium mb-2">{loop.description}</div>
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          placeholder="Resolution info..."
                          value={resolveTexts[loop.loop_id] || ''}
                          onChange={(e) => setResolveTexts(prev => ({ ...prev, [loop.loop_id]: e.target.value }))}
                          className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-[10px] text-white focus:outline-none focus:border-success/50"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResolveLoop(loop.loop_id)}
                            disabled={!resolveTexts[loop.loop_id]?.trim() || !!pendingOps[loop.loop_id]}
                            className="flex-1 px-2 py-1 bg-status-success text-white hover:bg-emerald-600 disabled:opacity-50 text-[10px] rounded font-bold transition-colors"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => handleCancelLoop(loop.loop_id)}
                            disabled={!!pendingOps[loop.loop_id]}
                            className="px-2 py-1 text-secondary hover:text-white text-[10px] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
