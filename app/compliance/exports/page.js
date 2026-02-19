'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileDown, Plus, Trash2, Download, RefreshCw, Clock,
  CheckCircle, XCircle, Loader2, Calendar, Shield, Eye,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { StatCompact } from '../../components/ui/Stat';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { isDemoMode } from '../../lib/isDemoMode';

const FRAMEWORKS = [
  { id: 'soc2', label: 'SOC 2' },
  { id: 'iso27001', label: 'ISO 27001' },
  { id: 'nist-ai-rmf', label: 'NIST AI RMF' },
  { id: 'eu-ai-act', label: 'EU AI Act' },
  { id: 'gdpr', label: 'GDPR' },
];

const STATUS_CONFIG = {
  completed: { icon: CheckCircle, variant: 'success', color: 'text-green-400' },
  running: { icon: Loader2, variant: 'info', color: 'text-blue-400', animate: true },
  failed: { icon: XCircle, variant: 'error', color: 'text-red-400' },
  pending: { icon: Clock, variant: 'default', color: 'text-zinc-500' },
};

const CRON_PRESETS = [
  { label: 'Weekly (Monday 9am)', value: '0 9 * * 1' },
  { label: 'Bi-weekly (1st & 15th)', value: '0 9 1,15 * *' },
  { label: 'Monthly (1st)', value: '0 9 1 * *' },
  { label: 'Quarterly (Jan/Apr/Jul/Oct 1st)', value: '0 9 1 1,4,7,10 *' },
];

function formatBytes(bytes) {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ComplianceExportsPage() {
  const isDemo = isDemoMode();

  const [exports, setExports] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create export form
  const [showCreate, setShowCreate] = useState(false);
  const [newExport, setNewExport] = useState({
    name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30,
    include_evidence: true, include_remediation: true, include_trends: false,
  });

  // Create schedule form
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    name: '', frameworks: ['soc2'], format: 'markdown', window_days: 30,
    cron_expression: '0 9 * * 1', include_evidence: true, include_remediation: true,
  });

  // Expanded export for viewing report
  const [expandedExport, setExpandedExport] = useState(null);
  const [expandedContent, setExpandedContent] = useState('');

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

  const handleDeleteExport = async (id) => {
    if (!confirm('Delete this export?')) return;
    try { await fetch(`/api/compliance/exports/${id}`, { method: 'DELETE' }); fetchData(); } catch {}
  };

  const handleDeleteSchedule = async (id) => {
    if (!confirm('Delete this schedule?')) return;
    try { await fetch(`/api/compliance/schedules/${id}`, { method: 'DELETE' }); fetchData(); } catch {}
  };

  const handleToggleSchedule = async (id, enabled) => {
    try { await fetch(`/api/compliance/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) }); fetchData(); } catch {}
  };

  const handleViewExport = async (exp) => {
    if (expandedExport === exp.id) { setExpandedExport(null); return; }
    setExpandedExport(exp.id);
    try {
      const res = await fetch(`/api/compliance/exports/${exp.id}`);
      if (res.ok) { const d = await res.json(); setExpandedContent(d.report_content || 'No content'); }
    } catch { setExpandedContent('Failed to load report'); }
  };

  const handleDownload = (exp) => {
    const blob = new Blob([expandedContent || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(exp.name || 'export').replace(/[^a-zA-Z0-9-_]/g, '_')}.${exp.format === 'json' ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleFramework = (list, setList, fwId) => {
    setList(prev => {
      const current = prev.frameworks || [];
      const next = current.includes(fwId) ? current.filter(f => f !== fwId) : [...current, fwId];
      return { ...prev, frameworks: next };
    });
  };

  if (loading) {
    return (
      <PageLayout title="Compliance Exports" subtitle="Generate and schedule audit-ready reports">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const completedExports = exports.filter(e => e.status === 'completed').length;

  return (
    <PageLayout
      title="Compliance Exports"
      subtitle="Generate and schedule audit-ready reports"
      breadcrumbs={['Operations', 'Compliance', 'Exports']}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/compliance" className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] transition-colors">
            <Shield size={14} className="inline mr-1" /> Compliance Map
          </Link>
          <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total Exports" value={exports.length} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Completed" value={completedExports} color="text-green-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Schedules" value={schedules.length} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Snapshots" value={trends.length} />
            </CardContent>
          </Card>
        </div>

        {/* Generate export */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Export History</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowCreateSchedule(!showCreateSchedule)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.1)] text-zinc-400 text-xs font-medium hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors">
              <Calendar size={14} /> Schedule
            </button>
            <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
              <Plus size={14} /> New Export
            </button>
          </div>
        </div>

        {showCreate && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <input value={newExport.name} onChange={e => setNewExport(s => ({ ...s, name: e.target.value }))} placeholder="Export name (optional)" className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
              <div>
                <span className="text-xs text-zinc-500 mb-1 block">Frameworks:</span>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map(fw => (
                    <button key={fw.id} onClick={() => toggleFramework(newExport, setNewExport, fw.id)} className={`px-2 py-1 rounded text-xs border transition-colors ${newExport.frameworks.includes(fw.id) ? 'bg-brand/20 border-brand/50 text-white' : 'bg-[#111] border-[rgba(255,255,255,0.1)] text-zinc-500 hover:text-white'}`}>
                      {fw.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select value={newExport.format} onChange={e => setNewExport(s => ({ ...s, format: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
                <select value={newExport.window_days} onChange={e => setNewExport(s => ({ ...s, window_days: parseInt(e.target.value) }))} className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    <input type="checkbox" checked={newExport.include_evidence} onChange={e => setNewExport(s => ({ ...s, include_evidence: e.target.checked }))} className="rounded" /> Evidence
                  </label>
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    <input type="checkbox" checked={newExport.include_trends} onChange={e => setNewExport(s => ({ ...s, include_trends: e.target.checked }))} className="rounded" /> Trends
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleCreateExport} disabled={newExport.frameworks.length === 0} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Generate</button>
              </div>
            </CardContent>
          </Card>
        )}

        {showCreateSchedule && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <input value={newSchedule.name} onChange={e => setNewSchedule(s => ({ ...s, name: e.target.value }))} placeholder="Schedule name" className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
              <div>
                <span className="text-xs text-zinc-500 mb-1 block">Frameworks:</span>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map(fw => (
                    <button key={fw.id} onClick={() => toggleFramework(newSchedule, setNewSchedule, fw.id)} className={`px-2 py-1 rounded text-xs border transition-colors ${newSchedule.frameworks.includes(fw.id) ? 'bg-brand/20 border-brand/50 text-white' : 'bg-[#111] border-[rgba(255,255,255,0.1)] text-zinc-500 hover:text-white'}`}>
                      {fw.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-zinc-500 mb-1 block">Schedule:</span>
                <div className="flex flex-wrap gap-2">
                  {CRON_PRESETS.map(p => (
                    <button key={p.value} onClick={() => setNewSchedule(s => ({ ...s, cron_expression: p.value }))} className={`px-2 py-1 rounded text-xs border transition-colors ${newSchedule.cron_expression === p.value ? 'bg-brand/20 border-brand/50 text-white' : 'bg-[#111] border-[rgba(255,255,255,0.1)] text-zinc-500 hover:text-white'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreateSchedule(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleCreateSchedule} disabled={newSchedule.frameworks.length === 0} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Create Schedule</button>
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
                  const statusConf = STATUS_CONFIG[exp.status] || STATUS_CONFIG.pending;
                  const StatusIcon = statusConf.icon;
                  const fws = JSON.parse(typeof exp.frameworks === 'string' ? exp.frameworks : JSON.stringify(exp.frameworks));
                  return (
                    <div key={exp.id}>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex items-center gap-3 min-w-0">
                          <StatusIcon size={14} className={`${statusConf.color} shrink-0 ${statusConf.animate ? 'animate-spin' : ''}`} />
                          <span className="text-sm text-white font-medium truncate">{exp.name}</span>
                          {fws.map(fw => <Badge key={fw} size="xs">{fw}</Badge>)}
                          <Badge size="xs" variant={exp.format === 'json' ? 'info' : 'default'}>{exp.format}</Badge>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-zinc-500">{formatBytes(exp.file_size_bytes)}</span>
                          <span className="text-[10px] text-zinc-600">{new Date(exp.created_at).toLocaleDateString()}</span>
                          {exp.status === 'completed' && (
                            <>
                              <button onClick={() => handleViewExport(exp)} className="p-1 rounded text-zinc-500 hover:text-white transition-colors" title="View">
                                {expandedExport === exp.id ? <ChevronDown size={14} /> : <Eye size={14} />}
                              </button>
                              <button onClick={() => handleDownload(exp)} className="p-1 rounded text-zinc-500 hover:text-blue-400 transition-colors" title="Download">
                                <Download size={14} />
                              </button>
                            </>
                          )}
                          <button onClick={() => handleDeleteExport(exp.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {expandedExport === exp.id && (
                        <pre className="mt-1 mx-3 text-xs text-zinc-400 bg-[#0a0a0a] p-4 rounded-lg border border-[rgba(255,255,255,0.04)] max-h-[500px] overflow-y-auto whitespace-pre-wrap font-mono">
                          {expandedContent}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedules */}
        {schedules.length > 0 && (
          <Card>
            <CardHeader title="Scheduled Exports" icon={Calendar} count={schedules.length} />
            <CardContent>
              <div className="space-y-2">
                {schedules.map(sch => {
                  const fws = JSON.parse(typeof sch.frameworks === 'string' ? sch.frameworks : JSON.stringify(sch.frameworks));
                  return (
                    <div key={sch.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${sch.enabled ? 'bg-green-500' : 'bg-zinc-600'}`} />
                        <span className="text-sm text-white font-medium truncate">{sch.name}</span>
                        {fws.map(fw => <Badge key={fw} size="xs">{fw}</Badge>)}
                        <Badge size="xs" variant="info">{sch.cron_expression}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleToggleSchedule(sch.id, sch.enabled)} className={`px-2 py-0.5 rounded text-xs transition-colors ${sch.enabled ? 'text-green-400 hover:text-red-400' : 'text-zinc-500 hover:text-green-400'}`}>
                          {sch.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => handleDeleteSchedule(sch.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
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
            <CardHeader title="Coverage Trends" />
            <CardContent>
              <div className="space-y-2">
                {trends.slice(0, 10).map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge size="xs">{t.framework}</Badge>
                      <span className="text-xs text-zinc-400">{new Date(t.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${t.coverage_percentage >= 80 ? 'bg-green-500' : t.coverage_percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${t.coverage_percentage}%` }} />
                      </div>
                      <span className="text-xs text-zinc-300 tabular-nums w-8">{t.coverage_percentage}%</span>
                      <Badge variant={t.risk_level === 'LOW' ? 'success' : t.risk_level === 'MEDIUM' ? 'warning' : 'error'} size="xs">{t.risk_level}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
