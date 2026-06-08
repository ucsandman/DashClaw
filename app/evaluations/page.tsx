'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Plus, Play, Trash2, Copy,
  AlertCircle, CheckCircle, XCircle, Clock, Filter, RefreshCw,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';
import { demoEvalScorers, demoEvalScores, demoEvalRuns, demoEvalStats } from '../lib/demoEvaluationsData';

interface EvalScore {
  id: string;
  action_id?: string;
  scorer_id?: string;
  scorer_name?: string;
  score?: number | null;
  label?: string;
  evaluated_by?: string;
  created_at?: string;
}

interface EvalScorer {
  id: string;
  name: string;
  scorer_type: string;
  description?: string;
  total_scores?: number;
  avg_score?: number | string | null;
  config?: unknown;
}

interface DistributionBucket {
  bucket: string;
  count: number | string;
}

interface EvalRun {
  id: string;
  name?: string;
  scorer_id?: string;
  scorer_name?: string;
  scorer_type?: string;
  status?: string;
  scored_count?: number;
  total_actions?: number;
  avg_score?: number | string | null;
  created_at?: string;
}

interface RunDetail {
  distribution?: DistributionBucket[];
  [key: string]: unknown;
}

interface EvalStats {
  overall?: {
    total_scores?: number;
    avg_score?: number;
    unique_scorers?: number;
    today_count?: number;
  };
  distribution?: DistributionBucket[];
}

interface NewScorer {
  name: string;
  scorer_type: string;
  config: string;
  description: string;
}

interface NewRun {
  name: string;
  scorer_id: string;
}

const TABS = [
  { id: 'scores', label: 'Scores' },
  { id: 'scorers', label: 'Scorers' },
  { id: 'runs', label: 'Runs' },
];

const SCORER_TYPES = [
  { value: 'regex', label: 'Regex match', description: 'Match action outcomes against a regex pattern' },
  { value: 'contains', label: 'Keyword contains', description: 'Check if outcome contains specific keywords' },
  { value: 'numeric_range', label: 'Numeric range', description: 'Check if a numeric field falls in a range' },
  { value: 'custom_function', label: 'Custom expression', description: 'Write a JS expression that returns 0.0-1.0' },
  { value: 'llm_judge', label: 'LLM-as-judge', description: 'AI evaluates action quality (requires AI provider)' },
];

const SCORE_VARIANT = (score: number | null | undefined): string => {
  if (score == null) return 'error';
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'error';
};

function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-xs text-tertiary">—</span>;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? 'bg-status-success' : score >= 0.5 ? 'bg-status-warning' : 'bg-status-error';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 tabular-nums text-xs text-secondary">{pct}%</span>
    </div>
  );
}

export default function EvaluationsPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('scores');

  // Data state
  const [scores, setScores] = useState<EvalScore[]>([]);
  const [scorers, setScorers] = useState<EvalScorer[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [stats, setStats] = useState<EvalStats | null>(null);
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);

  // Score filters (backend supports scorer_name / min_score / max_score + total).
  const [scoreBand, setScoreBand] = useState('all');
  const [scorerFilter, setScorerFilter] = useState('all');
  const [scoreTotal, setScoreTotal] = useState(0);

  // Run detail (distribution) + cancel
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null);

  // Create scorer form
  const [showCreateScorer, setShowCreateScorer] = useState(false);
  const [newScorer, setNewScorer] = useState<NewScorer>({ name: '', scorer_type: 'regex', config: '{}', description: '' });

  // Create run form
  const [showCreateRun, setShowCreateRun] = useState(false);
  const [newRun, setNewRun] = useState<NewRun>({ name: '', scorer_id: '' });

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setRefreshError(false);
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 800));
        setScores(demoEvalScores);
        setScorers(demoEvalScorers);
        setRuns(demoEvalRuns);
        setStats(demoEvalStats);
        setLlmAvailable(true);
        setLoading(false);
        return;
      }

      const params = agentId ? `?agent_id=${agentId}` : '';
      const evalParams = new URLSearchParams();
      if (agentId) evalParams.set('agent_id', agentId);
      evalParams.set('limit', '50');
      if (scorerFilter !== 'all') evalParams.set('scorer_name', scorerFilter);
      if (scoreBand === 'failing') evalParams.set('max_score', '0.5');
      if (scoreBand === 'passing') evalParams.set('min_score', '0.5');
      const [scoresRes, scorersRes, runsRes, statsRes] = await Promise.all([
        fetch(`/api/evaluations?${evalParams}`),
        fetch('/api/evaluations/scorers'),
        fetch('/api/evaluations/runs?limit=20'),
        fetch(`/api/evaluations/stats${params}`),
      ]);

      // Clear the filtered list on failure so stale rows can't masquerade as the new
      // score-band/scorer result, and flag the error instead of swallowing it.
      let failed = false;
      if (scoresRes.ok) {
        const d = await scoresRes.json();
        setScores(d.scores || []);
        setScoreTotal(typeof d.total === 'number' ? d.total : (d.scores || []).length);
      } else {
        setScores([]);
        setScoreTotal(0);
        failed = true;
      }
      if (scorersRes.ok) {
        const d = await scorersRes.json();
        setScorers(d.scorers || []);
        setLlmAvailable(d.llm_available || false);
      }
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.runs || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); } else { failed = true; }
      setRefreshError(failed);
    } catch (err) {
      console.error('Failed to fetch evaluation data:', err);
      setRefreshError(true);
    } finally {
      setLoading(false);
    }
  }, [agentId, scoreBand, scorerFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selection = useSelection<any>(scores, (s) => s.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleCopyIds = () => {
    if (selection.count === 0) return;
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(selection.selectedIds.join('\n'));
  };

  const BULK_ACTIONS = [{ id: 'copy-ids', label: 'Copy IDs', icon: Copy, onClick: handleCopyIds }];

  // Create scorer handler
  const handleCreateScorer = async () => {
    try {
      let parsedConfig;
      try { parsedConfig = JSON.parse(newScorer.config); } catch {
        alert('Invalid JSON in config field');
        return;
      }
      const res = await fetch('/api/evaluations/scorers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newScorer.name,
          scorer_type: newScorer.scorer_type,
          config: parsedConfig,
          description: newScorer.description,
        }),
      });
      if (res.ok) {
        setShowCreateScorer(false);
        setNewScorer({ name: '', scorer_type: 'regex', config: '{}', description: '' });
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create scorer');
      }
    } catch (err) {
      alert('Error creating scorer');
    }
  };

  // Create run handler
  const handleCreateRun = async () => {
    if (!newRun.scorer_id) { alert('Select a scorer'); return; }
    try {
      const res = await fetch('/api/evaluations/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRun.name || `Run ${new Date().toLocaleDateString()}`,
          scorer_id: newRun.scorer_id,
        }),
      });
      if (res.ok) {
        setShowCreateRun(false);
        setNewRun({ name: '', scorer_id: '' });
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create run');
      }
    } catch (err) {
      alert('Error creating run');
    }
  };

  // Delete scorer handler
  const handleDeleteScorer = async (id: string) => {
    if (!confirm('Delete this scorer? Existing scores will be preserved.')) return;
    try {
      await fetch(`/api/evaluations/scorers/${id}`, { method: 'DELETE' });
      fetchData();
    } catch { /* ignore */ }
  };

  // Cancel a stuck (pending/running) run
  const handleCancelRun = async (id: string) => {
    setCancelingRunId(id);
    try {
      await fetch(`/api/evaluations/runs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed' }),
      });
      fetchData();
    } catch { /* ignore */ } finally {
      setCancelingRunId(null);
    }
  };

  // Toggle a run's score-distribution detail
  const handleToggleRunDetail = async (id: string) => {
    if (expandedRunId === id) { setExpandedRunId(null); setRunDetail(null); return; }
    setExpandedRunId(id);
    setRunDetail(null);
    try {
      const res = await fetch(`/api/evaluations/runs/${id}`);
      if (res.ok) setRunDetail(await res.json());
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <PageLayout title="Evaluations" subtitle="Score and measure agent decision quality">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};

  const avgScoreColor =
    overall.avg_score && overall.avg_score >= 0.8 ? 'text-success'
    : overall.avg_score && overall.avg_score >= 0.5 ? 'text-warning'
    : overall.avg_score ? 'text-error' : 'text-white';

  const inputClass = 'rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';
  const filterSelect = 'rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';

  const primaryBtn = 'flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50';
  const secondaryBtn = 'rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white';

  return (
    <PageLayout
      title="Evaluations"
      subtitle="Score and measure agent decision quality"
      breadcrumbs={['Operations', 'Evaluations']}
      maturity="beta"
      actions={
        <>
          <button
            onClick={fetchData}
            aria-label="Refresh"
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      <div className="space-y-6">
        {refreshError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-subtle px-4 py-2.5 text-xs text-error">
            <span>Couldn&apos;t load the latest evaluation data — results may be incomplete.</span>
            <button onClick={fetchData} className="rounded-md border border-error/30 px-2.5 py-1 font-medium transition-colors hover:bg-error/10">Retry</button>
          </div>
        )}
        {/* Instrument rail */}
        <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary md:grid-cols-4">
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total scores</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{overall.total_scores || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Avg score</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${avgScoreColor}`}>
              {overall.avg_score ? `${Math.round(overall.avg_score * 100)}%` : '—'}
            </div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Active scorers</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{overall.unique_scorers || scorers.length || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Scored today</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{overall.today_count || 0}</div>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex items-center gap-1 border-b border-border">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'scores' && (
          <Card>
            <CardHeader title="Recent scores" icon={BarChart3} count={scores.length} />
            <CardContent>
              {!isDemo && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <select value={scorerFilter} onChange={(e) => setScorerFilter(e.target.value)} className={filterSelect} aria-label="Filter by scorer">
                    <option value="all">All scorers</option>
                    {scorers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <select value={scoreBand} onChange={(e) => setScoreBand(e.target.value)} className={filterSelect} aria-label="Filter by score band">
                    <option value="all">All scores</option>
                    <option value="passing">Passing (≥50%)</option>
                    <option value="failing">Failing (&lt;50%)</option>
                  </select>
                  <span className="ml-auto text-[11px] tabular-nums text-tertiary">Showing {scores.length} of {scoreTotal}</span>
                </div>
              )}
              {scores.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title={(scoreBand !== 'all' || scorerFilter !== 'all') ? 'No scores match these filters' : 'No scores yet'}
                  description={(scoreBand !== 'all' || scorerFilter !== 'all')
                    ? 'Adjust or clear the filters to see more scores.'
                    : 'Create a scorer and run an evaluation, or submit scores via the SDK.'}
                />
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <SelectCheckbox
                      checked={selection.allSelected}
                      onToggle={() => selection.toggleAll()}
                      label="Select all"
                    />
                    <span className="text-xs text-tertiary">Select all</span>
                  </div>
                  <div className="space-y-2">
                  {scores.map(score => (
                    <div
                      key={score.id}
                      data-entity-type="evaluation"
                      data-entity-id={score.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-2"
                    >
                      <SelectCheckbox
                        checked={selection.isSelected(score.id)}
                        onToggle={(e) => { e.stopPropagation(); selection.selectClick(score.id, e.shiftKey); }}
                        label={`Select ${score.scorer_name ?? score.id}`}
                      />
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge variant={SCORE_VARIANT(score.score)} size="xs">{score.label || (score.score != null && score.score >= 0.5 ? 'pass' : 'fail')}</Badge>
                        <span className="truncate text-xs text-secondary">{score.scorer_name}</span>
                        <span className="truncate font-mono text-[11px] text-tertiary">{score.action_id}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <ScoreBar score={score.score} />
                        <span className="text-[11px] text-tertiary">{score.evaluated_by}</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'scorers' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowCreateScorer(!showCreateScorer)} className={primaryBtn}>
                <Plus size={14} aria-hidden="true" /> New scorer
              </button>
            </div>

            {showCreateScorer && (
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <div className="grid grid-cols-2 gap-3">
                    <label htmlFor="scorer-name" className="sr-only">Scorer name</label>
                    <input
                      id="scorer-name"
                      value={newScorer.name}
                      onChange={e => setNewScorer(s => ({ ...s, name: e.target.value }))}
                      placeholder="Scorer name"
                      className={inputClass}
                    />
                    <label htmlFor="scorer-type" className="sr-only">Scorer type</label>
                    <select
                      id="scorer-type"
                      value={newScorer.scorer_type}
                      onChange={e => setNewScorer(s => ({ ...s, scorer_type: e.target.value }))}
                      className={inputClass}
                    >
                      {SCORER_TYPES.map(t => (
                        <option key={t.value} value={t.value} disabled={t.value === 'llm_judge' && !llmAvailable}>
                          {t.label}{t.value === 'llm_judge' && !llmAvailable ? ' (no AI key)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label htmlFor="scorer-description" className="sr-only">Description</label>
                  <input
                    id="scorer-description"
                    value={newScorer.description}
                    onChange={e => setNewScorer(s => ({ ...s, description: e.target.value }))}
                    placeholder="Description (optional)"
                    className={`w-full ${inputClass}`}
                  />
                  <label htmlFor="scorer-config" className="sr-only">Config</label>
                  <textarea
                    id="scorer-config"
                    value={newScorer.config}
                    onChange={e => setNewScorer(s => ({ ...s, config: e.target.value }))}
                    placeholder='{"pattern": "success|completed"}'
                    rows={3}
                    className={`w-full font-mono ${inputClass}`}
                  />
                  {newScorer.scorer_type === 'llm_judge' && !llmAvailable && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-2 text-xs text-warning">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>AI provider not configured. Set <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">ANTHROPIC_API_KEY</code>, or <code className="font-mono">GOOGLE_AI_API_KEY</code> to enable LLM-as-judge.</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCreateScorer(false)} className={secondaryBtn}>Cancel</button>
                    <button onClick={handleCreateScorer} disabled={!newScorer.name} className={primaryBtn}>Create scorer</button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader title="Scorers" icon={Filter} count={scorers.length} />
              <CardContent>
                {scorers.length === 0 ? (
                  <EmptyState icon={Filter} title="No scorers defined" description="Create a scorer to start evaluating agent decisions." />
                ) : (
                  <div className="space-y-2">
                    {scorers.map(scorer => (
                      <div
                        key={scorer.id}
                        data-entity-type="scorer"
                        data-entity-id={scorer.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-sm font-medium text-white">{scorer.name}</span>
                          <Badge size="xs">{scorer.scorer_type}</Badge>
                          {scorer.description && <span className="truncate text-xs text-tertiary">{scorer.description}</span>}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="tabular-nums text-xs text-tertiary">{scorer.total_scores || 0} scores</span>
                          {scorer.avg_score !== null && scorer.avg_score !== undefined && <ScoreBar score={parseFloat(String(scorer.avg_score))} />}
                          <button
                            onClick={() => handleDeleteScorer(scorer.id)}
                            className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                            aria-label={`Delete ${scorer.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'runs' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowCreateRun(!showCreateRun)}
                disabled={scorers.length === 0}
                className={primaryBtn}
              >
                <Play size={14} aria-hidden="true" /> New run
              </button>
            </div>

            {showCreateRun && (
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <div className="grid grid-cols-2 gap-3">
                    <label htmlFor="run-name" className="sr-only">Run name</label>
                    <input
                      id="run-name"
                      value={newRun.name}
                      onChange={e => setNewRun(s => ({ ...s, name: e.target.value }))}
                      placeholder="Run name (optional)"
                      className={inputClass}
                    />
                    <label htmlFor="run-scorer" className="sr-only">Scorer</label>
                    <select
                      id="run-scorer"
                      value={newRun.scorer_id}
                      onChange={e => setNewRun(s => ({ ...s, scorer_id: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">Select scorer…</option>
                      {scorers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.scorer_type})</option>)}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCreateRun(false)} className={secondaryBtn}>Cancel</button>
                    <button onClick={handleCreateRun} disabled={!newRun.scorer_id} className={primaryBtn}>Start run</button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader title="Evaluation runs" icon={Play} count={runs.length} />
              <CardContent>
                {runs.length === 0 ? (
                  <EmptyState icon={Play} title="No evaluation runs" description={scorers.length === 0 ? 'Create a scorer first, then run an evaluation.' : 'Start a run to batch-evaluate agent actions.'} />
                ) : (
                  <div className="space-y-2">
                    {runs.map(run => {
                      const terminal = run.status === 'completed' || run.status === 'failed';
                      const open = expandedRunId === run.id;
                      return (
                      <div key={run.id} className="rounded-lg border border-border bg-surface-tertiary">
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-3">
                            {run.status === 'completed' && <CheckCircle size={14} className="shrink-0 text-success" aria-hidden="true" />}
                            {run.status === 'running' && <RefreshCw size={14} className="shrink-0 animate-spin text-info" aria-hidden="true" />}
                            {run.status === 'failed' && <XCircle size={14} className="shrink-0 text-error" aria-hidden="true" />}
                            {run.status === 'pending' && <Clock size={14} className="shrink-0 text-tertiary" aria-hidden="true" />}
                            <span className="text-sm font-medium text-white">{run.name}</span>
                            <Badge size="xs">{run.scorer_name || run.scorer_type || '—'}</Badge>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="tabular-nums text-xs text-tertiary">{run.scored_count || 0}/{run.total_actions || '?'} scored</span>
                            {run.avg_score !== null && run.avg_score !== undefined && <ScoreBar score={parseFloat(String(run.avg_score))} />}
                            <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : run.status === 'running' ? 'info' : 'default'} size="xs">{run.status}</Badge>
                            {!terminal && (
                              <button onClick={() => handleCancelRun(run.id)} disabled={cancelingRunId === run.id} className="text-xs text-tertiary transition-colors hover:text-error disabled:opacity-50">
                                {cancelingRunId === run.id ? 'Cancelling…' : 'Cancel'}
                              </button>
                            )}
                            <button onClick={() => handleToggleRunDetail(run.id)} className="text-xs text-tertiary transition-colors hover:text-white">
                              {open ? 'Hide' : 'Detail'}
                            </button>
                          </div>
                        </div>
                        {open && (
                          <div className="border-t border-border px-3 py-3">
                            {!runDetail ? (
                              <div className="text-xs text-tertiary">Loading…</div>
                            ) : (runDetail.distribution && runDetail.distribution.length > 0) ? (
                              <div className="flex h-16 items-end gap-2">
                                {runDetail.distribution.map((b) => {
                                  const max = Math.max(...runDetail.distribution!.map((x) => parseInt(String(x.count)) || 0));
                                  const h = max > 0 ? ((parseInt(String(b.count)) || 0) / max) * 100 : 0;
                                  const color = b.bucket === 'excellent' ? 'bg-status-success' : b.bucket === 'acceptable' ? 'bg-status-warning' : 'bg-status-error';
                                  return (
                                    <div key={b.bucket} className="flex flex-1 flex-col items-center gap-1">
                                      <span className="text-[10px] tabular-nums text-tertiary">{b.count}</span>
                                      <div className="w-full rounded-t" style={{ height: `${Math.max(h, 4)}%` }}>
                                        <div className={`h-full w-full rounded-t ${color}`} />
                                      </div>
                                      <span className="text-[10px] capitalize text-tertiary">{b.bucket}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-xs text-tertiary">No score distribution recorded for this run.</div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Score Distribution (shown on all tabs) */}
        {stats?.distribution && stats.distribution.length > 0 && (
          <Card>
            <CardHeader title="Score distribution" />
            <CardContent>
              <div className="flex h-20 items-end gap-2">
                {stats.distribution.map((bucket) => {
                  const maxCount = Math.max(...stats.distribution!.map(b => parseInt(String(b.count)) || 0));
                  const height = maxCount > 0 ? ((parseInt(String(bucket.count)) || 0) / maxCount) * 100 : 0;
                  const color =
                    bucket.bucket === 'excellent' ? 'bg-status-success'
                    : bucket.bucket === 'acceptable' ? 'bg-status-warning'
                    : 'bg-status-error';
                  return (
                    <div key={bucket.bucket} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[11px] tabular-nums text-tertiary">{bucket.count}</span>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(height, 4)}%` }}>
                        <div className={`h-full w-full rounded-t ${color}`} />
                      </div>
                      <span className="text-[11px] capitalize text-tertiary">{bucket.bucket}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
