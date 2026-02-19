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

const MATURITY_CONFIG = {
  master: { color: 'text-purple-400', bg: 'bg-purple-500', variant: 'info' },
  expert: { color: 'text-green-400', bg: 'bg-green-500', variant: 'success' },
  proficient: { color: 'text-blue-400', bg: 'bg-blue-500', variant: 'info' },
  competent: { color: 'text-yellow-400', bg: 'bg-yellow-500', variant: 'warning' },
  developing: { color: 'text-orange-400', bg: 'bg-orange-500', variant: 'warning' },
  novice: { color: 'text-zinc-400', bg: 'bg-zinc-500', variant: 'default' },
  unknown: { color: 'text-zinc-600', bg: 'bg-zinc-700', variant: 'default' },
};

function VelocityArrow({ velocity }) {
  if (velocity > 0.5) return <TrendingUp size={14} className="text-green-400" />;
  if (velocity < -0.5) return <TrendingDown size={14} className="text-red-400" />;
  return <Minus size={14} className="text-zinc-500" />;
}

function MaturityBar({ score, level }) {
  const conf = MATURITY_CONFIG[level] || MATURITY_CONFIG.unknown;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${conf.bg}`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <Badge variant={conf.variant} size="xs">{level}</Badge>
      <span className="text-[10px] text-zinc-500 tabular-nums">{score}/100</span>
    </div>
  );
}

function ScoreBar({ score, maxScore = 100 }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  const color = score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400 tabular-nums">{score}</span>
    </div>
  );
}

export default function LearningAnalyticsPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('overview');

  const [summary, setSummary] = useState(null);
  const [velocity, setVelocity] = useState([]);
  const [curves, setCurves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const [summaryRes, velocityRes, curvesRes] = await Promise.all([
        fetch(`/api/learning/analytics/summary${params}`),
        fetch(`/api/learning/analytics/velocity${params}${agentId ? '&' : '?'}limit=30`),
        fetch(`/api/learning/analytics/curves${params}${agentId ? '&' : '?'}limit=50`),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (velocityRes.ok) { const d = await velocityRes.json(); setVelocity(d.velocity || []); }
      if (curvesRes.ok) { const d = await curvesRes.json(); setCurves(d.curves || []); }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCompute = async () => {
    setComputing(true);
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
    } catch { alert('Computation failed'); }
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
      actions={
        <div className="flex items-center gap-2">
          <button onClick={handleCompute} disabled={computing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">
            {computing ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {computing ? 'Computing...' : 'Compute Analytics'}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Episodes" value={overall.total_episodes || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Avg Score" value={overall.avg_score || '--'} color={parseFloat(overall.avg_score) >= 70 ? 'text-green-400' : parseFloat(overall.avg_score) >= 50 ? 'text-yellow-400' : 'text-red-400'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Success Rate" value={overall.success_rate ? `${Math.round(overall.success_rate * 100)}%` : '--'} color="text-green-400" />
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
        <div className="flex gap-1 border-b border-[rgba(255,255,255,0.06)]">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'text-white border-brand' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}>
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
                    {agents.map((a, i) => (
                      <div key={a.agent_id} className="py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-600 tabular-nums w-4">#{i + 1}</span>
                            <span className="text-sm text-white font-medium">{a.agent_id}</span>
                            <MaturityBar score={a.maturity_score} level={a.maturity_level} />
                          </div>
                          <div className="flex items-center gap-2">
                            <VelocityArrow velocity={a.velocity} />
                            <span className="text-xs text-zinc-400 tabular-nums">{a.velocity !== null ? (a.velocity > 0 ? '+' : '') + a.velocity + '/d' : '--'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-zinc-600">
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
                    {actionTypes.map(a => (
                      <div key={a.action_type} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-zinc-300 truncate">{a.action_type}</span>
                          <Badge size="xs">{a.episode_count}</Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <ScoreBar score={Number(a.avg_score)} />
                          <span className="text-xs text-zinc-500 tabular-nums w-10">{Math.round(a.success_rate * 100)}%</span>
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
                  {velocity.map((v, i) => (
                    <div key={i} className="py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{v.agent_id}</span>
                          <Badge size="xs">{v.episode_count} eps</Badge>
                          <MaturityBar score={Number(v.maturity_score)} level={v.maturity_level} />
                        </div>
                        <div className="flex items-center gap-3">
                          <VelocityArrow velocity={Number(v.velocity)} />
                          <span className={`text-xs tabular-nums ${Number(v.velocity) > 0 ? 'text-green-400' : Number(v.velocity) < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                            {Number(v.velocity) > 0 ? '+' : ''}{v.velocity} pts/period
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-[10px] text-zinc-600">
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
                  {curves.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-300">{c.agent_id}</span>
                        <Badge size="xs">{c.action_type}</Badge>
                        <Badge size="xs" variant="info">{c.episode_count} eps</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <ScoreBar score={Number(c.avg_score)} />
                        <span className="text-xs text-zinc-500 tabular-nums">{Math.round(Number(c.success_rate) * 100)}%</span>
                        <span className="text-[10px] text-zinc-600">{new Date(c.window_start).toLocaleDateString()}</span>
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
                    {agents.map(a => (
                      <div key={a.agent_id} className="py-3 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-white font-medium">{a.agent_id}</span>
                          <MaturityBar score={a.maturity_score} level={a.maturity_level} />
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="text-center">
                            <div className="text-xs text-zinc-300 tabular-nums">{a.episode_count}</div>
                            <div className="text-[9px] text-zinc-600">Episodes</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-zinc-300 tabular-nums">{a.avg_score}</div>
                            <div className="text-[9px] text-zinc-600">Avg Score</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-zinc-300 tabular-nums">{Math.round(a.success_rate * 100)}%</div>
                            <div className="text-[9px] text-zinc-600">Success</div>
                          </div>
                          <div className="text-center">
                            <div className={`text-xs tabular-nums ${a.velocity > 0 ? 'text-green-400' : a.velocity < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                              {a.velocity !== null ? (a.velocity > 0 ? '+' : '') + a.velocity : '--'}
                            </div>
                            <div className="text-[9px] text-zinc-600">Velocity</div>
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
                    { level: 'master', desc: '1000+ episodes, 92%+ success, 85+ avg score', color: 'bg-purple-500' },
                    { level: 'expert', desc: '500+ episodes, 85%+ success, 75+ avg score', color: 'bg-green-500' },
                    { level: 'proficient', desc: '150+ episodes, 75%+ success, 65+ avg score', color: 'bg-blue-500' },
                    { level: 'competent', desc: '50+ episodes, 60%+ success, 55+ avg score', color: 'bg-yellow-500' },
                    { level: 'developing', desc: '10+ episodes, 40%+ success, 40+ avg score', color: 'bg-orange-500' },
                    { level: 'novice', desc: 'Starting out - fewer than 10 episodes', color: 'bg-zinc-500' },
                  ].map(m => {
                    const agentsAtLevel = agents.filter(a => a.maturity_level === m.level);
                    return (
                      <div key={m.level} className="flex items-center gap-3 py-1.5">
                        <div className={`w-3 h-3 rounded-full ${m.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white capitalize">{m.level}</div>
                          <div className="text-[10px] text-zinc-600">{m.desc}</div>
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
