'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Zap, BarChart3, Play,
  RefreshCw, Award, Target, Brain, Activity, GitBranch,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { StatCompact } from '../../components/ui/Stat';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { useAgentFilter } from '../../lib/AgentFilterContext';
import { isDemoMode } from '../../lib/isDemoMode';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'velocity', label: 'Velocity' },
  { id: 'curves', label: 'Learning Curves' },
  { id: 'maturity', label: 'Maturity' },
];

const MATURITY_CONFIG: Record<string, { color: string; bg: string; variant: string }> = {
  master: { color: 'text-success', bg: 'bg-status-success', variant: 'success' },
  expert: { color: 'text-success', bg: 'bg-status-success', variant: 'success' },
  proficient: { color: 'text-info', bg: 'bg-status-info', variant: 'info' },
  competent: { color: 'text-warning', bg: 'bg-status-warning', variant: 'warning' },
  developing: { color: 'text-brand', bg: 'bg-brand', variant: 'warning' },
  novice: { color: 'text-secondary', bg: 'bg-zinc-500', variant: 'default' },
  unknown: { color: 'text-disabled', bg: 'bg-elevated', variant: 'default' },
};

function VelocityArrow({ velocity }: { velocity?: any }) {
  if (velocity > 0.5) return <TrendingUp size={14} className="text-success" />;
  if (velocity < -0.5) return <TrendingDown size={14} className="text-error" />;
  return <Minus size={14} className="text-tertiary" />;
}

function MaturityBar({ score, level }: { score?: any; level?: any }) {
  const conf = (MATURITY_CONFIG[level] || MATURITY_CONFIG.unknown)!;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${conf.bg}`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <Badge variant={conf.variant} size="xs">{level}</Badge>
      <span className="text-[10px] text-tertiary tabular-nums">{score}/100</span>
    </div>
  );
}

function ScoreBar({ score, maxScore = 100 }: { score?: any; maxScore?: number }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  const color = score >= 70 ? 'bg-status-success' : score >= 50 ? 'bg-status-warning' : 'bg-status-error';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-secondary tabular-nums">{score}</span>
    </div>
  );
}

export default function LearningAnalyticsPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('overview');

  const [summary, setSummary] = useState<any>(null);
  const [velocity, setVelocity] = useState<any[]>([]);
  const [curves, setCurves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setRefreshError(false);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const [summaryRes, velocityRes, curvesRes] = await Promise.all([
        fetch(`/api/learning/analytics/summary${params}`),
        fetch(`/api/learning/analytics/velocity${params}${agentId ? '&' : '?'}limit=30`),
        fetch(`/api/learning/analytics/curves${params}${agentId ? '&' : '?'}limit=50`),
      ]);
      // Clear slices on failure so a failed agent-scoped fetch can't leave the previous
      // agent's maturity/velocity/curves showing under the new agent, and flag the error.
      let failed = false;
      if (summaryRes.ok) setSummary(await summaryRes.json()); else { setSummary(null); failed = true; }
      if (velocityRes.ok) { const d = await velocityRes.json(); setVelocity(d.velocity || []); } else { setVelocity([]); failed = true; }
      if (curvesRes.ok) { const d = await curvesRes.json(); setCurves(d.curves || []); } else { setCurves([]); failed = true; }
      setRefreshError(failed);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setRefreshError(true);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCompute = async () => {
    setComputing(true);
    setComputeError(null);
    try {
      await fetch('/api/learning/analytics/velocity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: 30 }),
      });
      await fetch('/api/learning/analytics/curves', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_days: 60 }),
      });
      fetchData();
    } catch { setComputeError('Computation failed'); }
    finally { setComputing(false); }
  };

  if (loading) {
    return (
      <PageLayout title="Learning Analytics" subtitle="Agent learning velocity and maturity tracking">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = summary?.overall || {};
  const agents = summary?.by_agent || [];
  const actionTypes = summary?.by_action_type || [];
  const recs = summary?.recommendations || {};

  return (
    <PageLayout
      title="Learning Analytics"
      subtitle="Agent learning velocity and maturity tracking"
      breadcrumbs={['Operations', 'Learning', 'Analytics']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button onClick={handleCompute} disabled={computing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">
            {computing ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {computing ? 'Computing...' : 'Compute Analytics'}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-6">
        {computeError && (
          <div className="rounded-xl border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
            {computeError}
          </div>
        )}
        {refreshError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
            <span>Couldn&apos;t load the latest analytics — results may be incomplete.</span>
            <button onClick={fetchData} className="rounded-md border border-error/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-error/10">Retry</button>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Episodes" value={overall.total_episodes || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Avg Score" value={overall.avg_score || '--'} color={parseFloat(overall.avg_score) >= 70 ? 'text-success' : parseFloat(overall.avg_score) >= 50 ? 'text-warning' : 'text-error'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Success Rate" value={overall.success_rate ? `${Math.round(overall.success_rate * 100)}%` : '--'} color="text-success" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total Cost" value={overall.total_cost ? `$${overall.total_cost}` : '--'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Recommendations" value={recs.total_recommendations || 0} />
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'text-white border-brand' : 'text-tertiary border-transparent hover:text-secondary'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Agent leaderboard */}
            <Card>
              <CardHeader title="Agent Leaderboard" icon={Award} count={agents.length} />
              <CardContent>
                {agents.length === 0 ? (
                  <EmptyState icon={Brain} title="No agent data" description="Record learning episodes to see agent performance." />
                ) : (
                  <div className="space-y-3">
                    {agents.map((a: any, i: number) => (
                      <div key={a.agent_id} className="py-2 px-3 rounded-lg bg-surface-tertiary border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-disabled tabular-nums w-4">#{i + 1}</span>
                            <span className="text-sm text-white font-medium">{a.agent_id}</span>
                            <MaturityBar score={a.maturity_score} level={a.maturity_level} />
                          </div>
                          <div className="flex items-center gap-2">
                            <VelocityArrow velocity={a.velocity} />
                            <span className="text-xs text-secondary tabular-nums">{a.velocity !== null ? (a.velocity > 0 ? '+' : '') + a.velocity + '/d' : '--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-disabled">
                          <span>{a.episode_count} episodes</span>
                          <span>avg: {a.avg_score}</span>
                          <span>success: {Math.round(a.success_rate * 100)}%</span>
                          {a.total_cost > 0 && <span>${a.total_cost}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action type breakdown */}
            <Card>
              <CardHeader title="By Action Type" icon={GitBranch} count={actionTypes.length} />
              <CardContent>
                {actionTypes.length === 0 ? (
                  <EmptyState icon={Target} title="No action data" description="Action types appear after recording episodes." />
                ) : (
                  <div className="space-y-2">
                    {actionTypes.map((a: any) => (
                      <div key={a.action_type} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-secondary truncate">{a.action_type}</span>
                          <Badge size="xs">{a.episode_count}</Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <ScoreBar score={Number(a.avg_score)} />
                          <span className="text-xs text-tertiary tabular-nums w-10">{Math.round(a.success_rate * 100)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'velocity' && (
          <Card>
            <CardHeader title="Learning Velocity" icon={Zap} count={velocity.length} />
            <CardContent>
              {velocity.length === 0 ? (
                <EmptyState icon={Zap} title="No velocity data" description="Click 'Compute Analytics' to calculate learning velocity from episode history." />
              ) : (
                <div className="space-y-2">
                  {velocity.map((v: any, i: number) => (
                    <div key={i} className="py-2 px-3 rounded-lg bg-surface-tertiary border border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{v.agent_id}</span>
                          <Badge size="xs">{v.episode_count} eps</Badge>
                          <MaturityBar score={Number(v.maturity_score)} level={v.maturity_level} />
                        </div>
                        <div className="flex items-center gap-3">
                          <VelocityArrow velocity={Number(v.velocity)} />
                          <span className={`text-xs tabular-nums ${Number(v.velocity) > 0 ? 'text-success' : Number(v.velocity) < 0 ? 'text-error' : 'text-tertiary'}`}>
                            {Number(v.velocity) > 0 ? '+' : ''}{v.velocity} pts/period
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-[10px] text-disabled">
                        <span>Avg: {v.avg_score}</span>
                        <span>Success: {Math.round(Number(v.success_rate) * 100)}%</span>
                        <span>Delta: {Number(v.score_delta) > 0 ? '+' : ''}{v.score_delta} pts</span>
                        <span>Accel: {Number(v.acceleration) > 0 ? '+' : ''}{v.acceleration}</span>
                        <span className="ml-auto">{new Date(v.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'curves' && (
          <Card>
            <CardHeader title="Learning Curves" icon={Activity} count={curves.length} />
            <CardContent>
              {curves.length === 0 ? (
                <EmptyState icon={Activity} title="No curve data" description="Click 'Compute Analytics' to generate learning curves from episode history." />
              ) : (
                <div className="space-y-2">
                  {curves.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-surface-tertiary border border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-secondary">{c.agent_id}</span>
                        <Badge size="xs">{c.action_type}</Badge>
                        <Badge size="xs" variant="info">{c.episode_count} eps</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <ScoreBar score={Number(c.avg_score)} />
                        <span className="text-xs text-tertiary tabular-nums">{Math.round(Number(c.success_rate) * 100)}%</span>
                        <span className="text-[10px] text-disabled">{new Date(c.window_start).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'maturity' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Agent Maturity" icon={Award} />
              <CardContent>
                {agents.length === 0 ? (
                  <EmptyState icon={Award} title="No maturity data" description="Compute velocity to see agent maturity levels." />
                ) : (
                  <div className="space-y-3">
                    {agents.map((a: any) => (
                      <div key={a.agent_id} className="py-3 px-3 rounded-lg bg-surface-tertiary border border-border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-white font-medium">{a.agent_id}</span>
                          <MaturityBar score={a.maturity_score} level={a.maturity_level} />
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="text-center">
                            <div className="text-xs text-secondary tabular-nums">{a.episode_count}</div>
                            <div className="text-[9px] text-disabled">Episodes</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-secondary tabular-nums">{a.avg_score}</div>
                            <div className="text-[9px] text-disabled">Avg Score</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-secondary tabular-nums">{Math.round(a.success_rate * 100)}%</div>
                            <div className="text-[9px] text-disabled">Success</div>
                          </div>
                          <div className="text-center">
                            <div className={`text-xs tabular-nums ${a.velocity > 0 ? 'text-success' : a.velocity < 0 ? 'text-error' : 'text-secondary'}`}>
                              {a.velocity !== null ? (a.velocity > 0 ? '+' : '') + a.velocity : '--'}
                            </div>
                            <div className="text-[9px] text-disabled">Velocity</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Maturity Levels" icon={Target} />
              <CardContent>
                <div className="space-y-3">
                  {[
                    { level: 'master', desc: '1000+ episodes, 92%+ success, 85+ avg score', color: 'bg-status-success' },
                    { level: 'expert', desc: '500+ episodes, 85%+ success, 75+ avg score', color: 'bg-status-success' },
                    { level: 'proficient', desc: '150+ episodes, 75%+ success, 65+ avg score', color: 'bg-status-info' },
                    { level: 'competent', desc: '50+ episodes, 60%+ success, 55+ avg score', color: 'bg-status-warning' },
                    { level: 'developing', desc: '10+ episodes, 40%+ success, 40+ avg score', color: 'bg-brand' },
                    { level: 'novice', desc: 'Starting out - fewer than 10 episodes', color: 'bg-zinc-500' },
                  ].map(m => {
                    const agentsAtLevel = agents.filter((a: any) => a.maturity_level === m.level);
                    return (
                      <div key={m.level} className="flex items-center gap-3 py-1.5">
                        <div className={`w-3 h-3 rounded-full ${m.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white capitalize">{m.level}</div>
                          <div className="text-[10px] text-disabled">{m.desc}</div>
                        </div>
                        <Badge size="xs">{agentsAtLevel.length} agent{agentsAtLevel.length !== 1 ? 's' : ''}</Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
