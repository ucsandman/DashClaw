'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Plus, Play, Trash2, ChevronRight, ChevronDown,
  AlertCircle, CheckCircle, XCircle, Clock, Filter, RefreshCw,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Stat, StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';

const TABS = [
  { id: 'scores', label: 'Scores' },
  { id: 'scorers', label: 'Scorers' },
  { id: 'runs', label: 'Runs' },
];

const SCORER_TYPES = [
  { value: 'regex', label: 'Regex Match', description: 'Match action outcomes against a regex pattern' },
  { value: 'contains', label: 'Keyword Contains', description: 'Check if outcome contains specific keywords' },
  { value: 'numeric_range', label: 'Numeric Range', description: 'Check if a numeric field falls in a range' },
  { value: 'custom_function', label: 'Custom Expression', description: 'Write a JS expression that returns 0.0-1.0' },
  { value: 'llm_judge', label: 'LLM-as-Judge', description: 'AI evaluates action quality (requires AI provider)' },
];

const SCORE_VARIANT = (score) => {
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'error';
};

function ScoreBar({ score }) {
  if (score === null || score === undefined) return <span className="text-zinc-500">--</span>;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? 'bg-green-500' : score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-300">{pct}%</span>
    </div>
  );
}

export default function EvaluationsPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('scores');

  // Data state
  const [scores, setScores] = useState([]);
  const [scorers, setScorers] = useState([]);
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create scorer form
  const [showCreateScorer, setShowCreateScorer] = useState(false);
  const [newScorer, setNewScorer] = useState({ name: '', scorer_type: 'regex', config: '{}', description: '' });

  // Create run form
  const [showCreateRun, setShowCreateRun] = useState(false);
  const [newRun, setNewRun] = useState({ name: '', scorer_id: '' });

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const [scoresRes, scorersRes, runsRes, statsRes] = await Promise.all([
        fetch(`/api/evaluations${params}${params ? '&' : '?'}limit=50`),
        fetch('/api/evaluations/scorers'),
        fetch('/api/evaluations/runs?limit=20'),
        fetch(`/api/evaluations/stats${params}`),
      ]);

      if (scoresRes.ok) { const d = await scoresRes.json(); setScores(d.scores || []); }
      if (scorersRes.ok) {
        const d = await scorersRes.json();
        setScorers(d.scorers || []);
        setLlmAvailable(d.llm_available || false);
      }
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.runs || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
    } catch (err) {
      console.error('Failed to fetch evaluation data:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
  const handleDeleteScorer = async (id) => {
    if (!confirm('Delete this scorer? Existing scores will be preserved.')) return;
    try {
      await fetch(`/api/evaluations/scorers/${id}`, { method: 'DELETE' });
      fetchData();
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

  return (
    <PageLayout
      title="Evaluations"
      subtitle="Score and measure agent decision quality"
      breadcrumbs={['Operations', 'Evaluations']}
      actions={
        <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={16} />
        </button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total Scores" value={overall.total_scores || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Avg Score" value={overall.avg_score ? `${Math.round(overall.avg_score * 100)}%` : '--'} color={overall.avg_score >= 0.8 ? 'text-green-400' : overall.avg_score >= 0.5 ? 'text-yellow-400' : 'text-red-400'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Active Scorers" value={overall.unique_scorers || scorers.length || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Scored Today" value={overall.today_count || 0} />
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[rgba(255,255,255,0.06)]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'text-white border-brand' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'scores' && (
          <Card>
            <CardHeader title="Recent Scores" icon={BarChart3} count={scores.length} />
            <CardContent>
              {scores.length === 0 ? (
                <EmptyState icon={BarChart3} title="No scores yet" description="Create a scorer and run an evaluation, or submit scores via the SDK." />
              ) : (
                <div className="space-y-2">
                  {scores.map(score => (
                    <div key={score.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={SCORE_VARIANT(score.score)} size="xs">{score.label || (score.score >= 0.5 ? 'pass' : 'fail')}</Badge>
                        <span className="text-xs text-zinc-400 truncate">{score.scorer_name}</span>
                        <span className="text-[10px] text-zinc-600 truncate">{score.action_id}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <ScoreBar score={score.score} />
                        <span className="text-[10px] text-zinc-600">{score.evaluated_by}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'scorers' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowCreateScorer(!showCreateScorer)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
                <Plus size={14} /> New Scorer
              </button>
            </div>

            {showCreateScorer && (
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={newScorer.name} onChange={e => setNewScorer(s => ({ ...s, name: e.target.value }))} placeholder="Scorer name" className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                    <select value={newScorer.scorer_type} onChange={e => setNewScorer(s => ({ ...s, scorer_type: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                      {SCORER_TYPES.map(t => (
                        <option key={t.value} value={t.value} disabled={t.value === 'llm_judge' && !llmAvailable}>
                          {t.label}{t.value === 'llm_judge' && !llmAvailable ? ' (no AI key)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input value={newScorer.description} onChange={e => setNewScorer(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)" className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                  <textarea value={newScorer.config} onChange={e => setNewScorer(s => ({ ...s, config: e.target.value }))} placeholder='{"pattern": "success|completed"}' rows={3} className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand font-mono" />
                  {newScorer.scorer_type === 'llm_judge' && !llmAvailable && (
                    <div className="flex items-center gap-2 text-xs text-yellow-400">
                      <AlertCircle size={14} /> AI provider not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY to enable LLM-as-judge.
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCreateScorer(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleCreateScorer} disabled={!newScorer.name} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Create Scorer</button>
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
                      <div key={scorer.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-sm text-white font-medium">{scorer.name}</span>
                          <Badge size="xs">{scorer.scorer_type}</Badge>
                          {scorer.description && <span className="text-xs text-zinc-500 truncate">{scorer.description}</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-zinc-500">{scorer.total_scores || 0} scores</span>
                          {scorer.avg_score !== null && scorer.avg_score !== undefined && <ScoreBar score={parseFloat(scorer.avg_score)} />}
                          <button onClick={() => handleDeleteScorer(scorer.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
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
              <button onClick={() => setShowCreateRun(!showCreateRun)} disabled={scorers.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">
                <Play size={14} /> New Run
              </button>
            </div>

            {showCreateRun && (
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={newRun.name} onChange={e => setNewRun(s => ({ ...s, name: e.target.value }))} placeholder="Run name (optional)" className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                    <select value={newRun.scorer_id} onChange={e => setNewRun(s => ({ ...s, scorer_id: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                      <option value="">Select scorer...</option>
                      {scorers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.scorer_type})</option>)}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCreateRun(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleCreateRun} disabled={!newRun.scorer_id} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Start Run</button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader title="Evaluation Runs" icon={Play} count={runs.length} />
              <CardContent>
                {runs.length === 0 ? (
                  <EmptyState icon={Play} title="No evaluation runs" description={scorers.length === 0 ? 'Create a scorer first, then run an evaluation.' : 'Start a run to batch-evaluate agent actions.'} />
                ) : (
                  <div className="space-y-2">
                    {runs.map(run => (
                      <div key={run.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex items-center gap-3 min-w-0">
                          {run.status === 'completed' && <CheckCircle size={14} className="text-green-400 shrink-0" />}
                          {run.status === 'running' && <RefreshCw size={14} className="text-blue-400 shrink-0 animate-spin" />}
                          {run.status === 'failed' && <XCircle size={14} className="text-red-400 shrink-0" />}
                          {run.status === 'pending' && <Clock size={14} className="text-zinc-500 shrink-0" />}
                          <span className="text-sm text-white font-medium">{run.name}</span>
                          <Badge size="xs">{run.scorer_name || run.scorer_type || '--'}</Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-zinc-500">{run.scored_count || 0}/{run.total_actions || '?'} scored</span>
                          {run.avg_score !== null && run.avg_score !== undefined && <ScoreBar score={parseFloat(run.avg_score)} />}
                          <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : run.status === 'running' ? 'info' : 'default'} size="xs">{run.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Score Distribution (shown on all tabs) */}
        {stats?.distribution && stats.distribution.length > 0 && (
          <Card>
            <CardHeader title="Score Distribution" />
            <CardContent>
              <div className="flex items-end gap-2 h-20">
                {stats.distribution.map((bucket, i) => {
                  const maxCount = Math.max(...stats.distribution.map(b => parseInt(b.count) || 0));
                  const height = maxCount > 0 ? ((parseInt(bucket.count) || 0) / maxCount) * 100 : 0;
                  const color = bucket.bucket === 'excellent' ? 'bg-green-500' : bucket.bucket === 'acceptable' ? 'bg-yellow-500' : 'bg-red-500';
                  return (
                    <div key={bucket.bucket} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-zinc-500 tabular-nums">{bucket.count}</span>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(height, 4)}%` }}>
                        <div className={`w-full h-full rounded-t ${color}`} />
                      </div>
                      <span className="text-[10px] text-zinc-500 capitalize">{bucket.bucket}</span>
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
