'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ShieldAlert, AlertTriangle, Zap, Eye, RotateCw,
  ChevronRight, CircleAlert, X as XIcon, EyeOff, Undo2,
  ShieldCheck, ShieldX, Info
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { filterSignalsBySeverity } from '../lib/security-filter';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import SecurityDetailPanel from '../components/SecurityDetailPanel';
import SecurityScanners from '../components/SecurityScanners';
import SkillScanner from '../components/SkillScanner';
import { HelpIcon } from '../components/HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips.js';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { getAgentColor } from '../lib/colors';

function SecurityDashboardInner() {
  const { agentId } = useAgentFilter();
  const searchParams = useSearchParams();
  const severityParam = searchParams.get('severity');
  const [signals, setSignals] = useState<any[]>([]);
  const [highRiskActions, setHighRiskActions] = useState<any[]>([]);
  const [invalidatedAssumptions, setInvalidatedAssumptions] = useState<any[]>([]);
  const [securityStatus, setSecurityStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const securityScore = typeof securityStatus?.score === 'number' ? securityStatus.score : 0;
  const securityChecks = Array.isArray(securityStatus?.checks) ? securityStatus.checks : [];

  // Signal dismissal state
  const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('dashclaw_dismissed_signals');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showDismissed, setShowDismissed] = useState(false);

  const getSignalHash = (signal: any) =>
    `${signal.type || signal.signal_type || ''}:${signal.agent_id || ''}:${signal.action_id || ''}:${signal.loop_id || ''}:${signal.assumption_id || ''}`;

  const dismissSignal = (signal: any) => {
    const hash = getSignalHash(signal);
    setDismissedSignals(prev => {
      const next = new Set(prev);
      next.add(hash);
      localStorage.setItem('dashclaw_dismissed_signals', JSON.stringify([...next]));
      return next;
    });
  };

  const restoreSignal = (signal: any) => {
    const hash = getSignalHash(signal);
    setDismissedSignals(prev => {
      const next = new Set(prev);
      next.delete(hash);
      localStorage.setItem('dashclaw_dismissed_signals', JSON.stringify([...next]));
      return next;
    });
  };

  const dismissAllVisible = () => {
    const next = new Set(dismissedSignals);
    activeSignals.forEach(s => next.add(getSignalHash(s)));
    localStorage.setItem('dashclaw_dismissed_signals', JSON.stringify([...next]));
    setDismissedSignals(next);
  };

  // Detail panel state
  const [panelItem, setPanelItem] = useState<any>(null);
  const [panelType, setPanelType] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);

  const handleRunScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const res = await fetch('/api/security/status');
      const data = await res.json();
      setScanResults(res.ok ? data : { error: data.error || `Security check failed (${res.status})` });
      if (res.ok) fetchData();
    } catch (err) {
      console.error('Security scan failed:', err);
      setScanResults({ error: 'Network error — could not reach security status endpoint.' });
    } finally {
      setScanning(false);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = agentId ? `?agent_id=${agentId}` : '';

      const [signalsRes, actionsRes, assumptionsRes, securityRes] = await Promise.all([
        fetch(`/api/signals${params}`),
        fetch(`/api/actions?limit=100${agentId ? `&agent_id=${agentId}` : ''}`),
        fetch(`/api/actions/assumptions?drift=true${agentId ? `&agent_id=${agentId}` : ''}`),
        fetch('/api/security/status'),
      ]);

      const signalsData = await signalsRes.json();
      const actionsData = await actionsRes.json();
      const assumptionsData = await assumptionsRes.json();
      const securityData = await securityRes.json();

      setSignals(signalsData.signals || []);
      setSecurityStatus(securityData);

      // Filter for high-risk actions: risk_score >= 70 OR (no auth scope AND irreversible)
      const actions = actionsData.actions || [];
      const risky = actions.filter((a: any) => {
        const risk = parseInt(a.risk_score, 10) || 0;
        const unscoped = !a.authorization_scope;
        const irreversible = a.reversible === 0;
        return risk >= 70 || (unscoped && irreversible);
      });
      setHighRiskActions(risky);

      // Filter for invalidated assumptions in last 7 days
      const assumptions = assumptionsData.assumptions || [];
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const invalidated = assumptions.filter((a: any) => {
        if (a.invalidated !== 1) return false;
        if (!a.invalidated_at) return false;
        return (now - new Date(a.invalidated_at).getTime()) < sevenDays;
      });
      setInvalidatedAssumptions(invalidated);

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to fetch security data:', error);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const openPanel = (item: any, type: any) => {
    setPanelItem(item);
    setPanelType(type);
  };

  const closePanel = () => {
    setPanelItem(null);
    setPanelType(null);
  };

  // Narrow by the ?severity=red|amber deep-link param (default: all), then split
  // into active vs dismissed.
  const severityFilteredSignals = filterSignalsBySeverity(signals, severityParam);
  const activeSignals = severityFilteredSignals.filter(s => !dismissedSignals.has(getSignalHash(s)));
  const dismissedList = severityFilteredSignals.filter(s => dismissedSignals.has(getSignalHash(s)));

  // Stats (use active signals only)
  const totalSignals = activeSignals.length;
  const now24h = Date.now() - 24 * 60 * 60 * 1000;
  const highRisk24h = highRiskActions.filter(a => {
    const ts = new Date(a.timestamp_start).getTime();
    return ts > now24h;
  }).length;
  const unscopedCount = highRiskActions.filter(a => !a.authorization_scope).length;
  const invalidatedCount = invalidatedAssumptions.length;

  const getSeverityIcon = (severity: any) => {
    return severity === 'red' ? CircleAlert : AlertTriangle;
  };

  const getStatusIcon = (status: any) => {
    switch (status) {
      case 'ok': return ShieldCheck;
      case 'warning': return AlertTriangle;
      case 'critical': return ShieldX;
      default: return Info;
    }
  };

  const getStatusColor = (status: any) => {
    switch (status) {
      case 'ok': return 'text-success';
      case 'warning': return 'text-warning';
      case 'critical': return 'text-error';
      default: return 'text-secondary';
    }
  };

  return (
    <PageLayout
      title="Security"
      subtitle={`Decision Integrity & Risk Signals${lastUpdated ? ` -- Updated ${lastUpdated}` : ''}`}
      breadcrumbs={['Dashboard', 'Security']}
      maturity="stable"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
          >
            <ShieldAlert size={14} />
            {scanning ? 'Scanning…' : 'Run security check'}
          </button>
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <RotateCw size={14} />
            Refresh
          </button>
        </div>
      }
    >
      {/* Scan Results */}
      {scanResults && (
        <Card className="mb-6" hover={false}>
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Scan results</span>
            <button
              onClick={() => setScanResults(null)}
              className="rounded-md p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
              aria-label="Close scan results"
            >
              <XIcon size={14} />
            </button>
          </div>
          <CardContent>
            {scanResults.error ? (
              <p className="flex items-center gap-1.5 text-xs text-error">
                <ShieldX size={14} /> {scanResults.error}
              </p>
            ) : scanResults.score === 100 ? (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <ShieldCheck size={14} /> All security checks passed — score 100/100
              </p>
            ) : (
              <div className="space-y-2">
                <p className="mb-2 text-xs tabular-nums text-secondary">Score: {scanResults.score}/100</p>
                {(scanResults.checks || []).map((check: any) => {
                  const Icon = getStatusIcon(check.status);
                  return (
                    <div key={check.id} className="flex items-start gap-2 text-xs">
                      <Icon size={14} className={`mt-0.5 shrink-0 ${getStatusColor(check.status)}`} />
                      <Badge variant={check.status === 'critical' ? 'error' : check.status === 'warning' ? 'warning' : 'success'} size="xs">
                        {check.status}
                      </Badge>
                      <span className="text-secondary">{check.label}{check.detail ? ` — ${check.detail}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ad-hoc DLP + prompt-injection scanners */}
      <SecurityScanners />

      {/* Static skill safety scanner */}
      <SkillScanner />

      {/* Stats rail — Security Score + 4 inline */}
      <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface-tertiary">
        <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-5">
          {[
            {
              label: 'Score',
              value: securityScore,
              color: securityScore >= 90 ? 'text-success' : securityScore >= 70 ? 'text-warning' : 'text-error',
            },
            {
              label: 'Active Signals',
              value: totalSignals,
              color: totalSignals > 0 ? 'text-error' : 'text-white',
            },
            {
              label: 'High Risk · 24h',
              value: highRisk24h,
              color: highRisk24h > 0 ? 'text-warning' : 'text-white',
            },
            {
              label: 'Unscoped',
              value: unscopedCount,
              color: unscopedCount > 0 ? 'text-warning' : 'text-white',
            },
            {
              label: 'Invalidated · 7d',
              value: invalidatedCount,
              color: invalidatedCount > 0 ? 'text-error' : 'text-white',
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`px-5 py-4 ${i >= 2 ? 'border-t border-border md:border-t-0' : ''}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                {stat.label}
              </div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Security Checks (compact row) */}
      {securityChecks.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {securityChecks.map((check: any) => {
            const Icon = getStatusIcon(check.status);
            return (
              <div key={check.id} className="flex items-center gap-2 rounded-md border border-border bg-white/[0.02] px-3 py-1.5">
                <Icon size={14} className={`shrink-0 ${getStatusColor(check.status)}`} />
                <span className="text-xs text-secondary">{check.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Signal Feed - left */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader title={<span className="flex items-center">Risk Signals<HelpIcon sectionKey="security-signals" tip={HELP_TIPS['security-signals']} /></span>} icon={ShieldAlert} count={activeSignals.length}>
              <div className="flex items-center gap-2">
                {activeSignals.length > 0 && (
                  <button
                    onClick={dismissAllVisible}
                    className="text-[11px] text-tertiary transition-colors hover:text-secondary"
                  >
                    Clear all
                  </button>
                )}
                {dismissedList.length > 0 && (
                  <button
                    onClick={() => setShowDismissed(!showDismissed)}
                    className={`flex items-center gap-1 text-[11px] tabular-nums transition-colors ${showDismissed ? 'text-secondary' : 'text-tertiary hover:text-secondary'}`}
                  >
                    <EyeOff size={10} />
                    {dismissedList.length} dismissed
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ListSkeleton rows={5} />
              ) : activeSignals.length === 0 && !showDismissed ? (
                <EmptyState
                  icon={ShieldAlert}
                  title="No active signals"
                  description={dismissedList.length > 0 ? `${dismissedList.length} signal${dismissedList.length !== 1 ? 's' : ''} dismissed.` : 'All clear. No risk signals detected.'}
                />
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {activeSignals.map((signal, idx) => {
                    const SeverityIcon = getSeverityIcon(signal.severity);
                    return (
                      <div
                        key={`active-${idx}`}
                        data-entity-type="signal"
                        data-entity-id={signal.action_id || signal.assumption_id || signal.loop_id || `signal-${idx}`}
                        data-entity-status={signal.severity}
                        className="w-full bg-surface-tertiary rounded-lg p-3.5 text-left hover:bg-white/[0.04] transition-colors duration-150 group flex items-start justify-between gap-2"
                      >
                        <button
                          onClick={() => openPanel(signal, 'signal')}
                          className="flex items-start gap-2.5 min-w-0 flex-1 text-left"
                        >
                          <SeverityIcon
                            size={16}
                            className={`mt-0.5 shrink-0 ${signal.severity === 'red' ? 'text-error' : 'text-warning'}`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm text-white truncate">{signal.label}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={signal.severity === 'red' ? 'error' : 'warning'} size="xs">
                                {signal.severity}
                              </Badge>
                              {signal.agent_id && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${getAgentColor(signal.agent_id)}`}>
                                  {signal.agent_id}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); dismissSignal(signal); }}
                            className="p-1 text-tertiary hover:text-secondary transition-colors"
                            title="Dismiss signal"
                          >
                            <XIcon size={14} />
                          </button>
                          <ChevronRight size={14} className="text-tertiary group-hover:text-secondary" />
                        </div>
                      </div>
                    );
                  })}

                  {/* Dismissed signals section */}
                  {showDismissed && dismissedList.length > 0 && (
                    <>
                      <div className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Dismissed</div>
                      {dismissedList.map((signal, idx) => {
                        const SeverityIcon = getSeverityIcon(signal.severity);
                        return (
                          <div
                            key={`dismissed-${idx}`}
                            className="w-full bg-surface-tertiary/50 rounded-lg p-3.5 text-left opacity-60 hover:opacity-80 transition-opacity flex items-start justify-between gap-2"
                          >
                            <button
                              onClick={() => openPanel(signal, 'signal')}
                              className="flex items-start gap-2.5 min-w-0 flex-1 text-left"
                            >
                              <SeverityIcon
                                size={16}
                                className={`mt-0.5 shrink-0 ${signal.severity === 'red' ? 'text-error' : 'text-warning'}`}
                              />
                              <div className="min-w-0">
                                <div className="text-sm text-secondary truncate">{signal.label}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="default" size="xs">dismissed</Badge>
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); restoreSignal(signal); }}
                              className="p-1 text-tertiary hover:text-secondary transition-colors shrink-0"
                              title="Restore signal"
                            >
                              <Undo2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* High-Risk Actions - right */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title={<span className="flex items-center">High-Risk Actions<HelpIcon sectionKey="risk-signals" tip={HELP_TIPS['risk-signals']} /></span>} icon={Zap} count={highRiskActions.length} />
            <CardContent>
              {loading ? (
                <ListSkeleton rows={5} />
              ) : highRiskActions.length === 0 ? (
                <EmptyState
                  icon={Eye}
                  title="No high-risk actions"
                  description="No actions flagged as high-risk."
                />
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {highRiskActions.map((action) => {
                    const riskScore = parseInt(action.risk_score, 10) || 0;
                    return (
                      <button
                        key={action.action_id}
                        onClick={() => openPanel(action, 'action')}
                        className="w-full bg-surface-tertiary rounded-lg p-3.5 text-left hover:bg-white/[0.04] transition-colors duration-150 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm text-white truncate">
                              {action.declared_goal?.substring(0, 60) || 'No goal'}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={riskScore >= 90 ? 'error' : riskScore >= 70 ? 'warning' : 'default'} size="xs">
                                Risk: {riskScore}
                              </Badge>
                              <Badge variant={action.status === 'running' ? 'warning' : action.status === 'failed' ? 'error' : 'default'} size="xs">
                                {action.status}
                              </Badge>
                              {action.agent_id && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${getAgentColor(action.agent_id)}`}>
                                  {action.agent_id}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-tertiary group-hover:text-secondary mt-0.5 shrink-0" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Detail Panel */}
      <SecurityDetailPanel item={panelItem} type={panelType} onClose={closePanel} onDismiss={dismissSignal} />
    </PageLayout>
  );
}

export default function SecurityDashboard() {
  return (
    <Suspense
      fallback={
        <PageLayout title="Security" subtitle="Decision Integrity & Risk Signals" breadcrumbs={['Dashboard', 'Security']} maturity="stable">
          <ListSkeleton rows={6} />
        </PageLayout>
      }
    >
      <SecurityDashboardInner />
    </Suspense>
  );
}
