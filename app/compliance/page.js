'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Scale, ChevronDown, ChevronRight, AlertTriangle,
  FileDown, Copy, Shield, AlertCircle, CheckCircle, ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { ProgressBar } from '../components/ui/ProgressBar';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { isDemoMode } from '../lib/isDemoMode';

const FRAMEWORK_LABELS = {
  'soc2': 'SOC 2',
  'iso27001': 'ISO 27001',
  'nist-ai-rmf': 'NIST AI RMF',
  'eu-ai-act': 'EU AI Act',
  'gdpr': 'GDPR',
};

const STATUS_VARIANTS = {
  covered: 'success',
  partial: 'warning',
  gap: 'error',
};

const EFFORT_VARIANTS = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const SIGNAL_CONTROL_MAP = {
  autonomy_spike: ['SOC 2 CC6.1 (Logical Access)', 'ISO 42001 A.4 (Human Oversight)'],
  high_impact_low_oversight: ['EU AI Act Art. 14 (Human Oversight)', 'SOC 2 CC6.6 (Boundary Protection)'],
  repeated_failures: ['ISO 27001 A.12.4 (Logging)', 'NIST AI RMF MAP 3 (Risk Assessment)'],
  stale_loop: ['SOC 2 CC7.2 (Anomaly Detection)', 'ISO 42001 A.6 (Lifecycle)'],
  assumption_drift: ['ISO 42001 A.5 (Data Governance)', 'NIST AI RMF MEASURE 2 (Performance)'],
  stale_assumption: ['ISO 42001 A.5 (Data Governance)', 'EU AI Act Art. 9 (Risk Management)'],
  stale_running_action: ['SOC 2 CC7.2 (Anomaly Detection)', 'ISO 27001 A.12.4 (Logging)'],
};

export default function CompliancePage() {
  const { data: session } = useSession();
  const isDemo = isDemoMode();

  // Data
  const [frameworks, setFrameworks] = useState([]);
  const [selectedFramework, setSelectedFramework] = useState(null);
  const [controlMap, setControlMap] = useState(null);
  const [gapAnalysis, setGapAnalysis] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [signals, setSignals] = useState([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI
  const [expandedControls, setExpandedControls] = useState({});
  const [reportFormat, setReportFormat] = useState('markdown');
  const [report, setReport] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);

  // Fetch frameworks list
  const fetchFrameworks = useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/frameworks');
      if (res.ok) {
        const data = await res.json();
        const fws = data.frameworks || [];
        setFrameworks(fws);
        if (fws.length > 0 && !selectedFramework) {
          setSelectedFramework(fws[0].id || fws[0]);
        }
      }
    } catch {
      setError('Failed to load frameworks');
    } finally {
      setLoading(false);
    }
  }, [selectedFramework]);

  useEffect(() => { fetchFrameworks(); }, [fetchFrameworks]);

  // Fetch framework-specific data when selection changes
  const fetchFrameworkData = useCallback(async () => {
    if (!selectedFramework) return;
    try {
      const [mapRes, gapRes, evidenceRes, signalsRes] = await Promise.all([
        fetch(`/api/compliance/map?framework=${selectedFramework}`),
        fetch(`/api/compliance/gaps?framework=${selectedFramework}`),
        fetch('/api/compliance/evidence'),
        fetch('/api/actions/signals'),
      ]);

      if (mapRes.ok) setControlMap(await mapRes.json());
      if (gapRes.ok) setGapAnalysis(await gapRes.json());
      if (evidenceRes.ok) setEvidence(await evidenceRes.json());
      if (signalsRes.ok) {
        const signalsData = await signalsRes.json();
        setSignals(signalsData.signals || []);
      }
    } catch {
      setError('Failed to load compliance data');
    } finally {
      setSignalsLoading(false);
    }
  }, [selectedFramework]);

  useEffect(() => { fetchFrameworkData(); }, [fetchFrameworkData]);

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    setReport('');
    try {
      const res = await fetch(`/api/compliance/report?framework=${selectedFramework}&format=${reportFormat}`);
      const json = await res.json();
      if (res.ok) {
        if (reportFormat === 'json') {
          try { setReport(JSON.stringify(JSON.parse(json.report), null, 2)); }
          catch { setReport(json.report); }
        } else {
          setReport(json.report);
        }
      } else {
        setError(json.error || 'Failed to generate report');
      }
    } catch {
      setError('Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleCopyReport = async () => {
    try { await navigator.clipboard.writeText(report); } catch { /* ignore */ }
  };

  const handleDownloadReport = () => {
    const ext = reportFormat === 'json' ? 'json' : 'md';
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-${selectedFramework}-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleControl = (controlId) => {
    setExpandedControls(prev => ({ ...prev, [controlId]: !prev[controlId] }));
  };

  const controls = controlMap?.controls || [];
  const coverage = controlMap?.coverage || {};
  const coveragePercent = coverage.total
    ? Math.round((coverage.covered / coverage.total) * 100)
    : 0;

  const gaps = gapAnalysis?.gaps || [];
  const remediations = gapAnalysis?.remediations || [];
  const riskLevel = gapAnalysis?.risk_level || 'unknown';

  return (
    <PageLayout
      title="Compliance"
      subtitle="Map policies to regulatory frameworks and track control coverage"
      breadcrumbs={['Compliance']}
      actions={
        <Link href="/compliance/exports" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
          <FileDown size={14} /> Exports
        </Link>
      }
    >
      {isDemo && (
        <div className="mb-4 p-3 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-zinc-300 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> Demo mode: compliance data is read-only.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">&times;</button>
        </div>
      )}

      {/* Framework Selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {loading ? (
          <div className="text-sm text-zinc-500">Loading frameworks...</div>
        ) : frameworks.length === 0 ? (
          <div className="text-sm text-zinc-500">No frameworks available</div>
        ) : (
          frameworks.map(fw => {
            const id = fw.id || fw;
            const label = FRAMEWORK_LABELS[id] || id;
            const isActive = id === selectedFramework;
            return (
              <button
                key={id}
                onClick={() => { setSelectedFramework(id); setReport(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'bg-[#1a1a1a] text-zinc-400 border border-[rgba(255,255,255,0.06)] hover:text-white hover:border-zinc-500'
                }`}
              >
                {label}
              </button>
            );
          })
        )}
      </div>

      {/* Coverage Stats */}
      {controlMap && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            <StatCompact label="Total Controls" value={coverage.total ?? 0} />
            <StatCompact label="Covered" value={coverage.covered ?? 0} color="text-green-400" />
            <StatCompact label="Partial" value={coverage.partial ?? 0} color="text-yellow-400" />
            <StatCompact label="Gaps" value={coverage.gaps ?? 0} color="text-red-400" />
            <StatCompact label="Coverage" value={`${coveragePercent}%`} color={coveragePercent >= 80 ? 'text-green-400' : coveragePercent >= 50 ? 'text-yellow-400' : 'text-red-400'} />
          </div>
          <ProgressBar value={coveragePercent} color={coveragePercent >= 80 ? 'success' : coveragePercent >= 50 ? 'warning' : 'error'} className="mb-6" />
        </>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Control Map (3/5) */}
        <div className="lg:col-span-3">
          <Card>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-sm font-medium text-white">Control Map</h2>
              {controls.length > 0 && (
                <span className="text-xs text-zinc-500">{controls.length} controls</span>
              )}
            </div>
            <CardContent>
              {!selectedFramework ? (
                <EmptyState
                  icon={Scale}
                  title="Select a framework"
                  description="Choose a compliance framework above to view its control map."
                />
              ) : !controlMap ? (
                <ListSkeleton rows={6} />
              ) : controls.length === 0 ? (
                <EmptyState
                  icon={Scale}
                  title="No controls mapped"
                  description="No controls found for this framework."
                />
              ) : (
                <div className="max-h-[600px] overflow-y-auto divide-y divide-[rgba(255,255,255,0.04)]">
                  {controls.map(control => {
                    const cid = control.control_id || control.id;
                    const isExpanded = expandedControls[cid];
                    const policies = control.matched_policies || control.policies || [];
                    const recs = control.recommendations || [];
                    return (
                      <div key={cid} className="py-2.5">
                        <button
                          onClick={() => toggleControl(cid)}
                          className="w-full flex items-center gap-2 text-left"
                        >
                          {isExpanded ? <ChevronDown size={14} className="text-zinc-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 flex-shrink-0" />}
                          <Badge variant={STATUS_VARIANTS[control.status] || 'default'} size="xs">
                            {control.status}
                          </Badge>
                          <span className="text-xs text-zinc-500 font-mono">{control.control_id || control.id}</span>
                          <span className="text-sm text-zinc-300 truncate">{control.title || control.name}</span>
                        </button>
                        {isExpanded && (
                          <div className="ml-6 mt-2 space-y-2">
                            {control.description && (
                              <p className="text-xs text-zinc-500">{control.description}</p>
                            )}
                            {policies.length > 0 && (
                              <div>
                                <span className="text-[10px] text-zinc-600 uppercase">Matched Policies</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {policies.map((p, i) => (
                                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                                      {typeof p === 'string' ? p : p.name || p.id}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {recs.length > 0 && (
                              <div>
                                <span className="text-[10px] text-zinc-600 uppercase">Recommendations</span>
                                <ul className="mt-1 space-y-1">
                                  {recs.map((r, i) => (
                                    <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                                      <AlertCircle size={12} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                                      {typeof r === 'string' ? r : r.text || r.description}
                                    </li>
                                  ))}
                                </ul>
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
        </div>

        {/* Right column (2/5) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Gap Analysis */}
          <Card>
            <div className="px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-sm font-medium text-white">Gap Analysis</h2>
            </div>
            <CardContent>
              {!gapAnalysis ? (
                <ListSkeleton rows={3} />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Risk Level:</span>
                    <Badge variant={riskLevel === 'high' ? 'error' : riskLevel === 'medium' ? 'warning' : 'success'}>
                      {riskLevel}
                    </Badge>
                  </div>
                  {gapAnalysis.narrative && (
                    <p className="text-xs text-zinc-400">{gapAnalysis.narrative}</p>
                  )}
                  {gapAnalysis.quick_wins && (
                    <div>
                      <span className="text-[10px] text-zinc-600 uppercase">Quick Wins</span>
                      <p className="text-xs text-zinc-400 mt-0.5">{gapAnalysis.quick_wins}</p>
                    </div>
                  )}
                  {gaps.length > 0 && (
                    <div>
                      <span className="text-[10px] text-zinc-600 uppercase">Critical Gaps ({gaps.length})</span>
                      <ul className="mt-1 space-y-1">
                        {gaps.slice(0, 5).map((g, i) => (
                          <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                            <AlertCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                            {typeof g === 'string' ? g : g.title || g.control || g.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {remediations.length > 0 && (
                    <div>
                      <span className="text-[10px] text-zinc-600 uppercase">Top Remediations</span>
                      <ul className="mt-1 space-y-1.5">
                        {remediations.slice(0, 5).map((r, i) => (
                          <li key={i} className="text-xs text-zinc-400 flex items-center gap-2">
                            <span className="flex-1">{typeof r === 'string' ? r : r.action || r.description}</span>
                            {r.effort && (
                              <Badge variant={EFFORT_VARIANTS[r.effort] || 'default'} size="xs">
                                {r.effort}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Enforcement Evidence */}
          <Card>
            <div className="px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-sm font-medium text-white">Enforcement Evidence</h2>
            </div>
            <CardContent>
              {!evidence ? (
                <ListSkeleton rows={3} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-white tabular-nums">{evidence.guard_decisions ?? 0}</div>
                    <div className="text-[10px] text-zinc-500">Guard Decisions</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-red-400 tabular-nums">{evidence.blocked ?? 0}</div>
                    <div className="text-[10px] text-zinc-500">Blocked</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-yellow-400 tabular-nums">{evidence.approval_requests ?? 0}</div>
                    <div className="text-[10px] text-zinc-500">Approval Requests</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-blue-400 tabular-nums">{evidence.actions_recorded ?? 0}</div>
                    <div className="text-[10px] text-zinc-500">Actions Recorded</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live Integrity Signals */}
          <Card>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-sm font-medium text-white flex items-center gap-2">
                <ShieldAlert size={14} className="text-amber-400" />
                Live Integrity Signals
              </h2>
            </div>
            <CardContent>
              {signalsLoading ? (
                <ListSkeleton rows={2} />
              ) : signals.length === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <CheckCircle size={14} className="text-green-400" />
                  <span className="text-xs text-green-400">All clear — no active integrity signals</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {signals.map((signal, i) => {
                    const controls = SIGNAL_CONTROL_MAP[signal.type] || [];
                    return (
                      <div key={i} className="py-2 border-b border-[rgba(255,255,255,0.04)] last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            signal.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'
                          }`} />
                          <span className="text-sm text-white">{signal.label || signal.type.replace(/_/g, ' ')}</span>
                        </div>
                        {controls.length > 0 && (
                          <div className="ml-4 mt-1 flex flex-wrap gap-1">
                            <span className="text-[10px] text-zinc-500">Affects:</span>
                            {controls.map((c, j) => (
                              <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Link href="/security" className="text-xs text-brand hover:text-brand/80 mt-1 inline-block">
                    View all signals →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Report Generation */}
          <Card>
            <div className="px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-sm font-medium text-white">Compliance Report</h2>
            </div>
            <CardContent>
              <div className="flex items-center gap-2 mb-3">
                <select
                  value={reportFormat}
                  onChange={(e) => setReportFormat(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand"
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
                <button
                  onClick={handleGenerateReport}
                  disabled={generatingReport || !selectedFramework}
                  className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                >
                  {generatingReport ? 'Generating...' : 'Generate'}
                </button>
              </div>
              {report && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <button onClick={handleCopyReport} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
                      <Copy size={12} /> Copy
                    </button>
                    <button onClick={handleDownloadReport} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
                      <FileDown size={12} /> Download
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-zinc-300 bg-[#111] p-4 rounded-lg border border-[rgba(255,255,255,0.06)] max-h-[500px] overflow-y-auto font-mono">
                    {report}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
