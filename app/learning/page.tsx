'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BookOpen, Zap, Lightbulb, Sparkles, FileText, RotateCw, CheckCircle2, XCircle, AlertTriangle, Clock, Power, BarChart3, TrendingUp, Code2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';

export default function LearningDashboard() {
  const { agentId } = useAgentFilter();
  const [decisions, setDecisions] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recommendationMetrics, setRecommendationMetrics] = useState<any>({ metrics: [], summary: {} });
  const [recommendationError, setRecommendationError] = useState('');
  const [updatingRecommendationId, setUpdatingRecommendationId] = useState('');
  const [stats, setStats] = useState({ totalDecisions: 0, totalLessons: 0, successRate: 0, patterns: 0 });
  const [lastUpdated, setLastUpdated] = useState('');
  const [showPatterns, setShowPatterns] = useState(false);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ decision: '', category: 'general', context: '', outcome: 'pending' });
  const [lessonForm, setLessonForm] = useState({ lesson: '', category: 'general', confidence: 80, tags: '' });
  const [submitting, setSubmitting] = useState(false);
  const [lessonError, setLessonError] = useState('');
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
      setStats(prev => {
        const newTotalDecisions = prev.totalDecisions + 1;
        const successCount = (prev.successRate * prev.totalDecisions / 100) + (payload.outcome === 'success' ? 1 : 0);
        return {
          ...prev,
          totalDecisions: newTotalDecisions,
          successRate: Math.round((successCount / newTotalDecisions) * 100)
        };
      });
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
      if (data.stats) setStats({
        totalDecisions: data.stats.totalDecisions || 0,
        totalLessons: data.stats.totalLessons || 0,
        successRate: data.stats.successRate || 0,
        patterns: data.stats.patterns || 0
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
  }, [agentId]);

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

  const parseTags = (tags: any) => {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(t => t);
    return [];
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
      const res = await fetch('/api/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'decision', ...decisionForm }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDecisionError(data.error || 'Failed to log decision');
        return;
      }
      setShowDecisionModal(false);
      setDecisionForm({ decision: '', category: 'general', context: '', outcome: 'pending' });
      fetchData();
    } catch (err) {
      console.error('Failed to log decision:', err);
      setDecisionError('Failed to log decision');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddLesson = async () => {
    setSubmitting(true);
    setLessonError('');
    try {
      const res = await fetch('/api/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: lessonForm.lesson,
          category: lessonForm.category,
          confidence: lessonForm.confidence,
          tags: lessonForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLessonError(data.error || 'Failed to add lesson');
        return;
      }
      setShowLessonModal(false);
      setLessonForm({ lesson: '', category: 'general', confidence: 80, tags: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to add lesson:', err);
      setLessonError('Failed to add lesson');
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
            <div className="text-xs text-tertiary mt-1">Lessons Learned</div>
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
            <div className="text-2xl font-semibold tabular-nums text-white">{stats.patterns}</div>
            <div className="text-xs text-tertiary mt-1">Patterns Found</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Decisions */}
        <Card>
          <CardHeader title="Recent Decisions" icon={Zap} count={decisions.length} />
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {decisions.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No decisions logged yet"
                  description="Start tracking decisions to build your knowledge base."
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
                        <div className="text-sm text-secondary mb-3 pl-6">{decision.context}</div>
                      )}

                      {parseTags(decision.tags).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3 pl-6">
                          {parseTags(decision.tags).map((tag: any, index: number) => (
                            <span key={index} className="px-2 py-0.5 bg-white/5 rounded text-xs text-secondary">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Lessons */}
        <Card>
          <CardHeader title="Distilled Lessons" icon={Lightbulb} count={lessons.length} />
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {lessons.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No lessons captured yet"
                  description="Lessons are distilled from your tracked decisions."
                />
              ) : (
                lessons.map((lesson) => (
                  <div key={lesson.id} data-entity-type="lesson" data-entity-id={lesson.id} className="bg-surface-tertiary rounded-lg p-4">
                    <div className="text-sm font-medium text-white mb-2">{lesson.lesson}</div>

                    {lesson.source_decisions && (
                      <div className="text-sm text-secondary mb-3">{lesson.source_decisions}</div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="text-xs text-tertiary">Confidence</div>
                          <div className={`text-sm font-semibold tabular-nums ${getConfidenceColor(lesson.confidence)}`}>
                            {lesson.confidence || 0}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-tertiary">Validated</div>
                          <div className="text-sm font-semibold text-white tabular-nums">{lesson.times_validated || 0}x</div>
                        </div>
                      </div>

                      <div className="w-24">
                        <div className="w-full bg-white/5 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${(lesson.confidence || 0) >= 90 ? 'bg-status-success' : (lesson.confidence || 0) >= 70 ? 'bg-status-warning' : 'bg-status-error'}`}
                            style={{ width: `${lesson.confidence || 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader title="Recommendation Ops" icon={Power} count={recommendations.length} />
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
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
                recommendations.map((rec) => (
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
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Recommendation Metrics" icon={BarChart3} count={recommendationMetrics.metrics?.length || 0} />
          <CardContent>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-surface-tertiary rounded-lg p-3">
                <div className="text-xs text-tertiary">Active</div>
                <div className="text-sm text-white font-semibold">
                  {recommendationMetrics.summary?.active_recommendations || 0}
                </div>
              </div>
              <div className="bg-surface-tertiary rounded-lg p-3">
                <div className="text-xs text-tertiary">Avg Adoption</div>
                <div className="text-sm text-white font-semibold">
                  {formatPercent(recommendationMetrics.summary?.avg_adoption_rate)}
                </div>
              </div>
              <div className="bg-surface-tertiary rounded-lg p-3">
                <div className="text-xs text-tertiary">Avg Success Lift</div>
                <div className="text-sm text-white font-semibold">
                  {formatPercent(recommendationMetrics.summary?.avg_success_lift)}
                </div>
              </div>
            </div>

            <div className="space-y-2 max-h-[330px] overflow-y-auto">
              {(recommendationMetrics.metrics || []).slice(0, 20).map((metric: any) => (
                <div key={metric.recommendation_id} className="bg-surface-tertiary rounded-md p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-secondary">
                      {metric.agent_id} - {metric.action_type}
                    </div>
                    <Badge variant={metric.active ? 'success' : 'default'} size="xs">
                      {metric.active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <div className="text-xs text-tertiary flex items-center gap-1.5">
                    <TrendingUp size={12} />
                    Adoption {formatPercent(metric.telemetry?.adoption_rate)} · Success lift {formatPercent(metric.deltas?.success_lift)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-tertiary">
                    <span>Failure −{formatPercent(metric.deltas?.failure_reduction)}</span>
                    {metric.deltas?.latency_delta_ms != null && (
                      <span>Latency {metric.deltas.latency_delta_ms > 0 ? '+' : ''}{Math.round(metric.deltas.latency_delta_ms)}ms</span>
                    )}
                    {metric.deltas?.cost_delta_estimate != null && (
                      <span>Cost {metric.deltas.cost_delta_estimate > 0 ? '+' : ''}${Number(metric.deltas.cost_delta_estimate).toFixed(2)}</span>
                    )}
                    {metric.outcomes && (
                      <span>Applied {metric.outcomes.applied?.total ?? 0} vs baseline {metric.outcomes.baseline?.total ?? 0}</span>
                    )}
                  </div>
                </div>
              ))}
              {(recommendationMetrics.metrics || []).length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="No metrics yet"
                  description="Metrics appear after recommendation telemetry and outcomes are recorded."
                />
              ) : null}
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

      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader title="Quick Actions" icon={Zap} />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setShowPatterns((prev) => !prev)}
              className="bg-surface-tertiary rounded-lg p-4 text-left hover:border-hover transition-colors duration-150"
            >
              <div className="text-sm font-medium text-purple-400 flex items-center gap-1.5">
                <Sparkles size={14} />
                View Patterns
              </div>
              <div className="text-xs text-tertiary mt-1">Analyze decision patterns</div>
            </button>
            <button
              onClick={() => setShowDecisionModal(true)}
              className="bg-surface-tertiary rounded-lg p-4 text-left hover:border-hover transition-colors duration-150"
            >
              <div className="text-sm font-medium text-info flex items-center gap-1.5">
                <FileText size={14} />
                Log Decision
              </div>
              <div className="text-xs text-tertiary mt-1">Record a new decision</div>
            </button>
            <button
              onClick={() => setShowLessonModal(true)}
              className="bg-surface-tertiary rounded-lg p-4 text-left hover:border-hover transition-colors duration-150"
            >
              <div className="text-sm font-medium text-warning flex items-center gap-1.5">
                <Lightbulb size={14} />
                Add Lesson
              </div>
              <div className="text-xs text-tertiary mt-1">Capture a new lesson</div>
            </button>
          </div>

          {/* Inline Patterns Panel */}
          {showPatterns && (
            <div className="mt-4 bg-surface-tertiary rounded-lg p-4 border border">
              <div className="text-sm font-medium text-purple-400 mb-3 flex items-center gap-1.5">
                <Sparkles size={14} />
                Pattern Summary
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="bg-secondary rounded-lg p-3">
                  <div className="text-xs text-tertiary">Patterns Found</div>
                  <div className="text-lg font-semibold text-white tabular-nums">{stats.patterns}</div>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <div className="text-xs text-tertiary">Decisions Tracked</div>
                  <div className="text-lg font-semibold text-white tabular-nums">{stats.totalDecisions}</div>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <div className="text-xs text-tertiary">Success Rate</div>
                  <div className="text-lg font-semibold text-white tabular-nums">{stats.successRate}%</div>
                </div>
                <div className="bg-secondary rounded-lg p-3">
                  <div className="text-xs text-tertiary">Lessons Learned</div>
                  <div className="text-lg font-semibold text-white tabular-nums">{stats.totalLessons}</div>
                </div>
              </div>
              {decisions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-tertiary uppercase tracking-wide">Decision Categories</div>
                  {(() => {
                    const categories: Record<string, { total: number; success: number }> = {};
                    decisions.forEach((d) => {
                      const cat = d.category || 'general';
                      if (!categories[cat]) categories[cat] = { total: 0, success: 0 };
                      categories[cat].total++;
                      if (d.outcome === 'success') categories[cat].success++;
                    });
                    return Object.entries(categories).map(([cat, data]) => (
                      <div key={cat} className="flex items-center justify-between bg-secondary rounded-md px-3 py-2">
                        <span className="text-sm text-secondary capitalize">{cat}</span>
                        <span className="text-xs text-tertiary">
                          {data.total} decision{data.total !== 1 ? 's' : ''} | {data.total > 0 ? Math.round((data.success / data.total) * 100) : 0}% success
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className="text-sm text-tertiary">No decisions logged yet. Patterns will appear as decisions are tracked.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
                <label className="block text-xs text-secondary mb-1">Category</label>
                <select
                  value={decisionForm.category}
                  onChange={(e) => setDecisionForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand"
                >
                  <option value="general">General</option>
                  <option value="technical">Technical</option>
                  <option value="business">Business</option>
                  <option value="security">Security</option>
                  <option value="performance">Performance</option>
                </select>
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

      {/* Add Lesson Modal */}
      {showLessonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowLessonModal(false); setLessonError(''); }}>
          <div className="bg-surface-secondary border border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Lightbulb size={18} className="text-warning" />
              Add Lesson
            </h3>

            {lessonError && (
              <div className="mb-4 text-xs text-error bg-error-subtle border border-error/20 rounded-md px-3 py-2">
                {lessonError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-secondary mb-1">Lesson</label>
                <textarea
                  value={lessonForm.lesson}
                  onChange={(e) => setLessonForm((prev) => ({ ...prev, lesson: e.target.value }))}
                  placeholder="What was learned?"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand resize-none"
                />
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Category</label>
                <select
                  value={lessonForm.category}
                  onChange={(e) => setLessonForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand"
                >
                  <option value="general">General</option>
                  <option value="technical">Technical</option>
                  <option value="business">Business</option>
                  <option value="security">Security</option>
                  <option value="performance">Performance</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Confidence: {lessonForm.confidence}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={lessonForm.confidence}
                  onChange={(e) => setLessonForm((prev) => ({ ...prev, confidence: Number(e.target.value) }))}
                  className="w-full accent-brand"
                />
                <div className="flex justify-between text-xs text-disabled mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-secondary mb-1">Tags (comma separated)</label>
                <input
                  type="text"
                  value={lessonForm.tags}
                  onChange={(e) => setLessonForm((prev) => ({ ...prev, tags: e.target.value }))}
                  placeholder="e.g. optimization, caching, api"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border text-sm text-white focus:outline-none focus:border-brand"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowLessonModal(false); setLessonError(''); }}
                className="px-4 py-2 rounded-lg text-sm text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLesson}
                disabled={submitting || !lessonForm.lesson.trim()}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Add Lesson'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
