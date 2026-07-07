'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileDown, Plus, Trash2, Download, RefreshCw, Clock,
  CheckCircle, XCircle, Loader2, Calendar, Shield, Eye,
  ChevronDown, ChevronRight, Pencil, Check, X,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/Skeleton';
import VerifyReceiptPanel from '../../components/VerifyReceiptPanel';
import MarkdownBody from '../../components/MarkdownBody';
import { FRAMEWORK_LABELS } from '../../lib/compliance/framework-labels';

// Derived from the drift-guarded label map so this list can never cite a
// framework with no definition file (the old hardcoded list shipped an EU AI
// Act entry with no JSON, so exports emitted "Framework not found. Skipping.").
const FRAMEWORKS = Object.entries(FRAMEWORK_LABELS).map(([id, label]) => ({ id, label }));

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; variant: string; color: string; animate?: boolean }> = {
  completed: { icon: CheckCircle, variant: 'success', color: 'text-success' },
  running: { icon: Loader2, variant: 'info', color: 'text-info', animate: true },
  failed: { icon: XCircle, variant: 'error', color: 'text-error' },
  pending: { icon: Clock, variant: 'default', color: 'text-tertiary' },
};

const CRON_PRESETS = [
  { label: 'Weekly (Monday 9am)', value: '0 9 * * 1' },
  { label: 'Bi-weekly (1st & 15th)', value: '0 9 1,15 * *' },
  { label: 'Monthly (1st)', value: '0 9 1 * *' },
  { label: 'Quarterly (Jan/Apr/Jul/Oct 1st)', value: '0 9 1 1,4,7,10 *' },
];

interface ExportForm {
  name: string;
  frameworks: string[];
  format: string;
  window_days: number;
  include_evidence: boolean;
  include_remediation: boolean;
  include_trends: boolean;
}

interface ScheduleForm {
  name: string;
  frameworks: string[];
  format: string;
  window_days: number;
  cron_expression: string;
  include_evidence: boolean;
  include_remediation: boolean;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ComplianceExportsPage() {
  const [exports, setExports] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create export form
  const [showCreate, setShowCreate] = useState(false);
  const [newExport, setNewExport] = useState<ExportForm>({
    name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30,
    include_evidence: true, include_remediation: true, include_trends: false,
  });

  // Create schedule form
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState<ScheduleForm>({
    name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30,
    cron_expression: '0 9 * * 1', include_evidence: true, include_remediation: true,
  });

  // Expanded export for viewing report
  const [expandedExport, setExpandedExport] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState('');

  // Inline schedule rename
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingScheduleName, setEditingScheduleName] = useState('');

  // Manual schedule run (nothing executes schedules automatically — no cron
  // on the free tier — so "Run now" is the only way a schedule produces output)
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [exportsRes, schedulesRes, trendsRes] = await Promise.all([
        fetch('/api/compliance/exports?limit=20'),
        fetch('/api/compliance/schedules'),
        fetch('/api/compliance/trends?limit=30'),
      ]);
      if (exportsRes.ok) { const d = await exportsRes.json(); setExports(d.exports || []); }
      if (schedulesRes.ok) { const d = await schedulesRes.json(); setSchedules(d.schedules || []); }
      if (trendsRes.ok) { const d = await trendsRes.json(); setTrends(d.trends || []); }
    } catch (err) {
      console.error('Failed to fetch export data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateExport = async () => {
    if (newExport.frameworks.length === 0) return;
    try {
      const res = await fetch('/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newExport,
          name: newExport.name || `Export ${new Date().toLocaleDateString()}`,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewExport({ name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30, include_evidence: true, include_remediation: true, include_trends: false });
        fetchData();
      }
    } catch { alert('Failed to create export'); }
  };

  const handleCreateSchedule = async () => {
    if (newSchedule.frameworks.length === 0 || !newSchedule.cron_expression) return;
    try {
      const res = await fetch('/api/compliance/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newSchedule,
          name: newSchedule.name || `Scheduled ${new Date().toLocaleDateString()}`,
        }),
      });
      if (res.ok) {
        setShowCreateSchedule(false);
        setNewSchedule({ name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30, cron_expression: '0 9 * * 1', include_evidence: true, include_remediation: true });
        fetchData();
      }
    } catch { alert('Failed to create schedule'); }
  };

  const handleDeleteExport = async (id: string) => {
    if (!confirm('Delete this export?')) return;
    try { await fetch(`/api/compliance/exports/${id}`, { method: 'DELETE' }); fetchData(); } catch { alert('Failed to delete export'); }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try { await fetch(`/api/compliance/schedules/${id}`, { method: 'DELETE' }); fetchData(); } catch { alert('Failed to delete schedule'); }
  };

  const handleRunScheduleNow = async (sch: any) => {
    setRunningScheduleId(sch.id);
    try {
      const fws = typeof sch.frameworks === 'string' ? JSON.parse(sch.frameworks) : sch.frameworks;
      const res = await fetch('/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${sch.name} (manual run)`,
          frameworks: fws,
          format: sch.format,
          window_days: sch.window_days,
          include_evidence: !!sch.include_evidence,
          include_remediation: !!sch.include_remediation,
          include_trends: !!sch.include_trends,
        }),
      });
      if (res.ok) fetchData();
      else alert('Failed to run export');
    } catch { alert('Failed to run export'); }
    finally { setRunningScheduleId(null); }
  };

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    try { await fetch(`/api/compliance/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) }); fetchData(); } catch { alert('Failed to toggle schedule'); }
  };

  const startRenameSchedule = (sch: any) => {
    setEditingScheduleId(sch.id);
    setEditingScheduleName(sch.name);
  };

  const handleRenameSchedule = async (id: string) => {
    const name = editingScheduleName.trim();
    if (!name) { setEditingScheduleId(null); return; }
    try {
      const res = await fetch(`/api/compliance/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSchedules(prev => prev.map(s => (s.id === id ? { ...s, ...updated } : s)));
      }
    } catch { alert('Failed to rename schedule'); }
    finally { setEditingScheduleId(null); }
  };

  const handleViewExport = async (exp: any) => {
    if (expandedExport === exp.id) { setExpandedExport(null); return; }
    setExpandedExport(exp.id);
    try {
      const res = await fetch(`/api/compliance/exports/${exp.id}`);
      if (res.ok) {
        const d = await res.json();
        // report_content is now a signed compliance bundle (JSON). Surface the
        // human-readable report inside it; fall back to the raw value for any
        // older unsigned export still stored as plain text.
        let content = d.report_content;
        try {
          const bundle = typeof content === 'string' ? JSON.parse(content) : content;
          if (bundle?.payload?.report) content = bundle.payload.report;
        } catch { /* not a bundle — render as-is */ }
        setExpandedContent(content || 'No content');
      }
    } catch { setExpandedContent('Failed to load report'); }
  };

  const handleDownload = (exp: any) => {
    window.open(`/api/compliance/exports/${exp.id}/download`, '_blank');
  };

  const toggleFramework = <T extends { frameworks?: string[] }>(
    list: T,
    setList: React.Dispatch<React.SetStateAction<T>>,
    fwId: string,
  ) => {
    setList(prev => {
      const current = prev.frameworks || [];
      const next = current.includes(fwId) ? current.filter(f => f !== fwId) : [...current, fwId];
      return { ...prev, frameworks: next };
    });
  };

  if (loading) {
    return (
      <PageLayout title="Compliance exports" subtitle="Generate and schedule audit-ready reports">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const completedExports = exports.filter(e => e.status === 'completed').length;

  const frameworkChipClass = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs transition-colors ${
      active
        ? 'border-brand/30 bg-brand/10 text-brand hover:border-brand/50 hover:bg-brand/15'
        : 'border-border bg-surface-tertiary text-secondary hover:border-border-hover hover:text-white'
    }`;

  const inputClass = 'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';

  return (
    <PageLayout
      title="Compliance exports"
      subtitle="Generate and schedule audit-ready reports"
      breadcrumbs={['Operations', 'Compliance', 'Exports']}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/compliance"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <Shield size={14} aria-hidden="true" /> Compliance map
          </Link>
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
        {/* Stats instrument rail */}
        <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary md:grid-cols-4">
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total exports</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{exports.length}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Completed</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-success">{completedExports}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Schedules</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{schedules.length}</div>
          </div>
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Snapshots</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{trends.length}</div>
          </div>
        </div>

        {/* Generate export */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Export history</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateSchedule(!showCreateSchedule)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              <Calendar size={14} aria-hidden="true" /> Schedule
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              <Plus size={14} aria-hidden="true" /> New export
            </button>
          </div>
        </div>

        {showCreate && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <label htmlFor="export-name" className="sr-only">Export name</label>
              <input
                id="export-name"
                value={newExport.name}
                onChange={e => setNewExport(s => ({ ...s, name: e.target.value }))}
                placeholder="Export name (optional)"
                className={inputClass}
              />
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Frameworks</span>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map(fw => (
                    <button
                      key={fw.id}
                      onClick={() => toggleFramework(newExport, setNewExport, fw.id)}
                      aria-pressed={newExport.frameworks.includes(fw.id)}
                      className={frameworkChipClass(newExport.frameworks.includes(fw.id))}
                    >
                      {fw.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="sr-only" htmlFor="export-format">Format</label>
                <select
                  id="export-format"
                  value={newExport.format}
                  onChange={e => setNewExport(s => ({ ...s, format: e.target.value }))}
                  className={inputClass}
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
                <label className="sr-only" htmlFor="export-window">Window</label>
                <select
                  id="export-window"
                  value={newExport.window_days}
                  onChange={e => setNewExport(s => ({ ...s, window_days: parseInt(e.target.value) }))}
                  className={inputClass}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-secondary">
                    <input
                      type="checkbox"
                      checked={newExport.include_evidence}
                      onChange={e => setNewExport(s => ({ ...s, include_evidence: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    Evidence
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-secondary">
                    <input
                      type="checkbox"
                      checked={newExport.include_trends}
                      onChange={e => setNewExport(s => ({ ...s, include_trends: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    Trends
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateExport}
                  disabled={newExport.frameworks.length === 0}
                  className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                >
                  Generate
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {showCreateSchedule && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <label htmlFor="schedule-name" className="sr-only">Schedule name</label>
              <input
                id="schedule-name"
                value={newSchedule.name}
                onChange={e => setNewSchedule(s => ({ ...s, name: e.target.value }))}
                placeholder="Schedule name"
                className={inputClass}
              />
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Frameworks</span>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map(fw => (
                    <button
                      key={fw.id}
                      onClick={() => toggleFramework(newSchedule, setNewSchedule, fw.id)}
                      aria-pressed={newSchedule.frameworks.includes(fw.id)}
                      className={frameworkChipClass(newSchedule.frameworks.includes(fw.id))}
                    >
                      {fw.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Schedule</span>
                <div className="flex flex-wrap gap-2">
                  {CRON_PRESETS.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setNewSchedule(s => ({ ...s, cron_expression: p.value }))}
                      aria-pressed={newSchedule.cron_expression === p.value}
                      className={frameworkChipClass(newSchedule.cron_expression === p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCreateSchedule(false)}
                  className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSchedule}
                  disabled={newSchedule.frameworks.length === 0}
                  className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                >
                  Create schedule
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Exports list */}
        <Card>
          <CardHeader title="Exports" icon={FileDown} count={exports.length} />
          <CardContent>
            {exports.length === 0 ? (
              <EmptyState icon={FileDown} title="No exports yet" description="Generate your first compliance export above." />
            ) : (
              <div className="space-y-2">
                {exports.map(exp => {
                  const statusConf = STATUS_CONFIG[exp.status] || STATUS_CONFIG.pending!;
                  const StatusIcon = statusConf.icon;
                  const fws = JSON.parse(typeof exp.frameworks === 'string' ? exp.frameworks : JSON.stringify(exp.frameworks));
                  const isOpen = expandedExport === exp.id;
                  return (
                    <div key={exp.id}>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <StatusIcon
                            size={14}
                            className={`${statusConf.color} shrink-0 ${statusConf.animate ? 'motion-safe:animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span className="truncate text-sm font-medium text-white">{exp.name}</span>
                          {fws.map((fw: string) => <Badge key={fw} size="xs">{fw}</Badge>)}
                          <Badge size="xs" variant={exp.format === 'json' ? 'info' : 'default'}>{exp.format}</Badge>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-xs text-tertiary">{formatBytes(exp.file_size_bytes)}</span>
                          <span className="tabular-nums text-[11px] text-tertiary">
                            {new Date(exp.created_at).toLocaleDateString()}
                          </span>
                          {exp.status === 'completed' && (
                            <>
                              <button
                                onClick={() => handleViewExport(exp)}
                                className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
                                aria-label={isOpen ? `Collapse ${exp.name}` : `View ${exp.name}`}
                                aria-expanded={isOpen}
                              >
                                {isOpen ? <ChevronDown size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                onClick={() => handleDownload(exp)}
                                className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-info"
                                aria-label={`Download ${exp.name}`}
                              >
                                <Download size={14} />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteExport(exp.id)}
                            className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                            aria-label={`Delete ${exp.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        exp.format === 'json' ? (
                          <pre className="mx-3 mt-1 max-h-[500px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-primary p-4 font-mono text-xs text-secondary">
                            {expandedContent}
                          </pre>
                        ) : (
                          <div className="mx-3 mt-1 max-h-[500px] overflow-y-auto rounded-lg border border-border bg-surface-primary p-4">
                            <MarkdownBody content={expandedContent} />
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Independent receipt/bundle verification */}
        <VerifyReceiptPanel />

        {/* Schedules */}
        {schedules.length > 0 && (
          <Card>
            <CardHeader title="Scheduled exports" icon={Calendar} count={schedules.length} />
            <CardContent>
              <p className="mb-3 text-xs text-tertiary">
                Schedules do not run automatically on this deployment (no background cron) —
                they are reminders of your export cadence. Use Run now to generate the export on demand.
              </p>
              <div className="space-y-2">
                {schedules.map(sch => {
                  const fws = JSON.parse(typeof sch.frameworks === 'string' ? sch.frameworks : JSON.stringify(sch.frameworks));
                  return (
                    <div
                      key={sch.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${sch.enabled ? 'bg-status-success' : 'bg-zinc-500'}`}
                        />
                        {editingScheduleId === sch.id ? (
                          <span className="flex items-center gap-1">
                            <label htmlFor={`rename-${sch.id}`} className="sr-only">Schedule name</label>
                            <input
                              id={`rename-${sch.id}`}
                              value={editingScheduleName}
                              onChange={e => setEditingScheduleName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameSchedule(sch.id); if (e.key === 'Escape') setEditingScheduleId(null); }}
                              autoFocus
                              className="rounded border border-border bg-surface-secondary px-2 py-0.5 text-sm text-white focus:border-brand/50 focus:outline-none"
                            />
                            <button
                              onClick={() => handleRenameSchedule(sch.id)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-success"
                              aria-label="Save"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={() => setEditingScheduleId(null)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
                              aria-label="Cancel rename"
                            >
                              <X size={13} />
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <span className="truncate text-sm font-medium text-white">{sch.name}</span>
                            <button
                              onClick={() => startRenameSchedule(sch)}
                              className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
                              aria-label={`Rename ${sch.name}`}
                            >
                              <Pencil size={12} />
                            </button>
                          </span>
                        )}
                        {fws.map((fw: string) => <Badge key={fw} size="xs">{fw}</Badge>)}
                        <Badge size="xs" variant="info">{sch.cron_expression}</Badge>
                        <Badge size="xs" variant={sch.format === 'json' ? 'info' : 'default'}>{sch.format}</Badge>
                        <Badge size="xs">{`${sch.window_days}d`}</Badge>
                        {[
                          sch.include_evidence && 'evidence',
                          sch.include_remediation && 'remediation',
                          sch.include_trends && 'trends',
                        ].filter(Boolean).map(flag => (
                          <Badge key={flag as string} size="xs" variant="default">{flag}</Badge>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => handleRunScheduleNow(sch)}
                          disabled={runningScheduleId === sch.id}
                          className="rounded border border-brand/20 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                        >
                          {runningScheduleId === sch.id ? 'Running…' : 'Run now'}
                        </button>
                        <button
                          onClick={() => handleToggleSchedule(sch.id, sch.enabled)}
                          className="rounded border border-border bg-surface-secondary px-2 py-0.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
                        >
                          {sch.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(sch.id)}
                          className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                          aria-label={`Delete ${sch.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Trends */}
        {trends.length > 0 && (
          <Card>
            <CardHeader title="Coverage trends" />
            <CardContent>
              <div className="space-y-2">
                {trends.slice(0, 10).map((t, i) => {
                  const barColor =
                    t.coverage_percentage >= 80 ? 'bg-status-success'
                    : t.coverage_percentage >= 60 ? 'bg-status-warning'
                    : 'bg-status-error';
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Badge size="xs">{t.framework}</Badge>
                        <span className="tabular-nums text-xs text-secondary">
                          {new Date(t.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${t.coverage_percentage}%` }} />
                        </div>
                        <span className="w-8 tabular-nums text-xs text-secondary">{t.coverage_percentage}%</span>
                        <Badge variant={t.risk_level === 'LOW' ? 'success' : t.risk_level === 'MEDIUM' ? 'warning' : 'error'} size="xs">
                          {t.risk_level}
                        </Badge>
                      </div>
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
