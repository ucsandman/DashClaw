'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BookOpen, Zap, Lightbulb, Sparkles, FileText, RotateCw, CheckCircle2, XCircle, AlertTriangle, Clock, Power, TrendingUp, Code2, Search } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { applyDecisionToStats } from '../lib/learning-stats';

export default function LearningDashboard() {
  const { agentId } = useAgentFilter();
  const [decisions, setDecisions] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [driftWarnings, setDriftWarnings] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recommendationMetrics, setRecommendationMetrics] = useState<any>({ metrics: [], summary: {} });
  const [recommendationError, setRecommendationError] = useState('');
  const [updatingRecommendationId, setUpdatingRecommendationId] = useState('');
  const [stats, setStats] = useState({ totalDecisions: 0, totalLessons: 0, successRate: 0, totalWithOutcome: 0 });
  const [lastUpdated, setLastUpdated] = useState('');
  const [decisionSearch, setDecisionSearch] = useState('');
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ decision: '', context: '', outcome: 'pending' });
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<number | null>(null);
  const [suggestionError, setSuggestionError] = useState('');
  const [codeSignals, setCodeSignals] = useState<any>({ findings: [], period: '30d' });
  const [codeSignalsError, setCodeSignalsError] = useState(false);
  const [signalsPeriod, setSignalsPeriod] = useState('30d');
  const [exporting, setExporting] = useState<string | null>(null);

  useRealtime((event: any, payload: any) => {
    if (event === 'decision.created') {
      if (agentId && payload.agent_id !== agentId) return;
      setDecisions(prev => [payload, ...prev].slice(0, 20));
      // Pending-safe: the server's rate counts only terminal outcomes.
      setStats(prev => applyDecisionToStats(prev, payload.outcome));
    }
  });

  const fetchData = useCallback(async () => {
    try {
      const learningParams = new URLSearchParams();
      const recommendationParams = new URLSearchParams({ limit: '50', include_inactive: 'true' });
      const metricsParams = new URLSearchParams({ limit: '50', include_inactive: 'true' });
      if (agentId) {
        learningParams.set('agent_id', agentId);
        recommendationParams.set('agent_id', agentId);
        metricsParams.set('agent_id', agentId);
      }
      if (decisionSearch.trim()) learningParams.set('q', decisionSearch.trim());

      const learningPath = `/api/learning${learningParams.toString() ? `?${learningParams.toString()}` : ''}`;
      const recommendationPath = `/api/learning/recommendations?${recommendationParams.toString()}`;
      const metricsPath = `/api/learning/recommendations/metrics?${metricsParams.toString()}`;

      const [learningRes, recRes, metricsRes] = await Promise.all([
        fetch(learningPath),
        fetch(recommendationPath),
        fetch(metricsPath),
      ]);
      const [data, recommendationData, metricsData] = await Promise.all([
        learningRes.json(),
        recRes.json(),
        metricsRes.json(),
      ]);

      if (data.decisions && Array.isArray(data.decisions)) setDecisions(data.decisions);
      if (data.lessons && Array.isArray(data.lessons)) setLessons(data.lessons);
      setDriftWarnings(Array.isArray(data.drift_warnings) ? data.drift_warnings : []);
      if (data.stats) setStats({
        totalDecisions: data.stats.totalDecisions || 0,
        totalLessons: data.stats.totalLessons || 0,
        successRate: data.stats.successRate || 0,
        totalWithOutcome: data.stats.totalWithOutcome || 0
      });

      if (Array.isArray(recommendationData.recommendations)) {
        setRecommendations(recommendationData.recommendations);
      }
      if (Array.isArray(metricsData.metrics)) {
        setRecommendationMetrics({
          metrics: metricsData.metrics,
          summary: metricsData.summary || {},
        });
      } else {
        setRecommendationMetrics({ metrics: [], summary: {} });
      }

      if (!recRes.ok || !metricsRes.ok) {
        setRecommendationError(
          recommendationData.error || metricsData.error || 'Failed to load recommendation telemetry'
        );
      } else {
        setRecommendationError('');
      }

      // Auto-generated policy suggestions (org-scoped; best-effort).
      try {
        const sugRes = await fetch('/api/learning/suggestions');
        const sugData = await sugRes.json().catch(() => ({}));
        if (sugRes.ok && Array.isArray(sugData.suggestions)) setSuggestions(sugData.suggestions);
      } catch { /* best-effort */ }

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to fetch learning data:', error);
      setRecommendationError('Failed to load recommendation telemetry');
    }
  }, [agentId, decisionSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Code-optimizer signal aggregation (period-scoped).
  const loadCodeSignals = useCallback(async () => {
    // Clear prior-period data so stale findings never render under the new
    // period label while the switch is in flight or fails.
    setCodeSignals({ findings: [], period: signalsPeriod });
    setCodeSignalsError(false);
    // One retry absorbs a Neon cold-start blip (mirrors the Spend page).
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/learning/code-signals?period=${signalsPeriod}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        setCodeSignals({ findings: d.findings || [], period: d.period });
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    console.warn('Failed to load code signals (signalsPeriod=', signalsPeriod, '):', lastErr);
    setCodeSignalsError(true);
  }, [signalsPeriod]);

  useEffect(() => {
    loadCodeSignals();
  }, [loadCodeSignals]);

  const suggestionReason = (s: any) => {
    if (s.trigger === 'critical_drift') return `Critical drift on ${s.evidence?.metric} (z=${s.evidence?.z_score})`;
    if (s.trigger === 'negative_feedback_trend') return `${s.evidence?.negative_count} negative items · avg rating ${s.evidence?.avg_rating} over ${s.evidence?.period_days}d`;
    return s.trigger || 'pattern detected';
  };

  const handleAcceptSuggestion = async (index: number) => {
    setSuggestionBusy(index);
    setSuggestionError('');
    try {
      const res = await fetch('/api/learning/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', suggestion_index: index }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSuggestionError(data.error || 'Failed to accept suggestion');
        return;
      }
      // The accepted suggestion is now a real policy; refetch the (now-shorter) list.
      const sugRes = await fetch('/api/learning/suggestions');
      const sugData = await sugRes.json().catch(() => ({}));
      if (sugRes.ok) setSuggestions(sugData.suggestions || []);
    } catch {
      setSuggestionError('Failed to accept suggestion');
    } finally {
      setSuggestionBusy(null);
    }
  };

  const getOutcomeVariant = (outcome: any) => {
    switch (outcome) {
      case 'success': return 'success';
      case 'failure': return 'error';
      case 'mixed': return 'warning';
      case 'pending': return 'info';
      default: return 'default';
    }
  };

  const getOutcomeIcon = (outcome: any) => {
    switch (outcome) {
      case 'success': return CheckCircle2;
      case 'failure': return XCircle;
      case 'mixed': return AlertTriangle;
      case 'pending': return Clock;
      default: return Clock;
    }
  };

  const getConfidenceColor = (conf: any) => {
    const c = conf || 0;
    if (c >= 90) return 'text-success';
    if (c >= 70) return 'text-warning';
    return 'text-error';
  };

  const formatPercent = (value: any) => `${Math.round((Number(value) || 0) * 100)}%`;

  const handleRecommendationToggle = async (recommendation: any) => {
    if (!recommendation?.id) return;
    setUpdatingRecommendationId(recommendation.id);
    setRecommendationError('');
    try {
      const res = await fetch(`/api/learning/recommendations/${recommendation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !recommendation.active }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update recommendation state');
      }

      const next = data.recommendation;
      setRecommendations((prev) =>
        prev.map((item) => (item.id === recommendation.id ? { ...item, active: next.active } : item))
      );
      setRecommendationMetrics((prev: any) => ({
        ...prev,
        metrics: Array.isArray(prev.metrics)
          ? prev.metrics.map((item: any) =>
              item.recommendation_id === recommendation.id ? { ...item, active: next.active } : item
            )
          : [],
      }));
    } catch (error: any) {
      setRecommendationError(error.message || 'Failed to update recommendation state');
    } finally {
      setUpdatingRecommendationId('');
    }
  };

  const handleLogDecision = async () => {
    setSubmitting(true);
    setDecisionError('');
    try {
      // Only fields the API persists — it now rejects unknown ones (the old
      // form's type/category were silently dropped server-side).
      const res = await fetch('/api/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decisionForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecisionError(data.error || 'Failed to log decision');
        return;
      }
      setShowDecisionModal(false);
      setDecisionForm({ decision: '', context: '', outcome: 'pending' });
      fetchData();
    } catch (err) {
      console.error('Failed to log decision:', err);
      setDecisionError('Failed to log decision');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRebuildRecommendations = async () => {
    setRebuilding(true);
    setRebuildResult(null);
    setRecommendationError('');
    try {
      const res = await fetch('/api/learning/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: 90, min_samples: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rebuild failed');
      setRebuildResult(`Built ${data.recommendations?.length || 0} recommendations from ${data.episodes_scanned || 0} episodes`);
      fetchData();
    } catch (err: any) {
      setRecommendationError(err.message || 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  };

  // Generate an AGENTS.md / CLAUDE.md from what DashClaw has learned and download
  // it client-side (the route returns markdown; we wrap it in a blob so the
  // browser saves a file the agent can read on its next session).
  const handleExport = useCallback(async (format: 'agents' | 'claude') => {
    setExporting(format);
    try {
      const params = new URLSearchParams({ format });
      if (agentId) params.set('agent_id', agentId);
      const res = await fetch(`/api/learning/export?${params.toString()}`);
      if (!res.ok) throw new Error('export failed');
      const text = await res.text();
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* best-effort download — never break the page over a failed export */
    } finally {
      setExporting(null);
    }
  }, [agentId]);

  return (
    <PageLayout
      title="Agent Learning"
      subtitle={`What your agents have learned${lastUpdated ? ` — updated ${lastUpdated}` : ''}`}
      breadcrumbs={['Dashboard', 'Learning']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <Link href="/learning/analytics" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
            <Zap size={14} /> Analytics
          </Link>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border rounded-lg hover:border-hover transition-colors duration-150 flex items-center gap-1.5"
          >
            <RotateCw size={14} />
            Refresh
          </button>
        </div>
      }
    >
      {/* Purpose + the one action most people want: turn learnings into a file
          their agents read on startup. */}
      <Card hover={false} className="mb-6">
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles size={15} className="text-brand" /> What DashClaw has learned about your agents
              </h2>
              <p className="mt-1.5 text-sm text-tertiary">
                Every governed decision your agents record lands here, and DashClaw distills the
                recurring ones into patterns — what works, what fails, and why. Turn it into an{' '}
                <code className="rounded bg-surface-tertiary px-1 py-0.5 text-xs text-secondary">AGENTS.md</code> or{' '}
                <code className="rounded bg-surface-tertiary px-1 py-0.5 text-xs text-secondary">CLAUDE.md</code>{' '}
                your agents read on their next session.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => handleExport('agents')}
                disabled={exporting !== null}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                <FileText size={14} /> {exporting === 'agents' ? 'Generating…' : 'Generate AGENTS.md'}
              </button>
              <button
                onClick={() => handleExport('claude')}
                disabled={exporting !== null}
                className="flex items-center gap-1.5 rounded-lg bg-surface-tertiary border border px-3 py-2 text-xs font-medium text-secondary transition-colors duration-150 hover:text-white hover:border-hover disabled:opacity-50"
              >
                <FileText size={14} /> {exporting === 'claude' ? 'Generating…' : 'Generate CLAUDE.md'}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <CardContent className="pt-5 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">{stats.totalDecisions}</div>
            <div className="text-xs text-tertiary mt-1">Decisions Tracked</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-5 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">{stats.totalLessons}</div>
            <div className="text-xs text-tertiary mt-1">Distilled Lessons</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-5 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">{stats.successRate}%</div>
            <div className="text-xs text-tertiary mt-1">Success Rate</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-5 text-center">
            <div className="text-2xl font-semibold tabular-nums text-white">{recommendations.filter((r) => r.active).length}</div>
            <div className="text-xs text-tertiary mt-1">Active Recommendations</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Decisions — the ledger agents and operators write to */}
        <Card>
          <CardHeader
            title="Recent Decisions"
            icon={Zap}
            count={decisions.length}
            action={
              <button
                onClick={() => setShowDecisionModal(true)}
                className="flex items-center gap-1 rounded-lg border border-brand/20 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
              >
                <FileText size={12} aria-hidden="true" /> Log decision
              </button>
            }
          />
          <CardContent>
            <div className="relative mb-3">
              <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary" />
              <label htmlFor="decision-search" className="sr-only">Search decisions</label>
              <input
                id="decision-search"
                value={decisionSearch}
                onChange={(e) => setDecisionSearch(e.target.value)}
                placeholder="Search the full decision history…"
                className="w-full rounded-lg border border-border bg-surface-tertiary py-1.5 pl-8 pr-3 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {decisions.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title={decisionSearch ? 'No decisions match this search' : 'No decisions logged yet'}
                  description={decisionSearch
                    ? 'The search runs server-side over the full history — try a different term.'
                    : 'Start tracking decisions to build your knowledge base.'}
                />
              ) : (
                decisions.map((decision) => {
                  const OutcomeIcon = getOutcomeIcon(decision.outcome);
                  return (
                    <div key={decision.id} className="bg-surface-tertiary rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-start gap-2">
                          <OutcomeIcon size={16} className="text-secondary mt-0.5 shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-white">{decision.decision}</div>
                            <div className="text-xs text-tertiary">{decision.timestamp || decision.date}</div>
                          </div>
                        </div>
                        <Badge variant={getOutcomeVariant(decision.outcome)} size="xs">
                          {decision.outcome || 'pending'}
                        </Badge>
                      </div>

                      {decision.context && (
                        <div className="text-sm text-secondary pl-6">{decision.context}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Lessons — LIVE consolidation from scored outcomes (learning
            recommendations) + open drift alerts; nothing here is hand-entered. */}
        <Card>
          <CardHeader title="Distilled Lessons" icon={Lightbulb} count={lessons.length} />
          <CardContent>
            {driftWarnings.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Drift</span>
                {driftWarnings.map((w: any, i: number) => (
                  <span
                    key={i}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      w.severity === 'critical'
                        ? 'border-error/30 bg-error-subtle text-error'
                        : 'border-warning/30 bg-warning-subtle text-warning'
                    }`}
                  >
                    {String(w.metric).replace(/_/g, ' ')} {w.direction}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {lessons.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No lessons distilled yet"
                  description="Lessons are consolidated from scored action outcomes. They appear once agents report outcomes and recommendations build (every 10 scored episodes, or Rebuild Now below)."
                />
              ) : (
                lessons.map((lesson, i) => {
                  const hintChips = [
                    lesson.hints?.risk_cap != null && `risk cap ${lesson.hints.risk_cap}`,
                    lesson.hints?.prefer_reversible && 'prefer reversible',
                    lesson.hints?.confidence_floor != null && `confidence ≥ ${lesson.hints.confidence_floor}`,
                    lesson.hints?.expected_duration != null && `~${lesson.hints.expected_duration}ms`,
                    lesson.hints?.expected_cost != null && `~$${lesson.hints.expected_cost}`,
                  ].filter(Boolean) as string[];
                  return (
                    <div key={i} data-entity-type="lesson" data-entity-id={String(lesson.action_type ?? i)} className="bg-surface-tertiary rounded-lg p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-medium text-white">{lesson.action_type}</span>
                        <span className="tabular-nums text-xs text-tertiary">{lesson.sample_size || 0} samples</span>
                      </div>
                      {lesson.guidance && (
                        <p className="mt-1.5 text-sm text-secondary">{lesson.guidance}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-xs text-tertiary">
                          Confidence{' '}
                          <span className={`font-semibold tabular-nums ${getConfidenceColor(lesson.confidence)}`}>
                            {lesson.confidence || 0}%
                          </span>
                        </span>
                        <span className="text-xs text-tertiary">
                          Success{' '}
                          <span className="font-semibold tabular-nums text-white">{lesson.success_rate ?? 0}%</span>
                        </span>
                        {hintChips.map((chip) => (
                          <span key={chip} className="rounded border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] text-secondary">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        {/* Recommendations + their telemetry in ONE card — the separate
            Metrics card was mostly empty (it needs SDK telemetry events);
            metrics now render inline on the recommendation they belong to. */}
        <Card>
          <CardHeader title="Recommendation Ops" icon={Power} count={recommendations.length} />
          <CardContent>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
              <button
                onClick={handleRebuildRecommendations}
                disabled={rebuilding}
                className="px-3 py-1.5 text-xs font-medium text-secondary hover:text-white bg-surface-tertiary border border rounded-lg hover:border-brand/40 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                {rebuilding ? 'Rebuilding...' : 'Rebuild Now'}
              </button>
              {rebuildResult && (
                <span className="text-xs text-success">{rebuildResult}</span>
              )}
              {(recommendationMetrics.metrics || []).length > 0 && (
                <span className="ml-auto text-xs tabular-nums text-tertiary">
                  Avg adoption {formatPercent(recommendationMetrics.summary?.avg_adoption_rate)} · avg success lift {formatPercent(recommendationMetrics.summary?.avg_success_lift)}
                </span>
              )}
            </div>
            {recommendationError ? (
              <div className="mb-3 text-xs text-error bg-error-subtle border border-error/20 rounded-md px-3 py-2">
                {recommendationError}
              </div>
            ) : null}
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {recommendations.length === 0 ? (
                <EmptyState
                  icon={Power}
                  title="No recommendations yet"
                  description="Click 'Rebuild Now' to generate recommendations from your action history."
                />
              ) : (
                recommendations.map((rec) => {
                  const metric = (recommendationMetrics.metrics || []).find(
                    (m: any) => m.recommendation_id === rec.id
                  );
                  return (
                    <div key={rec.id} data-entity-type="recommendation" data-entity-id={rec.id} className="bg-surface-tertiary rounded-lg p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-white">
                            {rec.agent_id} - {rec.action_type}
                          </div>
                          <div className="text-xs text-tertiary mt-1">
                            Confidence {rec.confidence || 0}% | Samples {rec.sample_size || 0}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={rec.active ? 'success' : 'default'} size="xs">
                            {rec.active ? 'active' : 'inactive'}
                          </Badge>
                          <button
                            onClick={() => handleRecommendationToggle(rec)}
                            disabled={updatingRecommendationId === rec.id}
                            className="px-2.5 py-1 text-xs rounded border border-hover text-secondary hover:text-white disabled:opacity-50"
                          >
                            {updatingRecommendationId === rec.id
                              ? 'Saving...'
                              : rec.active
                                ? 'Disable'
                                : 'Enable'}
                          </button>
                        </div>
                      </div>
                      {metric && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-tertiary">
                          <TrendingUp size={12} aria-hidden="true" />
                          <span>Adoption {formatPercent(metric.telemetry?.adoption_rate)}</span>
                          <span>Success lift {formatPercent(metric.deltas?.success_lift)}</span>
                          <span>Failure −{formatPercent(metric.deltas?.failure_reduction)}</span>
                          {metric.deltas?.latency_delta_ms != null && (
                            <span>Latency {metric.deltas.latency_delta_ms > 0 ? '+' : ''}{Math.round(metric.deltas.latency_delta_ms)}ms</span>
                          )}
                          {metric.outcomes && (
                            <span>Applied {metric.outcomes.applied?.total ?? 0} vs baseline {metric.outcomes.baseline?.total ?? 0}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
        {/* Suggested Policies (from negative-feedback / drift trends) */}
        <Card>
          <CardHeader title="Suggested Policies" icon={Sparkles} count={suggestions.length} />
          <CardContent>
            {suggestionError && (
              <div className="mb-3 text-xs text-error bg-error-subtle border border-error/20 rounded-md px-3 py-2">{suggestionError}</div>
            )}
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {suggestions.length === 0 ? (
                <EmptyState icon={Sparkles} title="No policy suggestions" description="DashClaw proposes approval policies when negative-feedback or drift trends appear." />
              ) : (
                suggestions.map((s, i) => (
                  <div key={i} className="bg-surface-tertiary rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{s.suggested_policy?.name}</div>
                        <div className="text-xs text-tertiary mt-1">{s.agent_id} · {s.action_type}</div>
                        <div className="text-xs text-secondary mt-1">{suggestionReason(s)}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge variant={s.severity === 'high' ? 'error' : 'warning'} size="xs">{s.suggested_policy?.policy_type}</Badge>
                        <button
                          onClick={() => handleAcceptSuggestion(i)}
                          disabled={suggestionBusy === i}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-brand/20 bg-brand/10 text-brand hover:bg-brand/15 disabled:opacity-50"
                        >
                          <CheckCircle2 size={12} />
                          {suggestionBusy === i ? 'Accepting…' : 'Accept'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Code Signals (optimizer findings + savings) */}
        <Card>
          <CardHeader title="Code Signals" icon={Code2} count={codeSignals.findings.length} />
          <CardContent>
            <div className="flex items-center gap-1.5 mb-3">
              {['7d', '30d', '90d'].map((p) => (
                <button
                  key={p}
                  onClick={() => setSignalsPeriod(p)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    signalsPeriod === p ? 'border-brand/30 bg-brand/10 text-brand' : 'border-transparent text-tertiary hover:border-border hover:text-secondary'
                  }`}
                >
                  {p}
                </button>
              ))}
              <span className="ml-auto text-xs text-tertiary">
                Saved ${codeSignals.findings.reduce((sum: number, f: any) => sum + (Number(f.total_savings_usd) || 0), 0).toFixed(2)}
              </span>
            </div>
            {codeSignalsError && (
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-error bg-error-subtle border border-error/30 rounded-md px-3 py-2">
                <span>Failed to load code signals.</span>
                <button
                  onClick={loadCodeSignals}
                  className="rounded-md border border-border px-2.5 py-1 text-secondary transition-colors hover:border-border-hover"
                >
                  Retry
                </button>
              </div>
            )}
            <div className="space-y-2 max-h-[380px] overflow-y-auto">
              {codeSignals.findings.length === 0 ? (
                <EmptyState icon={Code2} title="No code signals" description="Optimizer findings from ingested code sessions appear here." />
              ) : (
                codeSignals.findings.map((f: any) => (
                  <div key={f.kind} className="flex items-center justify-between gap-3 bg-surface-tertiary rounded-md p-3">
                    <span className="text-sm text-secondary">{f.kind.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-3 text-xs tabular-nums text-tertiary">
                      <span>{f.occurrence_count} in {f.session_count} session{f.session_count === 1 ? '' : 's'}</span>
                      {Number(f.total_savings_usd) > 0 && <span className="text-success">${Number(f.total_savings_usd).toFixed(2)}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Log Decision Modal */}
      {showDecisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowDecisionModal(false); setDecisionError(''); }}>
          <div className="bg-surface-secondary border border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <FileText size={18} className="text-info" />
              Log Decision
            </h3>

            {decisionError && (
              <div className="mb-4 text-xs text-error bg-error-subtle border border-error/20 rounded-md px-3 py-2">
                {decisionError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-secondary mb-1">Decision</label>
                <input
                  type="text"
                  value={decisionForm.decision}
                  onChange={(e) => setDecisionForm((prev) => ({ ...prev, decision: e.target.value }))}
                  placeholder="What was decided?"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Context</label>
                <textarea
                  value={decisionForm.context}
                  onChange={(e) => setDecisionForm((prev) => ({ ...prev, context: e.target.value }))}
                  placeholder="Why was this decision made?"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand resize-none"
                />
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Outcome</label>
                <select
                  value={decisionForm.outcome}
                  onChange={(e) => setDecisionForm((prev) => ({ ...prev, outcome: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand"
                >
                  <option value="pending">Pending</option>
                  <option value="success">Success</option>
                  <option value="failure">Failure</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowDecisionModal(false); setDecisionError(''); }}
                className="px-4 py-2 rounded-lg text-sm text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogDecision}
                disabled={submitting || !decisionForm.decision.trim()}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Log Decision'}
              </button>
            </div>
          </div>
        </div>
      )}

    </PageLayout>
  );
}
