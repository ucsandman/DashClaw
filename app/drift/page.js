'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, AlertTriangle, AlertCircle, Info, CheckCircle,
  RefreshCw, Play, Zap, TrendingUp, TrendingDown, Minus,
  XCircle, BarChart3, Shield,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';

const TABS = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'baselines', label: 'Baselines' },
  { id: 'trends', label: 'Trends' },
];

const SEVERITY_CONFIG = {
  critical: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', variant: 'error' },
  warning: { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', variant: 'warning' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', variant: 'info' },
};

const DIRECTION_ICON = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  unknown: Minus,
};

function ZScoreBar({ zScore }) {
  const absZ = Math.abs(zScore);
  const maxZ = 5;
  const pct = Math.min((absZ / maxZ) * 100, 100);
  const color = absZ >= 3 ? 'bg-red-500' : absZ >= 2 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 tabular-nums w-8">{zScore > 0 ? '+' : ''}{zScore}</span>
    </div>
  );
}

export default function DriftPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('alerts');

  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const [alertsRes, statsRes, snapshotsRes] = await Promise.all([
        fetch(`/api/drift/alerts${params}${params ? '&' : '?'}limit=50`),
        fetch(`/api/drift/stats${params}`),
        fetch(`/api/drift/snapshots${params}${params ? '&' : '?'}limit=30`),
      ]);
      if (alertsRes.ok) { const d = await alertsRes.json(); setAlerts(d.alerts || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
      if (snapshotsRes.ok) { const d = await snapshotsRes.json(); setSnapshots(d.snapshots || []); }
    } catch (err) {
      console.error('Failed to fetch drift data:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRunDetection = async () => {
    setRunning(true);
    try {
      // Step 1: Compute baselines
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compute_baselines' }),
      });
      // Step 2: Run detection
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detect' }),
      });
      // Step 3: Record snapshots
      await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_snapshots' }),
      });
      fetchData();
    } catch (err) {
      alert('Drift detection failed');
    } finally {
      setRunning(false);
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await fetch(`/api/drift/alerts/${id}`, { method: 'PATCH' });
      fetchData();
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this alert?')) return;
    try {
      await fetch(`/api/drift/alerts/${id}`, { method: 'DELETE' });
      fetchData();
    } catch {}
  };

  if (loading) {
    return (
      <PageLayout title="Drift Detection" subtitle="Statistical behavioral drift analysis">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};

  return (
    <PageLayout
      title="Drift Detection"
      subtitle="Statistical behavioral drift analysis"
      breadcrumbs={['Operations', 'Drift Detection']}
      actions={
        <div className="flex items-center gap-2">
          <button onClick={handleRunDetection} disabled={running} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Running...' : 'Run Detection'}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total Alerts" value={overall.total_alerts || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Critical" value={overall.critical_count || 0} color="text-red-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Warning" value={overall.warning_count || 0} color="text-yellow-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Info" value={overall.info_count || 0} color="text-blue-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Unacknowledged" value={overall.unacknowledged || 0} color={parseInt(overall.unacknowledged) > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
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

        {activeTab === 'alerts' && (
          <Card>
            <CardHeader title="Drift Alerts" icon={Activity} count={alerts.length} />
            <CardContent>
              {alerts.length === 0 ? (
                <EmptyState icon={Activity} title="No drift detected" description="Run drift detection to analyze behavioral patterns against baselines." />
              ) : (
                <div className="space-y-2">
                  {alerts.map(alert => {
                    const sevConf = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
                    const SevIcon = sevConf.icon;
                    const DirIcon = DIRECTION_ICON[alert.direction] || Minus;
                    return (
                      <div key={alert.id} className={`py-3 px-3 rounded-lg border ${alert.acknowledged ? 'bg-[#0a0a0a] border-[rgba(255,255,255,0.02)]' : sevConf.bg}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <SevIcon size={14} className={sevConf.color} />
                            <Badge variant={sevConf.variant} size="xs">{alert.severity}</Badge>
                            <Badge size="xs">{alert.metric}</Badge>
                            <span className="text-xs text-zinc-400">{alert.agent_id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ZScoreBar zScore={Number(alert.z_score)} />
                            <DirIcon size={14} className={alert.direction === 'increasing' ? 'text-red-400' : 'text-blue-400'} />
                            <span className="text-xs text-zinc-500">{alert.pct_change > 0 ? '+' : ''}{alert.pct_change}%</span>
                            {!alert.acknowledged && (
                              <button onClick={() => handleAcknowledge(alert.id)} className="p-1 rounded text-zinc-600 hover:text-green-400 transition-colors" title="Acknowledge">
                                <CheckCircle size={14} />
                              </button>
                            )}
                            {alert.acknowledged && <Badge variant="success" size="xs">ack</Badge>}
                            <button onClick={() => handleDelete(alert.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
                              <XCircle size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1">{alert.description}</p>
                        <div className="flex items-center gap-4 mt-1.5 text-[10px] text-zinc-600">
                          <span>Baseline: {alert.baseline_mean} +/- {alert.baseline_stddev}</span>
                          <span>Current: {alert.current_mean} +/- {alert.current_stddev}</span>
                          <span>Samples: {alert.sample_count}</span>
                          <span className="ml-auto">{new Date(alert.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'baselines' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {stats?.recent_baselines && stats.recent_baselines.length > 0 ? (
              <>
                <Card>
                  <CardHeader title="Recent Baselines" icon={BarChart3} count={stats.recent_baselines.length} />
                  <CardContent>
                    <div className="space-y-2">
                      {stats.recent_baselines.map((b, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-[#111] border border-[rgba(255,255,255,0.04)]">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-300">{b.agent_id}</span>
                            <Badge size="xs">{b.metric}</Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-zinc-400 tabular-nums">mean: {Number(b.mean).toFixed(2)}</span>
                            <span className="text-xs text-zinc-500 tabular-nums">std: {Number(b.stddev).toFixed(2)}</span>
                            <span className="text-[10px] text-zinc-600">{b.sample_count} samples</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {stats?.by_metric && stats.by_metric.length > 0 && (
                  <Card>
                    <CardHeader title="Alerts by Metric" />
                    <CardContent>
                      <div className="space-y-2">
                        {stats.by_metric.map(m => (
                          <div key={m.metric} className="flex items-center justify-between py-1.5">
                            <span className="text-sm text-zinc-300">{m.metric}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-zinc-500 tabular-nums">{m.count} alerts</span>
                              <span className="text-xs text-zinc-400 tabular-nums">avg |z|: {m.avg_z_score}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-16">
                  <EmptyState icon={BarChart3} title="No baselines computed" description="Click 'Run Detection' to compute statistical baselines from your agent data." />
                </CardContent>
              </Card>
            )}

            {stats?.by_agent && stats.by_agent.length > 0 && (
              <Card>
                <CardHeader title="Alerts by Agent" />
                <CardContent>
                  <div className="space-y-2">
                    {stats.by_agent.map(a => (
                      <div key={a.agent_id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-zinc-300">{a.agent_id}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500 tabular-nums">{a.count} alerts</span>
                          {a.critical > 0 && <Badge variant="error" size="xs">{a.critical} crit</Badge>}
                          {a.warning > 0 && <Badge variant="warning" size="xs">{a.warning} warn</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'trends' && (
          <Card>
            <CardHeader title="Metric Snapshots" icon={TrendingUp} count={snapshots.length} />
            <CardContent>
              {snapshots.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No snapshot data" description="Snapshots are recorded when you run drift detection. Run it daily for trend data." />
              ) : (
                <div className="space-y-2">
                  {snapshots.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center gap-2">
                        <Badge size="xs">{s.metric}</Badge>
                        {s.agent_id && <span className="text-xs text-zinc-400">{s.agent_id}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-300 tabular-nums">mean: {Number(s.mean).toFixed(2)}</span>
                        <span className="text-xs text-zinc-500 tabular-nums">std: {Number(s.stddev).toFixed(2)}</span>
                        <span className="text-[10px] text-zinc-600">{s.sample_count} samples</span>
                        <span className="text-[10px] text-zinc-700">{new Date(s.period_start).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
