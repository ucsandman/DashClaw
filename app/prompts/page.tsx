'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileCode, Plus, ChevronRight, ChevronDown, Trash2,
  CheckCircle, Copy, Eye, RefreshCw, Play, Tag,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { isDemoMode } from '../lib/isDemoMode';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

const CATEGORIES = ['general', 'system', 'agent', 'tool', 'evaluation'];

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'runs', label: 'Usage' },
];

interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  active_version?: number;
  version_count?: number;
}

interface Version {
  id: string;
  version: number;
  content: string;
  is_active?: boolean;
  model_hint?: string;
  changelog?: string;
}

interface Run {
  id: string;
  template_name: string;
  version: number;
  agent_id?: string;
  tokens_used?: number;
  latency_ms?: number;
  created_at: string;
}

interface StatsByTemplate {
  template_name: string;
  total_runs: number;
  avg_tokens: number | string;
  avg_latency_ms: number | string;
}

interface StatsByVersion {
  template_name: string;
  version: number;
  total_runs: number;
  avg_tokens?: number | string | null;
}

interface PromptStats {
  available?: boolean;
  setup_hint?: string;
  overall?: {
    total_runs?: number;
    avg_tokens?: number | string;
    today_count?: number;
  };
  by_template?: StatsByTemplate[];
  by_version?: StatsByVersion[];
}

interface NewTemplateForm {
  name: string;
  description: string;
  category: string;
}

interface NewVersionForm {
  content: string;
  model_hint: string;
  changelog: string;
}

interface RenderPreview {
  version_id: string;
  rendered: string;
  parameters?: string[];
}

// NOTE: /prompts is deliberately NOT wired to the global agent filter:
// templates are org-level config, and the runs/stats routes have no agent
// dimension. A dead `useAgentFilter()` destructure used to imply otherwise.
export default function PromptsPage() {
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('templates');

  // Data
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Selected template for detail view
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newTemplate, setNewTemplate] = useState<NewTemplateForm>({ name: '', description: '', category: 'general' });

  // New version form
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVersion, setNewVersion] = useState<NewVersionForm>({ content: '', model_hint: '', changelog: '' });

  // Edit template header (PATCH) + runs filter
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [editForm, setEditForm] = useState<NewTemplateForm>({ name: '', description: '', category: 'general' });
  const [runsTemplateFilter, setRunsTemplateFilter] = useState('');

  // Render preview
  const [renderPreview, setRenderPreview] = useState<RenderPreview | null>(null);
  const [renderVars, setRenderVars] = useState('{}');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [templatesRes, runsRes, statsRes] = await Promise.all([
        fetch('/api/prompts/templates'),
        fetch('/api/prompts/runs?limit=30'),
        fetch('/api/prompts/stats'),
      ]);

      if (templatesRes.ok) { const d = await templatesRes.json(); setTemplates(d.templates || []); }
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.runs || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
    } catch (err) {
      console.error('Failed to fetch prompt data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Scope the runs log to a template when one is picked on the Usage tab.
  useEffect(() => {
    const qs = runsTemplateFilter ? `?limit=30&template_id=${runsTemplateFilter}` : '?limit=30';
    fetch(`/api/prompts/runs${qs}`)
      .then((r) => {
        if (!r.ok) {
          console.warn('Failed to load prompt runs (templateFilter=', runsTemplateFilter, '): status', r.status);
          return null;
        }
        return r.json();
      })
      .then((d) => { if (d) setRuns(d.runs || []); })
      .catch((err) => { console.warn('Failed to load prompt runs (templateFilter=', runsTemplateFilter, '):', err); });
  }, [runsTemplateFilter]);

  // Fetch versions for selected template
  const fetchVersions = async (templateId: string) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/prompts/templates/${templateId}/versions`);
      if (res.ok) {
        const d = await res.json();
        setVersions(d.versions || []);
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err);
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleSelectTemplate = (t: Template) => {
    if (selectedTemplate?.id === t.id) {
      setSelectedTemplate(null);
      setVersions([]);
    } else {
      setSelectedTemplate(t);
      fetchVersions(t.id);
    }
  };

  // Create template
  const handleCreate = async () => {
    if (!newTemplate.name) return;
    try {
      const res = await fetch('/api/prompts/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTemplate),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewTemplate({ name: '', description: '', category: 'general' });
        fetchData();
      }
    } catch (err) {
      alert('Failed to create template');
    }
  };

  // Delete template
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template and all its versions?')) return;
    try {
      await fetch(`/api/prompts/templates/${id}`, { method: 'DELETE' });
      if (selectedTemplate?.id === id) {
        setSelectedTemplate(null);
        setVersions([]);
      }
      fetchData();
    } catch { /* ignore */ }
  };

  const selection = useSelection<Template>(templates, (t) => t.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleBulkDelete = async () => {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selection.count} template${selection.count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const { ok } = await bulkAction(selection.selectedIds, (id) => fetch(`/api/prompts/templates/${id}`, { method: 'DELETE' }));
    if (selectedTemplate && ok.includes(selectedTemplate.id)) {
      setSelectedTemplate(null);
      setVersions([]);
    }
    fetchData();
    selection.clear();
  };

  const BULK_ACTIONS = [
    { id: 'delete', label: 'Delete', icon: Trash2, danger: true, onClick: handleBulkDelete },
  ];

  // Edit template header (name/description/category)
  const handleEditTemplate = async () => {
    if (!selectedTemplate || !editForm.name.trim()) return;
    try {
      const res = await fetch(`/api/prompts/templates/${selectedTemplate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setSelectedTemplate((prev) => (prev ? { ...prev, ...editForm } : prev));
        setEditingTemplate(false);
        fetchData();
      } else {
        alert('Failed to update template');
      }
    } catch {
      alert('Failed to update template');
    }
  };

  // Create version
  const handleCreateVersion = async () => {
    if (!newVersion.content || !selectedTemplate) return;
    try {
      const res = await fetch(`/api/prompts/templates/${selectedTemplate.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newVersion),
      });
      if (res.ok) {
        setShowNewVersion(false);
        setNewVersion({ content: '', model_hint: '', changelog: '' });
        fetchVersions(selectedTemplate.id);
        fetchData();
      }
    } catch (err) {
      alert('Failed to create version');
    }
  };

  // Activate version
  const handleActivate = async (versionId: string) => {
    if (!selectedTemplate) return;
    try {
      await fetch(`/api/prompts/templates/${selectedTemplate.id}/versions/${versionId}`, { method: 'POST' });
      fetchVersions(selectedTemplate.id);
    } catch { /* ignore */ }
  };

  // Render preview
  const handleRender = async (versionId: string) => {
    try {
      let vars = {};
      try { vars = JSON.parse(renderVars); } catch { /* use empty */ }
      const res = await fetch('/api/prompts/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: versionId, variables: vars }),
      });
      if (res.ok) {
        const d = await res.json();
        setRenderPreview(d);
      }
    } catch (err) {
      alert('Render failed');
    }
  };

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (loading) {
    return (
      <PageLayout agentFilter={false} title="Prompts" subtitle="Manage and version prompt templates">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};
  const statsUnavailable = stats?.available === false;

  return (
    <PageLayout agentFilter={false}
      title="Prompts"
      subtitle="Manage and version prompt templates"
      breadcrumbs={['Operations', 'Prompts']}
      actions={
        <>
          <button onClick={fetchData} className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw size={16} />
          </button>
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Templates" value={templates.length || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total Runs" value={overall.total_runs || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Avg Tokens" value={overall.avg_tokens || '--'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Used Today" value={overall.today_count || 0} />
            </CardContent>
          </Card>
        </div>

        {statsUnavailable && (
          <div className="rounded-xl border border-warning/20 bg-status-warning/6 px-4 py-3 text-sm text-amber-200">
            Prompt usage analytics are not enabled in this database yet. {stats?.setup_hint || 'Run scripts/migrate-prompts.mjs.'}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/[0.06]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'text-white border-brand' : 'text-tertiary border-transparent hover:text-secondary'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Template list (left panel) */}
            <div className="lg:col-span-1 space-y-4">
              <div className="flex justify-end">
                <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
                  <Plus size={14} /> New Template
                </button>
              </div>

              {showCreate && (
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <input value={newTemplate.name} onChange={e => setNewTemplate(s => ({ ...s, name: e.target.value }))} placeholder="Template name" className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none" />
                    <input value={newTemplate.description} onChange={e => setNewTemplate(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)" className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none" />
                    <select value={newTemplate.category} onChange={e => setNewTemplate(s => ({ ...s, category: e.target.value }))} className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand/50 focus:outline-none">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-white transition-colors">Cancel</button>
                      <button onClick={handleCreate} disabled={!newTemplate.name} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Create</button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader title="Templates" icon={FileCode} count={templates.length} />
                <CardContent>
                  {templates.length === 0 ? (
                    <EmptyState icon={FileCode} title="No templates yet" description="Create a prompt template to start versioning." />
                  ) : (
                    <>
                      <div className="mb-2 flex items-center gap-2">
                        <SelectCheckbox
                          checked={selection.allSelected}
                          onToggle={() => selection.toggleAll()}
                          label="Select all"
                        />
                        <span className="text-xs text-tertiary">Select all</span>
                      </div>
                      <div className="space-y-1">
                      {templates.map(t => (
                        <div
                          key={t.id}
                          data-entity-type="prompt"
                          data-entity-id={t.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectTemplate(t)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSelectTemplate(t);
                            }
                          }}
                          className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-colors cursor-pointer focus:outline-none focus:border-brand ${selectedTemplate?.id === t.id ? 'bg-brand/10 border border-brand/30' : 'bg-surface-tertiary border border-border hover:border-border-hover'}`}
                        >
                          <SelectCheckbox
                            checked={selection.isSelected(t.id)}
                            onToggle={(e) => { e.stopPropagation(); selection.selectClick(t.id, e.shiftKey); }}
                            label={`Select ${t.name ?? t.id}`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm text-white font-medium truncate">{t.name}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge size="xs">{t.category}</Badge>
                              <span className="text-[10px] text-disabled">v{t.active_version || t.version_count || 0}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-disabled">{t.version_count || 0} ver</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} className="p-1 rounded text-disabled hover:text-error transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Version detail (right panel) */}
            <div className="lg:col-span-2 space-y-4">
              {!selectedTemplate ? (
                <Card>
                  <CardContent className="py-16">
                    <EmptyState icon={FileCode} title="Select a template" description="Choose a template from the list to view and manage its versions." />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">{selectedTemplate.name}</h2>
                      {selectedTemplate.description && <p className="text-xs text-tertiary mt-0.5">{selectedTemplate.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingTemplate((v) => !v);
                          setEditForm({ name: selectedTemplate.name, description: selectedTemplate.description || '', category: selectedTemplate.category || 'general' });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-white/[0.12] text-secondary text-xs font-medium hover:text-white transition-colors"
                      >
                        Edit
                      </button>
                      <button onClick={() => setShowNewVersion(!showNewVersion)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
                        <Plus size={14} /> New Version
                      </button>
                    </div>
                  </div>

                  {editingTemplate && (
                    <Card>
                      <CardContent className="space-y-3 pt-5">
                        <input value={editForm.name} onChange={e => setEditForm(s => ({ ...s, name: e.target.value }))} placeholder="Template name" className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none" />
                        <input value={editForm.description} onChange={e => setEditForm(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)" className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none" />
                        <select value={editForm.category} onChange={e => setEditForm(s => ({ ...s, category: e.target.value }))} className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand/50 focus:outline-none">
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingTemplate(false)} className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-white transition-colors">Cancel</button>
                          <button onClick={handleEditTemplate} disabled={!editForm.name.trim()} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Save changes</button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {showNewVersion && (
                    <Card>
                      <CardContent className="space-y-3 pt-5">
                        <textarea value={newVersion.content} onChange={e => setNewVersion(s => ({ ...s, content: e.target.value }))} placeholder="Prompt content... Use {{variable}} for template variables" rows={8} className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-white/[0.1] text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand font-mono" />
                        <div className="grid grid-cols-2 gap-3">
                          <input value={newVersion.model_hint} onChange={e => setNewVersion(s => ({ ...s, model_hint: e.target.value }))} placeholder="Model hint (e.g., gpt-4o-mini)" className="px-3 py-2 rounded-lg bg-surface-tertiary border border-white/[0.1] text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand" />
                          <input value={newVersion.changelog} onChange={e => setNewVersion(s => ({ ...s, changelog: e.target.value }))} placeholder="Changelog note" className="px-3 py-2 rounded-lg bg-surface-tertiary border border-white/[0.1] text-sm text-white placeholder:text-disabled focus:outline-none focus:border-brand" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowNewVersion(false)} className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-white transition-colors">Cancel</button>
                          <button onClick={handleCreateVersion} disabled={!newVersion.content} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Save Version</button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader title="Versions" icon={Tag} count={versions.length} />
                    <CardContent>
                      {loadingVersions ? (
                        <ListSkeleton />
                      ) : versions.length === 0 ? (
                        <EmptyState icon={Tag} title="No versions" description="Create the first version for this template." />
                      ) : (
                        <div className="space-y-3">
                          {versions.map(v => (
                            <div key={v.id} className={`rounded-lg border ${v.is_active ? 'border-green-500/30 bg-status-success/5' : 'border-white/[0.04] bg-surface-tertiary'}`}>
                              <div className="flex items-center justify-between px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-white">v{v.version}</span>
                                  {v.is_active && <Badge variant="success" size="xs">active</Badge>}
                                  {v.model_hint && <Badge size="xs">{v.model_hint}</Badge>}
                                  {v.changelog && <span className="text-xs text-tertiary truncate max-w-[200px]">{v.changelog}</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  {!v.is_active && (
                                    <button onClick={() => handleActivate(v.id)} className="p-1 rounded text-tertiary hover:text-success transition-colors" title="Activate this version">
                                      <CheckCircle size={14} />
                                    </button>
                                  )}
                                  <button onClick={() => handleCopy(v.content)} className="p-1 rounded text-tertiary hover:text-white transition-colors" title="Copy content">
                                    <Copy size={14} />
                                  </button>
                                  <button onClick={() => handleRender(v.id)} className="p-1 rounded text-tertiary hover:text-info transition-colors" title="Preview render">
                                    <Eye size={14} />
                                  </button>
                                </div>
                              </div>
                              <pre className="px-3 pb-3 text-xs text-secondary whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">{v.content}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {renderPreview && (
                    <Card>
                      <CardHeader title="Render Preview" action={
                        <button onClick={() => setRenderPreview(null)} className="text-xs text-secondary hover:text-white">Close</button>
                      } />
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-tertiary">Variables (JSON):</span>
                          <input value={renderVars} onChange={e => setRenderVars(e.target.value)} className="flex-1 px-2 py-1 rounded bg-surface-tertiary border border-white/[0.1] text-xs text-white font-mono focus:outline-none focus:border-brand" />
                          <button onClick={() => handleRender(renderPreview.version_id)} className="px-2 py-1 rounded bg-brand/20 text-brand text-xs hover:bg-brand/30 transition-colors">
                            <Play size={12} />
                          </button>
                        </div>
                        <pre className="text-xs text-secondary bg-surface-tertiary p-3 rounded-lg border border-white/[0.06] max-h-[300px] overflow-y-auto whitespace-pre-wrap font-mono">{renderPreview.rendered}</pre>
                        {renderPreview.parameters && renderPreview.parameters.length > 0 && (
                          <div className="flex gap-1">
                            <span className="text-[10px] text-disabled">Params:</span>
                            {renderPreview.parameters.map(p => <Badge key={p} size="xs">{`{{${p}}}`}</Badge>)}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'runs' && (
          <Card>
            <CardHeader title="Recent Prompt Runs" icon={Play} count={runs.length} />
            <CardContent>
              {templates.length > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <select
                    value={runsTemplateFilter}
                    onChange={(e) => setRunsTemplateFilter(e.target.value)}
                    aria-label="Filter runs by template"
                    className="rounded-lg bg-surface-tertiary border border-white/[0.1] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand"
                  >
                    <option value="">All templates</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              {runs.length === 0 ? (
                <EmptyState icon={Play} title="No prompt runs" description="Render prompts via the API or SDK to track usage here." />
              ) : (
                <div className="space-y-2">
                  {runs.map(run => (
                    <div key={run.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-tertiary border border-white/[0.04]">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm text-white font-medium truncate">{run.template_name}</span>
                        <Badge size="xs">v{run.version}</Badge>
                        {run.agent_id && <span className="text-[10px] text-disabled truncate">{run.agent_id}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-tertiary tabular-nums">{run.tokens_used || 0} tok</span>
                        <span className="text-xs text-tertiary tabular-nums">{run.latency_ms || 0}ms</span>
                        <span className="text-[10px] text-disabled">{new Date(run.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Usage by template */}
        {stats?.by_template && stats.by_template.length > 0 && (
          <Card>
            <CardHeader title="Usage by Template" />
            <CardContent>
              <div className="space-y-2">
                {stats.by_template.map(t => (
                  <div key={t.template_name} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-secondary">{t.template_name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-tertiary tabular-nums">{t.total_runs} runs</span>
                      <span className="text-xs text-tertiary tabular-nums">{t.avg_tokens} avg tok</span>
                      <span className="text-xs text-tertiary tabular-nums">{t.avg_latency_ms}ms avg</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Usage by version — which version is actually in use */}
        {stats?.by_version && stats.by_version.length > 0 && (
          <Card>
            <CardHeader title="Usage by Version" />
            <CardContent>
              <div className="space-y-2">
                {stats.by_version.map((v, i) => (
                  <div key={`${v.template_name}-${v.version}-${i}`} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-secondary">{v.template_name} <span className="text-tertiary">v{v.version}</span></span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-tertiary tabular-nums">{v.total_runs} runs</span>
                      {v.avg_tokens != null && <span className="text-xs text-tertiary tabular-nums">{v.avg_tokens} avg tok</span>}
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
