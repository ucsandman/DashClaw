'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Scale, ChevronDown, ChevronRight, AlertTriangle,
  FileDown, Copy, Shield, AlertCircle, CheckCircle, ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { HelpIcon } from '../components/HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';
import { isDemoMode } from '../lib/isDemoMode';
import { gapToPolicyDraft } from '../lib/compliance/gap-to-policy';
import MarkdownBody from '../messages/_components/MarkdownBody';

const FRAMEWORK_LABELS: Record<string, string> = {
  'soc2': 'SOC 2',
  'iso27001': 'ISO 27001',
  'nist-ai-rmf': 'NIST AI RMF',
  'eu-ai-act': 'EU AI Act',
  'gdpr': 'GDPR',
  'imda-agentic': 'IMDA Agentic AI',
};

const STATUS_VARIANTS: Record<string, string> = {
  covered: 'success',
  partial: 'warning',
  gap: 'error',
};

const EFFORT_VARIANTS: Record<string, string> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const SIGNAL_CONTROL_MAP: Record<string, string[]> = {
  autonomy_spike: ['SOC 2 CC6.1 (Logical Access)', 'ISO 42001 A.4 (Human Oversight)'],
  high_impact_low_oversight: ['EU AI Act Art. 14 (Human Oversight)', 'SOC 2 CC6.6 (Boundary Protection)'],
  repeated_failures: ['ISO 27001 A.12.4 (Logging)', 'NIST AI RMF MAP 3 (Risk Assessment)'],
  stale_loop: ['SOC 2 CC7.2 (Anomaly Detection)', 'ISO 42001 A.6 (Lifecycle)'],
  assumption_drift: ['ISO 42001 A.5 (Data Governance)', 'NIST AI RMF MEASURE 2 (Performance)'],
  stale_assumption: ['ISO 42001 A.5 (Data Governance)', 'EU AI Act Art. 9 (Risk Management)'],
  stale_running_action: ['SOC 2 CC7.2 (Anomaly Detection)', 'ISO 27001 A.12.4 (Logging)'],
};

export default function CompliancePage() {
  const isDemo = isDemoMode();

  // Data
  const [frameworks, setFrameworks] = useState<any[]>([]);
  const [selectedFramework, setSelectedFramework] = useState<string | null>(null);
  const [controlMap, setControlMap] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI
  const [expandedControls, setExpandedControls] = useState<Record<string, boolean>>({});
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
        fetch('/api/signals'),
      ]);

      if (mapRes.ok) setControlMap(await mapRes.json());
      if (gapRes.ok) setGapAnalysis(await gapRes.json());
      if (evidenceRes.ok) { const evData = await evidenceRes.json(); setEvidence(evData.evidence); }
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

  const toggleControl = (controlId: string) => {
    setExpandedControls(prev => ({ ...prev, [controlId]: !prev[controlId] }));
  };

  const controls = controlMap?.controls || [];
  // The /api/compliance/map route returns `summary` (total_controls, covered,
  // partial, gaps, coverage_percentage), not a `coverage` object. Read that.
  const summary = controlMap?.summary || {};
  const coveragePercent = Number.isFinite(summary.coverage_percentage)
    ? summary.coverage_percentage
    : (summary.total_controls
      ? Math.round((summary.covered / summary.total_controls) * 100)
      : 0);

  // The /api/compliance/gaps route returns remediation_plan[] (each item carries
  // status, control_id, title, recommendations, estimated_effort), risk_assessment
  // (overall_risk UPPERCASE, narrative, immediate_actions), and quick_wins as an array.
  const remediationPlan = gapAnalysis?.remediation_plan || [];
  const gaps = remediationPlan.filter((r: any) => r.status === 'gap');
  const remediations = remediationPlan;
  const quickWins = Array.isArray(gapAnalysis?.quick_wins) ? gapAnalysis.quick_wins : [];
  const riskLevel = gapAnalysis?.risk_assessment?.overall_risk || 'unknown';
  const riskLower = String(riskLevel).toLowerCase();
  const riskVariant =
    riskLower === 'high' || riskLower === 'critical' ? 'error'
    : riskLower === 'medium' ? 'warning'
    : riskLower === 'low' ? 'success'
    : 'default';
  const narrative = gapAnalysis?.risk_assessment?.narrative;

  const coverageTextColor =
    coveragePercent >= 80 ? 'text-success'
    : coveragePercent >= 50 ? 'text-warning'
    : 'text-error';
  const coverageBarColor =
    coveragePercent >= 80 ? 'success'
    : coveragePercent >= 50 ? 'warning'
    : 'error';

  return (
    <PageLayout
      title="Compliance"
      subtitle="Map policies to regulatory frameworks and track control coverage"
      breadcrumbs={['Compliance']}
      actions={
        <Link
          href="/compliance/exports"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <FileDown size={14} aria-hidden="true" /> Exports
        </Link>
      }
    >
      {isDemo && (
        <div role="note" className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3 text-sm text-secondary">
          <AlertTriangle size={14} aria-hidden="true" className="text-warning" />
          Demo mode · compliance data is read-only.
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">
          <AlertTriangle size={14} aria-hidden="true" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto rounded px-2 py-0.5 text-error transition-colors hover:bg-error-subtle hover:text-error"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Framework Selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        {loading ? (
          <div className="text-sm text-tertiary">Loading frameworks…</div>
        ) : frameworks.length === 0 ? (
          <div className="text-sm text-tertiary">No frameworks available</div>
        ) : (
          frameworks.map(fw => {
            const id = fw.id || fw;
            const label = FRAMEWORK_LABELS[id] || id;
            const isActive = id === selectedFramework;
            return (
              <button
                key={id}
                onClick={() => { setSelectedFramework(id); setReport(''); }}
                aria-pressed={isActive}
                className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand/30 bg-brand/10 text-brand hover:border-brand/50 hover:bg-brand/15'
                    : 'border-border bg-surface-tertiary text-secondary hover:border-border-hover hover:text-white'
                }`}
              >
                {label}
              </button>
            );
          })
        )}
      </div>

      {/* Coverage instrument rail */}
      {controlMap && (
        <div className="mb-6">
          <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary sm:grid-cols-5">
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total controls</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{summary.total_controls ?? 0}</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Covered</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-success">{summary.covered ?? 0}</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Partial</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-warning">{summary.partial ?? 0}</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Gaps</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-error">{summary.gaps ?? 0}</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Coverage</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${coverageTextColor}`}>{coveragePercent}%</div>
            </div>
          </div>
          <ProgressBar value={coveragePercent} color={coverageBarColor} className="mt-3" />
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Control Map (3/5) */}
        <div className="lg:col-span-3">
          <Card>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center text-sm font-semibold text-white">
                Control map
                <HelpIcon sectionKey="compliance" tip={HELP_TIPS['compliance']} />
              </h2>
              {controls.length > 0 && (
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] tabular-nums text-tertiary">
                  {controls.length} controls
                </span>
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
                <div className="max-h-[600px] divide-y divide-border overflow-y-auto">
                  {controls.map((control: any) => {
                    const cid = control.control_id || control.id;
                    const isExpanded = expandedControls[cid];
                    const policies = control.matched_policies || control.policies || [];
                    const recs = control.gap_recommendations || control.recommendations || [];
                    return (
                      <div key={cid} className="py-2.5">
                        <button
                          onClick={() => toggleControl(cid)}
                          aria-expanded={isExpanded}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          {isExpanded
                            ? <ChevronDown size={14} className="shrink-0 text-tertiary" aria-hidden="true" />
                            : <ChevronRight size={14} className="shrink-0 text-tertiary" aria-hidden="true" />}
                          <Badge variant={STATUS_VARIANTS[control.status] || 'default'} size="xs">
                            {control.status}
                          </Badge>
                          <span className="font-mono text-xs text-tertiary">{control.control_id || control.id}</span>
                          <span className="truncate text-sm text-secondary">{control.title || control.name}</span>
                        </button>
                        {isExpanded && (
                          <div className="ml-6 mt-2 space-y-3">
                            {control.description && (
                              <p className="text-xs text-secondary">{control.description}</p>
                            )}
                            {policies.length > 0 && (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  Matched policies
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {policies.map((p: any, i: number) => (
                                    <span
                                      key={i}
                                      className="rounded border border-success/30 bg-success-subtle px-1.5 py-0.5 text-[10px] text-success"
                                    >
                                      {typeof p === 'string' ? p : p.name || p.id}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {recs.length > 0 && (
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  Recommendations
                                </div>
                                <ul className="mt-1 space-y-1">
                                  {recs.map((r: any, i: number) => (
                                    <li key={i} className="flex items-start gap-1.5 text-xs text-secondary">
                                      <AlertCircle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                                      {typeof r === 'string' ? r : r.text || r.description}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {control.status === 'gap' && (() => {
                              const draft = gapToPolicyDraft(control);
                              if (!draft) return null;
                              const prefill = encodeURIComponent(JSON.stringify(draft));
                              return (
                                <Link
                                  href={`/policies?prefill=${prefill}`}
                                  className="inline-flex items-center gap-1.5 text-xs text-brand transition-colors hover:text-brand-hover"
                                >
                                  <Shield size={12} aria-hidden="true" /> Create policy from this gap
                                </Link>
                              );
                            })()}
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
        <div className="space-y-6 lg:col-span-2">
          {/* Gap Analysis */}
          <Card>
            <div className="border-b border-border px-5 py-3">
              <h2 className="flex items-center text-sm font-semibold text-white">
                Gap analysis
                <HelpIcon sectionKey="compliance" tip={HELP_TIPS['compliance']} />
              </h2>
            </div>
            <CardContent>
              {!gapAnalysis ? (
                <ListSkeleton rows={3} />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Risk level</span>
                    <Badge variant={riskVariant}>
                      {riskLevel}
                    </Badge>
                  </div>
                  {narrative && (
                    <p className="text-xs text-secondary">{narrative}</p>
                  )}
                  {quickWins.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Quick wins</div>
                      <ul className="mt-1 space-y-1">
                        {quickWins.slice(0, 5).map((q: any, i: number) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-secondary">
                            <CheckCircle size={12} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                            {typeof q === 'string' ? q : (q.title || q.control_id)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {gaps.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                        Critical gaps <span className="tabular-nums">({gaps.length})</span>
                      </div>
                      <ul className="mt-1 space-y-1">
                        {gaps.slice(0, 5).map((g: any, i: number) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-secondary">
                            <AlertCircle size={12} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
                            {typeof g === 'string' ? g : g.title || g.control_id || g.control || g.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {remediations.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Top remediations</div>
                      <ul className="mt-1 space-y-1.5">
                        {remediations.slice(0, 5).map((r: any, i: number) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-secondary">
                            <span className="flex-1">{typeof r === 'string' ? r : (r.title || r.action || r.description)}</span>
                            {(r.estimated_effort || r.effort) && (
                              <Badge variant={EFFORT_VARIANTS[r.effort] || 'default'} size="xs">
                                {r.estimated_effort || r.effort}
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
            <div className="border-b border-border px-5 py-3">
              <h2 className="flex items-center text-sm font-semibold text-white">
                Enforcement evidence
                <HelpIcon sectionKey="guard-decisions" tip={HELP_TIPS['guard-decisions']} />
              </h2>
            </div>
            <CardContent className="p-0">
              {!evidence ? (
                <div className="p-5"><ListSkeleton rows={3} /></div>
              ) : (
                <div className="grid grid-cols-2 divide-x divide-y divide-border">
                  <div className="p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Guard decisions</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-white">{evidence.guard_decisions_total ?? 0}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Blocked</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-error">{evidence.guard_decisions_blocked ?? 0}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Approval requests</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-warning">{evidence.approval_requests ?? 0}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Actions recorded</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-info">{evidence.action_records_total ?? 0}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Live Integrity Signals */}
          <Card>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldAlert size={14} className="text-warning" aria-hidden="true" />
                Live integrity signals
              </h2>
            </div>
            <CardContent>
              {signalsLoading ? (
                <ListSkeleton rows={2} />
              ) : signals.length === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <CheckCircle size={14} className="text-success" aria-hidden="true" />
                  <span className="text-xs text-success">All clear — no active integrity signals</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {signals.map((signal: any, i: number) => {
                    const affectedControls = SIGNAL_CONTROL_MAP[signal.type] || [];
                    return (
                      <div key={i} className="border-b border-border py-2 last:border-0">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${signal.severity === 'red' ? 'bg-status-error' : 'bg-status-warning'}`}
                          />
                          <span className="text-sm text-white">{signal.label || signal.type.replace(/_/g, ' ')}</span>
                        </div>
                        {affectedControls.length > 0 && (
                          <div className="ml-3.5 mt-1 flex flex-wrap items-center gap-1">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Affects</span>
                            {affectedControls.map((c, j) => (
                              <span
                                key={j}
                                className="rounded border border-border bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-secondary"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Link
                    href="/security"
                    className="mt-1 inline-block text-xs text-brand transition-colors hover:text-brand-hover"
                  >
                    View all signals →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Report Generation */}
          <Card>
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-white">Compliance report</h2>
            </div>
            <CardContent>
              <div className="mb-3 flex items-center gap-2">
                <label htmlFor="report-format" className="sr-only">Report format</label>
                <select
                  id="report-format"
                  value={reportFormat}
                  onChange={(e) => setReportFormat(e.target.value)}
                  className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
                <button
                  onClick={handleGenerateReport}
                  disabled={generatingReport || !selectedFramework}
                  className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                >
                  {generatingReport ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {report && (
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <button
                      onClick={handleCopyReport}
                      className="flex items-center gap-1 text-xs text-secondary transition-colors hover:text-white"
                    >
                      <Copy size={12} aria-hidden="true" /> Copy
                    </button>
                    <button
                      onClick={handleDownloadReport}
                      className="flex items-center gap-1 text-xs text-secondary transition-colors hover:text-white"
                    >
                      <FileDown size={12} aria-hidden="true" /> Download
                    </button>
                  </div>
                  {reportFormat === 'json' ? (
                    <pre className="max-h-[500px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-tertiary p-4 font-mono text-xs text-secondary">
                      {report}
                    </pre>
                  ) : (
                    <div className="max-h-[500px] overflow-y-auto rounded-lg border border-border bg-surface-tertiary p-4">
                      <MarkdownBody content={report} />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
