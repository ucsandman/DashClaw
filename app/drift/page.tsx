'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, AlertCircle, Info, CheckCircle,
  RefreshCw, Play, TrendingUp, TrendingDown, Minus,
  XCircle, BarChart3,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';
import { demoDriftAlerts, demoDriftStats, demoDriftSnapshots } from '../lib/demoDriftData';

interface DriftAlert {
  id: string;
  severity: string;
  metric: string;
  agent_id: string;
  description?: string;
  z_score: number | string;
  direction?: string;
  pct_change?: number;
  drift_type?: string;
  dimension?: string;
  baseline_mean?: number;
  baseline_stddev?: number;
  current_mean?: number;
  current_stddev?: number;
  sample_count?: number;
  acknowledged?: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  created_at: string;
  // Baseline evidence joined by listAlerts (percentiles + distribution have
  // been stored since the schema shipped; the join finally renders them).
  baseline_median?: number | string;
  baseline_p5?: number | string;
  baseline_p25?: number | string;
  baseline_p75?: number | string;
  baseline_p95?: number | string;
  baseline_min?: number | string;
  baseline_max?: number | string;
  baseline_distribution?: unknown;
  baseline_sample_count?: number;
}

interface DriftOverall {
  total_alerts?: number;
  critical_count?: number;
  warning_count?: number;
  info_count?: number;
  unacknowledged?: number | string;
}

interface DriftBaseline {
  agent_id: string;
  metric: string;
  mean: number | string;
  stddev: number | string;
  sample_count: number;
  created_at?: string;
}

interface DriftByMetric {
  metric: string;
  count: number;
  avg_z_score: number;
}

interface DriftByAgent {
  agent_id: string;
  count: number;
  critical: number;
  warning: number;
}

interface DriftStats {
  overall?: DriftOverall;
  recent_baselines?: DriftBaseline[];
  by_metric?: DriftByMetric[];
  by_agent?: DriftByAgent[];
  auto_tick?: { ran?: boolean; last_run_at?: string | null } | null;
}

interface DriftSnapshot {
  metric: string;
  agent_id?: string;
  mean: number | string;
  stddev: number | string;
  sample_count: number;
  period_start: string;
}

interface MetricCatalogItem {
  id: string;
  label: string;
}

interface RunResult {
  tone: 'success' | 'info' | 'error';
  message: string;
}

const TABS = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'baselines', label: 'Coverage' },
  { id: 'trends', label: 'Trends' },
];

interface SeverityConf {
  icon: LucideIcon;
  color: string;
  bg: string;
  variant: string;
}

const SEVERITY_INFO: SeverityConf = { icon: Info, color: 'text-info', bg: 'bg-info-subtle border-blue-500/30', variant: 'info' };

const SEVERITY_CONFIG: Record<string, SeverityConf> = {
  critical: { icon: AlertTriangle, color: 'text-error', bg: 'bg-error-subtle border-error/30', variant: 'error' },
  warning: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning-subtle border-warning/30', variant: 'warning' },
  info: SEVERITY_INFO,
};

const DIRECTION_ICON: Record<string, LucideIcon> = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  unknown: Minus,
};

function ZScoreBar({ zScore }: { zScore: number }) {
  const absZ = Math.abs(zScore);
  // ±999 is the zero-variance sentinel (baseline stddev 0), not a statistic —
  // rendering it as a maxed bar with "z 999" was dishonest.
  if (absZ >= 999) {
    return <span className="text-[11px] text-tertiary">no baseline variance</span>;
  }
  const maxZ = 5;
  const pct = Math.min((absZ / maxZ) * 100, 100);
  const color = absZ >= 3 ? 'bg-status-error' : absZ >= 2 ? 'bg-status-warning' : 'bg-status-info';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 tabular-nums text-[11px] text-tertiary">
        {zScore > 0 ? '+' : ''}{zScore}
      </span>
    </div>
  );
}

// Inline-SVG sparkline, token-driven via currentColor (pattern from
// app/posture/page.tsx) — scaled to the data range since drift metrics have
// arbitrary units.
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const w = 120, h = 32, pad = 2;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]![0].toFixed(1)},${h - pad} L${coords[0]![0].toFixed(1)},${h - pad} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true" role="img">
      <path d={area} fill="currentColor" opacity={0.1} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// The baseline's stored 10-bucket histogram (computed since the schema
// shipped, rendered for the first time here).
function DistributionStrip({ distribution }: { distribution?: unknown }) {
  let parsed: Record<string, number> | null = null;
  try {
    parsed = typeof distribution === 'string'
      ? JSON.parse(distribution)
      : (distribution as Record<string, number> | null);
  } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, c]) => Number(c) || 0), 1);
  return (
    <div className="flex h-8 items-end gap-px" role="img" aria-label="Baseline sample distribution">
      {entries.map(([bucket, count]) => (
        <div
          key={bucket}
          title={`${bucket}: ${count} sample${Number(count) === 1 ? '' : 's'}`}
          className="w-2 rounded-sm bg-brand/40"
          style={{ height: `${Math.max(8, (Number(count) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default function DriftPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('alerts');

  const [alerts, setAlerts] = useState<DriftAlert[]>([]);
  const [stats, setStats] = useState<DriftStats | null>(null);
  const [snapshots, setSnapshots] = useState<DriftSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  // Outcome of the last "Run detection" so the button is never a silent no-op.
  const [runResult, setRunResult] = useState<RunResult | null>(null); // { tone: 'success'|'info'|'error', message }
  const [refreshError, setRefreshError] = useState(false);
  // Ack/delete failures (e.g. 403 for members) — previously silent no-ops.
  const [actionError, setActionError] = useState<string | null>(null);
  // Per-alert evidence disclosure.
  const [expandedAlerts, setExpandedAlerts] = useState<Record<string, boolean>>({});

  // Alert filters (backend supports severity / acknowledged / metric).
  const [severity, setSeverity] = useState('all');
  const [ackFilter, setAckFilter] = useState('all');
  const [metricFilter, setMetricFilter] = useState('all');
  const [metricCatalog, setMetricCatalog] = useState<MetricCatalogItem[]>([]);
  const filtersActive = severity !== 'all' || ackFilter !== 'all' || metricFilter !== 'all';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setRefreshError(false);
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 800));
        setAlerts(demoDriftAlerts as DriftAlert[]);
        setStats(demoDriftStats as DriftStats);
        setSnapshots(demoDriftSnapshots as DriftSnapshot[]);
        setLoading(false);
        return;
      }

      const params = agentId ? `?agent_id=${agentId}` : '';
      const alertParams = new URLSearchParams();
      if (agentId) alertParams.set('agent_id', agentId);
      alertParams.set('limit', '50');
      if (severity !== 'all') alertParams.set('severity', severity);
      if (ackFilter !== 'all') alertParams.set('acknowledged', ackFilter === 'ack' ? 'true' : 'false');
      if (metricFilter !== 'all') alertParams.set('metric', metricFilter);
      const [alertsRes, statsRes, snapshotsRes] = await Promise.all([
        fetch(`/api/drift/alerts?${alertParams}`),
        fetch(`/api/drift/stats${params}`),
        fetch(`/api/drift/snapshots${params}${params ? '&' : '?'}limit=30`),
      ]);
      // Clear the slice on failure (don't leave the prior filter's/agent's data showing under
      // the new filter) and flag the error so it isn't a silent swallow.
      let failed = false;
      if (alertsRes.ok) { const d = await alertsRes.json(); setAlerts(d.alerts || []); } else { setAlerts([]); failed = true; }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); } else { setStats(null); failed = true; }
      if (snapshotsRes.ok) { const d = await snapshotsRes.json(); setSnapshots(d.snapshots || []); } else { setSnapshots([]); failed = true; }
      setRefreshError(failed);
    } catch (err) {
      console.error('Failed to fetch drift data:', err);
      setRefreshError(true);
    } finally {
      setLoading(false);
    }
  }, [agentId, severity, ackFilter, metricFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Populate the metric filter from the trackable-metric catalog (orphan route).
  useEffect(() => {
    if (isDemo) return;
    fetch('/api/drift/metrics')
      .then((r) => {
        if (!r.ok) {
          console.warn('Failed to load drift metric catalog (endpoint=/api/drift/metrics): status', r.status);
          return null;
        }
        return r.json();
      })
      .then((d) => { if (d?.metrics) setMetricCatalog(d.metrics); })
      .catch((err) => { console.warn('Failed to load drift metric catalog (endpoint=/api/drift/metrics):', err); });
  }, [isDemo]);

  const handleRunDetection = async () => {
    setRunning(true);
    setRunResult(null);
    // Run the three phases in order, checking each response. Previously these
    // POSTs were fired without reading res.ok or the body, so a 403 (admin
    // required), a 500, and a clean run that found nothing were all
    // indistinguishable — the button just spun and the page looked unchanged.
    const post = async (action: string) => {
      const res = await fetch('/api/drift/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `Drift ${action} failed (${res.status})`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return data;
    };
    try {
      const baselines = await post('compute_baselines');
      const detection = await post('detect');
      await post('record_snapshots');

      const nBaselines = baselines.baselines_computed ?? 0;
      const nAlerts = detection.alerts_generated ?? 0;
      if (nBaselines === 0) {
        setRunResult({
          tone: 'info',
          message: 'Detection ran, but there is not enough recorded activity yet to baseline. Drift needs at least 5 recorded actions per agent over the last 30 days before it can compare behavior.',
        });
      } else if (nAlerts === 0) {
        setRunResult({
          tone: 'success',
          message: `Detection ran across ${nBaselines} baseline${nBaselines === 1 ? '' : 's'} — no significant drift detected. Behavior is within normal range.`,
        });
      } else {
        setRunResult({
          tone: 'success',
          message: `Detection complete: ${nAlerts} drift alert${nAlerts === 1 ? '' : 's'} generated from ${nBaselines} baseline${nBaselines === 1 ? '' : 's'}.`,
        });
      }
      fetchData();
    } catch (err) {
      const e = err as Error & { status?: number };
      setRunResult({
        tone: 'error',
        message: e.status === 403
          ? 'Running drift detection requires an admin role on this workspace.'
          : (e.message || 'Drift detection failed.'),
      });
    } finally {
      setRunning(false);
    }
  };

  // Both mutations are admin-gated server-side. Read res.ok and surface the
  // failure — a member clicking these used to see nothing happen at all.
  const alertMutation = async (id: string, method: 'PATCH' | 'DELETE', verb: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/drift/alerts/${id}`, { method });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(res.status === 403
          ? `${verb} requires an admin role on this workspace.`
          : (data.error || `Failed to ${verb.toLowerCase()} alert (${res.status}).`));
        return;
      }
      fetchData();
    } catch {
      setActionError(`Failed to ${verb.toLowerCase()} alert.`);
    }
  };

  const handleAcknowledge = (id: string) => alertMutation(id, 'PATCH', 'Acknowledging an alert');
  const handleDelete = (id: string) => {
    if (!confirm('Delete this alert?')) return;
    alertMutation(id, 'DELETE', 'Deleting an alert');
  };

  const toggleAlertEvidence = (id: string) => {
    setExpandedAlerts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <PageLayout title="Drift detection" subtitle="Statistical behavioral drift analysis">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};
  const baselineCount = stats?.recent_baselines?.length || 0;
  const selectClass = 'rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';

  return (
    <PageLayout
      title="Drift detection"
      subtitle="Statistical behavioral drift analysis"
      breadcrumbs={['Operations', 'Drift detection']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunDetection}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
          >
            {running ? <RefreshCw size={14} className="motion-safe:animate-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {running ? 'Running…' : 'Run detection'}
          </button>
          <button
            onClick={fetchData}
            aria-label="Refresh"
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {refreshError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-subtle px-4 py-2.5 text-xs text-error">
            <span>Couldn&apos;t load the latest drift data — results may be incomplete.</span>
            <button onClick={fetchData} className="rounded-md border border-error/30 px-2.5 py-1 font-medium transition-colors hover:bg-error/10">Retry</button>
          </div>
        )}
        {/* Instrument rail */}
        <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary md:grid-cols-5">
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total alerts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{overall.total_alerts || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Critical</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-error">{overall.critical_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Warning</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-warning">{overall.warning_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Info</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-info">{overall.info_count || 0}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Unacknowledged</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${parseInt(String(overall.unacknowledged)) > 0 ? 'text-warning' : 'text-secondary'}`}>
              {overall.unacknowledged || 0}
            </div>
          </div>
        </div>

        {/* Provenance — proves the surface is alive without operator clicks */}
        {stats?.auto_tick?.last_run_at && (
          <p className="text-[11px] text-tertiary">
            Last detection: {new Date(stats.auto_tick.last_run_at).toLocaleString()} · runs automatically
            when this dashboard is visited (at most once per day) · &ldquo;Run detection&rdquo; forces a re-check now.
          </p>
        )}

        {actionError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-subtle px-4 py-2.5 text-xs text-error">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} aria-label="Dismiss" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">
              <XCircle size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Run-detection result — turns the button from a silent no-op into feedback */}
        {runResult && (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
              runResult.tone === 'error'
                ? 'border-error/30 bg-error-subtle text-error'
                : runResult.tone === 'info'
                  ? 'border-info/30 bg-info-subtle text-info'
                  : 'border-success/30 bg-success-subtle text-success'
            }`}
          >
            <div className="flex items-start gap-2">
              {runResult.tone === 'error'
                ? <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                : runResult.tone === 'info'
                  ? <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  : <CheckCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{runResult.message}</span>
            </div>
            <button
              onClick={() => setRunResult(null)}
              aria-label="Dismiss"
              className="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
            >
              <XCircle size={16} aria-hidden="true" />
            </button>
          </div>
        )}

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

        {activeTab === 'alerts' && (
          <Card>
            <CardHeader title="Drift alerts" icon={Activity} count={alerts.length} />
            <CardContent>
              {!isDemo && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectClass} aria-label="Filter by severity">
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                  <select value={ackFilter} onChange={(e) => setAckFilter(e.target.value)} className={selectClass} aria-label="Filter by acknowledgement">
                    <option value="all">All statuses</option>
                    <option value="unack">Unacknowledged</option>
                    <option value="ack">Acknowledged</option>
                  </select>
                  <select value={metricFilter} onChange={(e) => setMetricFilter(e.target.value)} className={selectClass} aria-label="Filter by metric">
                    <option value="all">All metrics</option>
                    {metricCatalog.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  {filtersActive && (
                    <button
                      onClick={() => { setSeverity('all'); setAckFilter('all'); setMetricFilter('all'); }}
                      className="text-[11px] text-tertiary transition-colors hover:text-secondary"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {alerts.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title={filtersActive
                    ? 'No alerts match these filters'
                    : baselineCount === 0
                      ? 'No baseline data yet'
                      : 'No drift detected'}
                  description={filtersActive
                    ? 'Adjust or clear the filters to see more alerts.'
                    : baselineCount === 0
                      ? 'Drift compares recent behavior against a baseline of past activity. It needs at least 5 recorded actions per agent over the last 30 days before it can build that baseline — keep running governed actions, then click “Run detection”.'
                      : `Behavior is within normal range across ${baselineCount} baseline${baselineCount === 1 ? '' : 's'}. Click “Run detection” to re-check.`}
                />
              ) : (
                <div className="space-y-2">
                  {alerts.map(alert => {
                    const sevConf = SEVERITY_CONFIG[alert.severity] || SEVERITY_INFO;
                    const SevIcon = sevConf.icon;
                    const DirIcon = (alert.direction ? DIRECTION_ICON[alert.direction] : undefined) || Minus;
                    const isOpen = !!expandedAlerts[alert.id];
                    const hasPercentiles = alert.baseline_median !== undefined && alert.baseline_median !== null;
                    const trendPoints = snapshots
                      .filter((s) => s.agent_id === alert.agent_id && s.metric === alert.metric)
                      .slice()
                      .sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime())
                      .map((s) => Number(s.mean));
                    return (
                      <div
                        key={alert.id}
                        data-entity-type="drift"
                        data-entity-id={alert.id}
                        data-entity-status={alert.severity}
                        className={`rounded-lg border px-3 py-3 ${
                          alert.acknowledged
                            ? 'border-border bg-surface-tertiary opacity-75'
                            : sevConf.bg
                        }`}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <SevIcon size={14} className={sevConf.color} aria-hidden="true" />
                            <Badge variant={sevConf.variant} size="xs">{alert.severity}</Badge>
                            <Badge size="xs">{alert.metric}</Badge>
                            {alert.drift_type && <Badge size="xs">{alert.drift_type}</Badge>}
                            {alert.dimension && <Badge size="xs">{alert.dimension}</Badge>}
                            <span className="text-xs text-secondary">{alert.agent_id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ZScoreBar zScore={Number(alert.z_score)} />
                            <DirIcon
                              size={14}
                              className={alert.direction === 'increasing' ? 'text-error' : 'text-info'}
                              aria-hidden="true"
                            />
                            <span className="tabular-nums text-xs text-tertiary">
                              {(alert.pct_change ?? 0) > 0 ? '+' : ''}{alert.pct_change}%
                            </span>
                            {!alert.acknowledged && (
                              <button
                                onClick={() => handleAcknowledge(alert.id)}
                                className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-success"
                                aria-label={`Acknowledge ${alert.metric} alert`}
                              >
                                <CheckCircle size={14} />
                              </button>
                            )}
                            {alert.acknowledged && <Badge variant="success" size="xs">ack</Badge>}
                            <button
                              onClick={() => handleDelete(alert.id)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                              aria-label={`Delete ${alert.metric} alert`}
                            >
                              <XCircle size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-secondary">{alert.description}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] tabular-nums text-tertiary">
                          <span>Baseline: {alert.baseline_mean} ± {alert.baseline_stddev}</span>
                          <span>Current: {alert.current_mean} ± {alert.current_stddev}</span>
                          <span>Samples: {alert.sample_count}</span>
                          {alert.acknowledged && alert.acknowledged_by && (
                            <span>
                              Ack&apos;d by {alert.acknowledged_by}
                              {alert.acknowledged_at ? ` · ${new Date(alert.acknowledged_at).toLocaleString()}` : ''}
                            </span>
                          )}
                          {(hasPercentiles || trendPoints.length >= 2) && (
                            <button
                              onClick={() => toggleAlertEvidence(alert.id)}
                              aria-expanded={isOpen}
                              className="font-medium text-brand transition-colors hover:text-brand-hover"
                            >
                              {isOpen ? 'Hide evidence' : 'Evidence'}
                            </button>
                          )}
                          <span className="ml-auto">{new Date(alert.created_at).toLocaleDateString()}</span>
                        </div>
                        {isOpen && (
                          <div className="mt-3 grid gap-4 rounded-lg border border-border bg-surface-secondary p-3 sm:grid-cols-3">
                            {hasPercentiles && (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  Baseline percentiles
                                </div>
                                <table className="mt-1.5 w-full text-[11px] tabular-nums">
                                  <tbody>
                                    {([
                                      ['p5', alert.baseline_p5],
                                      ['p25', alert.baseline_p25],
                                      ['median', alert.baseline_median],
                                      ['p75', alert.baseline_p75],
                                      ['p95', alert.baseline_p95],
                                    ] as const).map(([label, v]) => (
                                      <tr key={label}>
                                        <td className="py-0.5 pr-3 text-tertiary">{label}</td>
                                        <td className="py-0.5 text-right text-secondary">{Number(v).toFixed(2)}</td>
                                      </tr>
                                    ))}
                                    <tr>
                                      <td className="py-0.5 pr-3 font-medium text-tertiary">current mean</td>
                                      <td className={`py-0.5 text-right font-medium ${sevConf.color}`}>{Number(alert.current_mean).toFixed(2)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {alert.baseline_distribution != null && (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  Baseline distribution
                                </div>
                                <div className="mt-2">
                                  <DistributionStrip distribution={alert.baseline_distribution} />
                                </div>
                                {alert.baseline_sample_count != null && (
                                  <div className="mt-1 text-[11px] tabular-nums text-tertiary">
                                    {alert.baseline_sample_count} baseline samples · range {Number(alert.baseline_min).toFixed(2)}–{Number(alert.baseline_max).toFixed(2)}
                                  </div>
                                )}
                              </div>
                            )}
                            {trendPoints.length >= 2 && (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  Daily mean trend
                                </div>
                                <Sparkline points={trendPoints} className={`mt-2 ${sevConf.color}`} />
                              </div>
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
        )}

        {activeTab === 'baselines' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {stats?.recent_baselines && stats.recent_baselines.length > 0 ? (
              <>
                <Card>
                  <CardHeader title="Baseline coverage" icon={BarChart3} count={stats.recent_baselines.length} />
                  <CardContent>
                    <p className="mb-3 text-xs text-tertiary">
                      Which agent × metric pairs have a baseline to compare against. A pair
                      missing here cannot drift-alert yet — it needs 5+ recorded actions
                      over 30 days.
                    </p>
                    <div className="space-y-2">
                      {stats.recent_baselines.map((b, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-secondary">{b.agent_id}</span>
                            <Badge size="xs">{b.metric}</Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs tabular-nums">
                            <span className="text-secondary">mean: {Number(b.mean).toFixed(2)}</span>
                            <span className="text-tertiary">std: {Number(b.stddev).toFixed(2)}</span>
                            <span className="text-tertiary">{b.sample_count} samples</span>
                            {b.created_at && (
                              <span className="text-tertiary">computed {new Date(b.created_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {stats?.by_metric && stats.by_metric.length > 0 && (
                  <Card>
                    <CardHeader title="Alerts by metric" />
                    <CardContent>
                      <div className="space-y-2">
                        {stats.by_metric.map(m => (
                          <div key={m.metric} className="flex items-center justify-between py-1.5">
                            <span className="text-sm text-secondary">{m.metric}</span>
                            <div className="flex items-center gap-3 text-xs tabular-nums">
                              <span className="text-tertiary">{m.count} alerts</span>
                              <span className="text-secondary">avg |z|: {m.avg_z_score}</span>
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
                  <EmptyState icon={BarChart3} title="No baselines computed" description="Click 'Run detection' to compute statistical baselines from your agent data." />
                </CardContent>
              </Card>
            )}

            {stats?.by_agent && stats.by_agent.length > 0 && (
              <Card>
                <CardHeader title="Alerts by agent" />
                <CardContent>
                  <div className="space-y-2">
                    {stats.by_agent.map(a => (
                      <div key={a.agent_id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-secondary">{a.agent_id}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-tertiary">{a.count} alerts</span>
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
            <CardHeader title="Daily mean trends" icon={TrendingUp} count={snapshots.length} />
            <CardContent>
              {snapshots.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No snapshot data" description="Daily snapshots accumulate automatically (detection runs on dashboard visits, at most once per day) and whenever you run detection manually." />
              ) : (() => {
                // Group org-wide snapshots into per-agent×metric series and chart
                // each as a sparkline — raw rows hid the actual trend shape.
                const series = new Map<string, DriftSnapshot[]>();
                for (const s of snapshots) {
                  const key = `${s.agent_id || 'unknown'}·${s.metric}`;
                  const list = series.get(key) || [];
                  list.push(s);
                  series.set(key, list);
                }
                const entries = [...series.entries()].sort((a, b) => b[1].length - a[1].length);
                return (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {entries.map(([key, rows]) => {
                      const sorted = rows.slice().sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
                      const points = sorted.map((s) => Number(s.mean));
                      const latest = sorted[sorted.length - 1]!;
                      const [agentLabel, metricLabel] = key.split('·');
                      return (
                        <div key={key} className="rounded-lg border border-border bg-surface-tertiary px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge size="xs">{metricLabel}</Badge>
                              <span className="truncate text-xs text-secondary">{agentLabel}</span>
                            </div>
                            <span className="shrink-0 tabular-nums text-[11px] text-tertiary">
                              {points.length} day{points.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="mt-2 flex items-end justify-between gap-3">
                            {points.length >= 2 ? (
                              <Sparkline points={points} className="text-info" />
                            ) : (
                              <span className="text-[11px] text-tertiary">One point so far — trends appear after the next daily snapshot.</span>
                            )}
                            <div className="text-right text-[11px] tabular-nums text-tertiary">
                              <div className="text-secondary">latest mean {Number(latest.mean).toFixed(2)}</div>
                              <div>± {Number(latest.stddev).toFixed(2)} · {latest.sample_count} samples</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
