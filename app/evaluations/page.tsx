'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

// Per-type config placeholders matching the engine's real config keys
// (app/lib/eval.ts) — the old form showed a regex placeholder for every type.
const CONFIG_PLACEHOLDERS: Record<string, string> = {
  regex: '{"pattern": "success|completed"}',
  contains: '{"keywords": ["success", "done"], "mode": "any"}',
  numeric_range: '{"field": "risk_score", "min": 0, "max": 50}',
  custom_function: '{"expression": "outcome === \'success\' ? 1 : 0"}',
  llm_judge: '{}',
};

// The synthetic action a "Test config" preview runs against (shown in the UI).
const PREVIEW_SAMPLE = {
  outcome: 'completed successfully',
  action_type: 'deploy',
  risk_score: 42,
  status: 'completed',
  declared_goal: 'ship the release',
};

// One-click starter scorers — real configs the engine runs as-is, no LLM key
// needed. The blank raw-JSON form was the only path before.
const SCORER_TEMPLATES = [
  {
    name: 'Outcome mentions success',
    scorer_type: 'regex',
    description: 'Passes actions whose reported outcome matches success|completed|done',
    config: { pattern: 'success|completed|done' },
  },
  {
    name: 'No error keywords',
    scorer_type: 'contains',
    description: 'Flags actions whose outcome mentions an error (score 0 on match)',
    config: { keywords: ['error', 'failed', 'exception'], mode: 'any', match_score: 0, no_match_score: 1 },
  },
  {
    name: 'Risk stayed low',
    scorer_type: 'numeric_range',
    description: 'Passes actions whose risk_score stayed at or below 50',
    config: { field: 'risk_score', min: 0, max: 50 },
  },
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

  // Inline toast for action failures (delete/cancel/detail)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Create scorer form
  const [showCreateScorer, setShowCreateScorer] = useState(false);
  const [newScorer, setNewScorer] = useState<NewScorer>({ name: '', scorer_type: 'regex', config: '{}', description: '' });
  const [scorerFormError, setScorerFormError] = useState('');
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Dry-run preview (POST /api/evaluations/scorers/preview) — test a config
  // against a recent action before creating the scorer.
  const [previewResult, setPreviewResult] = useState<{ score?: number | null; label?: string | null; reasoning?: string | null; error?: string | null } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Create run form
  const [showCreateRun, setShowCreateRun] = useState(false);
  const [newRun, setNewRun] = useState<NewRun>({ name: '', scorer_id: '' });
  const [runFormError, setRunFormError] = useState('');

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

  // Light polling while any run is pending/running so a launched run visibly
  // progresses to completed without manual refresh (cleared when all terminal).
  const hasActiveRun = runs.some((r) => r.status === 'pending' || r.status === 'running');
  useEffect(() => {
    if (!hasActiveRun || isDemo) return;
    const t = setInterval(() => { fetchData(); }, 4000);
    return () => clearInterval(t);
  }, [hasActiveRun, isDemo, fetchData]);

  const selection = useSelection<any>(scores, (s) => s.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleCopyIds = () => {
    if (selection.count === 0) return;
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(selection.selectedIds.join('\n'));
  };

  const BULK_ACTIONS = [{ id: 'copy-ids', label: 'Copy IDs', icon: Copy, onClick: handleCopyIds }];

  // Create scorer handler — inline form errors, never a native dialog.
  const handleCreateScorer = async () => {
    setScorerFormError('');
    try {
      let parsedConfig;
      try { parsedConfig = JSON.parse(newScorer.config); } catch {
        setScorerFormError('Invalid JSON in the config field.');
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
        setPreviewResult(null);
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        setScorerFormError(res.status === 403 ? 'Creating scorers requires an admin role.' : (err.error || 'Failed to create scorer.'));
      }
    } catch {
      setScorerFormError('Failed to create scorer.');
    }
  };

  // One-click template create — same route, prefilled real config.
  const handleCreateTemplate = async (template: typeof SCORER_TEMPLATES[number]) => {
    setCreatingTemplate(template.name);
    try {
      const res = await fetch('/api/evaluations/scorers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (res.ok) {
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(res.status === 403 ? 'Creating scorers requires an admin role.' : (err.error || 'Failed to create scorer from template.'));
      }
    } catch {
      showToast('Failed to create scorer from template.');
    } finally {
      setCreatingTemplate(null);
    }
  };

  // Dry-run the in-form config against a recent action (no scorer created).
  const handlePreviewScorer = async () => {
    setPreviewBusy(true);
    setPreviewResult(null);
    setScorerFormError('');
    try {
      let parsedConfig;
      try { parsedConfig = JSON.parse(newScorer.config); } catch {
        setScorerFormError('Invalid JSON in the config field.');
        return;
      }
      const res = await fetch('/api/evaluations/scorers/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scorer_type: newScorer.scorer_type,
          config: parsedConfig,
          sample: PREVIEW_SAMPLE,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPreviewResult(data.result || data);
      else setScorerFormError(data.error || 'Preview failed.');
    } catch {
      setScorerFormError('Preview failed.');
    } finally {
      setPreviewBusy(false);
    }
  };

  // Create run handler — inline form errors, never a native dialog.
  const handleCreateRun = async () => {
    setRunFormError('');
    if (!newRun.scorer_id) { setRunFormError('Select a scorer first.'); return; }
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
        const err = await res.json().catch(() => ({}));
        setRunFormError(res.status === 403 ? 'Starting runs requires an admin role.' : (err.error || 'Failed to create run.'));
      }
    } catch {
      setRunFormError('Failed to create run.');
    }
  };

  // Delete scorer — two-step inline confirmation, no native dialog.
  const handleDeleteScorer = async (id: string) => {
    if (confirmingDeleteId !== id) { setConfirmingDeleteId(id); return; }
    setConfirmingDeleteId(null);
    try {
      const res = await fetch(`/api/evaluations/scorers/${id}`, { method: 'DELETE' });
      if (!res.ok) { showToast(res.status === 403 ? 'Deleting scorers requires an admin role.' : 'Delete scorer failed'); return; }
      fetchData();
    } catch { showToast('Delete scorer failed'); }
  };

  // Cancel a stuck (pending/running) run
  const handleCancelRun = async (id: string) => {
    setCancelingRunId(id);
    try {
      const res = await fetch(`/api/evaluations/runs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed' }),
      });
      if (!res.ok) { showToast('Cancel run failed'); return; }
      fetchData();
    } catch { showToast('Cancel run failed'); } finally {
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
      else showToast('Failed to load run detail');
    } catch { showToast('Failed to load run detail'); }
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
      subtitle="Grade recorded actions with scorers — rule-based or LLM-judged; results feed Reputation"
      breadcrumbs={['Labs', 'Evaluations']}
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
        {toast && (
          <div className="fixed inset-x-4 bottom-4 z-30 rounded-lg border border-error/30 bg-error-subtle p-3 text-center text-sm text-error" role="alert">{toast}</div>
        )}
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
                (scoreBand !== 'all' || scorerFilter !== 'all') ? (
                  <EmptyState
                    icon={BarChart3}
                    title="No scores match these filters"
                    description="Adjust or clear the filters to see more scores."
                  />
                ) : (
                  <div className="py-8 text-center">
                    <BarChart3 size={24} className="mx-auto text-tertiary" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-semibold text-white">No scores yet — here&apos;s the loop</h3>
                    <ol className="mx-auto mt-3 max-w-md space-y-1.5 text-left text-xs text-secondary">
                      <li><span className="tabular-nums font-semibold text-tertiary">1.</span> Define a scorer — what &ldquo;good&rdquo; means (regex, keywords, a numeric range; no LLM key needed).</li>
                      <li><span className="tabular-nums font-semibold text-tertiary">2.</span> Run it over your recorded actions from the Runs tab.</li>
                      <li><span className="tabular-nums font-semibold text-tertiary">3.</span> Scores and the distribution land here — and feed agent Reputation.</li>
                    </ol>
                    <button
                      onClick={() => { setActiveTab('scorers'); setShowCreateScorer(true); }}
                      className={`${primaryBtn} mx-auto mt-4`}
                    >
                      <Plus size={14} aria-hidden="true" /> Create your first scorer
                    </button>
                    <p className="mt-3 text-[11px] text-tertiary">
                      Agents can also push scores directly via <code className="font-mono">POST /api/evaluations</code> or the Python SDK&apos;s <code className="font-mono">create_score()</code>.
                    </p>
                  </div>
                )
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Start from a template</span>
                {SCORER_TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => handleCreateTemplate(t)}
                    disabled={creatingTemplate !== null}
                    title={t.description}
                    className={secondaryBtn}
                  >
                    {creatingTemplate === t.name ? 'Creating…' : t.name}
                  </button>
                ))}
              </div>
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
                  <p className="text-xs text-tertiary">
                    {SCORER_TYPES.find((t) => t.value === newScorer.scorer_type)?.description}
                  </p>
                  <label htmlFor="scorer-config" className="sr-only">Config</label>
                  <textarea
                    id="scorer-config"
                    value={newScorer.config}
                    onChange={e => setNewScorer(s => ({ ...s, config: e.target.value }))}
                    placeholder={CONFIG_PLACEHOLDERS[newScorer.scorer_type] || '{}'}
                    rows={3}
                    className={`w-full font-mono ${inputClass}`}
                  />
                  {scorerFormError && (
                    <div role="alert" className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{scorerFormError}</div>
                  )}
                  {previewResult && (
                    <div role="status" className={`rounded-lg border px-3 py-2 text-xs ${previewResult.error ? 'border-error/30 bg-error-subtle text-error' : 'border-border bg-surface-tertiary text-secondary'}`}>
                      {previewResult.error
                        ? `Preview error: ${previewResult.error}`
                        : <>Test against a sample action (outcome &ldquo;{PREVIEW_SAMPLE.outcome}&rdquo;, risk {PREVIEW_SAMPLE.risk_score}): score <span className="font-semibold tabular-nums text-white">{previewResult.score ?? '—'}</span> · {previewResult.label || 'no label'}{previewResult.reasoning ? ` · ${previewResult.reasoning}` : ''}</>}
                    </div>
                  )}
                  {newScorer.scorer_type === 'llm_judge' && !llmAvailable && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-2 text-xs text-warning">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>AI provider not configured. Set <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">ANTHROPIC_API_KEY</code>, or <code className="font-mono">GOOGLE_AI_API_KEY</code> to enable LLM-as-judge.</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCreateScorer(false)} className={secondaryBtn}>Cancel</button>
                    <button onClick={handlePreviewScorer} disabled={previewBusy} className={secondaryBtn}>
                      {previewBusy ? 'Testing…' : 'Test config'}
                    </button>
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
                          {confirmingDeleteId === scorer.id ? (
                            <span className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleDeleteScorer(scorer.id)}
                                className="rounded border border-error/30 bg-error-subtle px-2 py-0.5 text-xs font-medium text-error transition-colors hover:border-error/50"
                              >
                                Confirm delete
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteId(null)}
                                className="text-xs text-tertiary transition-colors hover:text-white"
                              >
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleDeleteScorer(scorer.id)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                              aria-label={`Delete ${scorer.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
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
                  {runFormError && (
                    <div role="alert" className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{runFormError}</div>
                  )}
                  <p className="text-[11px] text-tertiary">
                    Runs score your last 500 recorded actions. Code scorers finish in seconds;
                    LLM-judge runs can exceed the serverless time limit on large batches — if one
                    stalls, Cancel it and re-run with an agent filter.
                  </p>
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
                            {run.status === 'running' && <RefreshCw size={14} className="shrink-0 motion-safe:animate-spin text-info" aria-hidden="true" />}
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
