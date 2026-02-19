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
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';

const CATEGORIES = ['general', 'system', 'agent', 'tool', 'evaluation'];

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'runs', label: 'Usage' },
];

export default function PromptsPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('templates');

  // Data
  const [templates, setTemplates] = useState([]);
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Selected template for detail view
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', category: 'general' });

  // New version form
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVersion, setNewVersion] = useState({ content: '', model_hint: '', changelog: '' });

  // Render preview
  const [renderPreview, setRenderPreview] = useState(null);
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

  // Fetch versions for selected template
  const fetchVersions = async (templateId) => {
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

  const handleSelectTemplate = (t) => {
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
  const handleDelete = async (id) => {
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
  const handleActivate = async (versionId) => {
    if (!selectedTemplate) return;
    try {
      await fetch(`/api/prompts/templates/${selectedTemplate.id}/versions/${versionId}`, { method: 'POST' });
      fetchVersions(selectedTemplate.id);
    } catch { /* ignore */ }
  };

  // Render preview
  const handleRender = async (versionId) => {
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
  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (loading) {
    return (
      <PageLayout title="Prompts" subtitle="Manage and version prompt templates">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};

  return (
    <PageLayout
      title="Prompts"
      subtitle="Manage and version prompt templates"
      breadcrumbs={['Operations', 'Prompts']}
      actions={
        <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={16} />
        </button>
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
                    <input value={newTemplate.name} onChange={e => setNewTemplate(s => ({ ...s, name: e.target.value }))} placeholder="Template name" className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                    <input value={newTemplate.description} onChange={e => setNewTemplate(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)" className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                    <select value={newTemplate.category} onChange={e => setNewTemplate(s => ({ ...s, category: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
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
                    <div className="space-y-1">
                      {templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleSelectTemplate(t)}
                          className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-colors ${selectedTemplate?.id === t.id ? 'bg-brand/10 border border-brand/30' : 'bg-[#111] border border-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.1)]'}`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-white font-medium truncate">{t.name}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge size="xs">{t.category}</Badge>
                              <span className="text-[10px] text-zinc-600">v{t.active_version || t.version_count || 0}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-zinc-600">{t.version_count || 0} ver</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </button>
                      ))}
                    </div>
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
                      {selectedTemplate.description && <p className="text-xs text-zinc-500 mt-0.5">{selectedTemplate.description}</p>}
                    </div>
                    <button onClick={() => setShowNewVersion(!showNewVersion)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
                      <Plus size={14} /> New Version
                    </button>
                  </div>

                  {showNewVersion && (
                    <Card>
                      <CardContent className="space-y-3 pt-5">
                        <textarea value={newVersion.content} onChange={e => setNewVersion(s => ({ ...s, content: e.target.value }))} placeholder="Prompt content... Use {{variable}} for template variables" rows={8} className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand font-mono" />
                        <div className="grid grid-cols-2 gap-3">
                          <input value={newVersion.model_hint} onChange={e => setNewVersion(s => ({ ...s, model_hint: e.target.value }))} placeholder="Model hint (e.g., gpt-4o-mini)" className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                          <input value={newVersion.changelog} onChange={e => setNewVersion(s => ({ ...s, changelog: e.target.value }))} placeholder="Changelog note" className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowNewVersion(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
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
                            <div key={v.id} className={`rounded-lg border ${v.is_active ? 'border-green-500/30 bg-green-500/5' : 'border-[rgba(255,255,255,0.04)] bg-[#111]'}`}>
                              <div className="flex items-center justify-between px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-white">v{v.version}</span>
                                  {v.is_active && <Badge variant="success" size="xs">active</Badge>}
                                  {v.model_hint && <Badge size="xs">{v.model_hint}</Badge>}
                                  {v.changelog && <span className="text-xs text-zinc-500 truncate max-w-[200px]">{v.changelog}</span>}
                                </div>
                                <div className="flex items-center gap-1">
                                  {!v.is_active && (
                                    <button onClick={() => handleActivate(v.id)} className="p-1 rounded text-zinc-500 hover:text-green-400 transition-colors" title="Activate this version">
                                      <CheckCircle size={14} />
                                    </button>
                                  )}
                                  <button onClick={() => handleCopy(v.content)} className="p-1 rounded text-zinc-500 hover:text-white transition-colors" title="Copy content">
                                    <Copy size={14} />
                                  </button>
                                  <button onClick={() => handleRender(v.id)} className="p-1 rounded text-zinc-500 hover:text-blue-400 transition-colors" title="Preview render">
                                    <Eye size={14} />
                                  </button>
                                </div>
                              </div>
                              <pre className="px-3 pb-3 text-xs text-zinc-400 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">{v.content}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {renderPreview && (
                    <Card>
                      <CardHeader title="Render Preview" action={
                        <button onClick={() => setRenderPreview(null)} className="text-xs text-zinc-400 hover:text-white">Close</button>
                      } />
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Variables (JSON):</span>
                          <input value={renderVars} onChange={e => setRenderVars(e.target.value)} className="flex-1 px-2 py-1 rounded bg-[#111] border border-[rgba(255,255,255,0.1)] text-xs text-white font-mono focus:outline-none focus:border-brand" />
                          <button onClick={() => handleRender(renderPreview.version_id)} className="px-2 py-1 rounded bg-brand/20 text-brand text-xs hover:bg-brand/30 transition-colors">
                            <Play size={12} />
                          </button>
                        </div>
                        <pre className="text-xs text-zinc-300 bg-[#111] p-3 rounded-lg border border-[rgba(255,255,255,0.06)] max-h-[300px] overflow-y-auto whitespace-pre-wrap font-mono">{renderPreview.rendered}</pre>
                        {renderPreview.parameters && renderPreview.parameters.length > 0 && (
                          <div className="flex gap-1">
                            <span className="text-[10px] text-zinc-600">Params:</span>
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
              {runs.length === 0 ? (
                <EmptyState icon={Play} title="No prompt runs" description="Render prompts via the API or SDK to track usage here." />
              ) : (
                <div className="space-y-2">
                  {runs.map(run => (
                    <div key={run.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.04)]">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm text-white font-medium truncate">{run.template_name}</span>
                        <Badge size="xs">v{run.version}</Badge>
                        {run.agent_id && <span className="text-[10px] text-zinc-600 truncate">{run.agent_id}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-zinc-500 tabular-nums">{run.tokens_used || 0} tok</span>
                        <span className="text-xs text-zinc-500 tabular-nums">{run.latency_ms || 0}ms</span>
                        <span className="text-[10px] text-zinc-600">{new Date(run.created_at).toLocaleDateString()}</span>
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
                    <span className="text-sm text-zinc-300">{t.template_name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 tabular-nums">{t.total_runs} runs</span>
                      <span className="text-xs text-zinc-500 tabular-nums">{t.avg_tokens} avg tok</span>
                      <span className="text-xs text-zinc-500 tabular-nums">{t.avg_latency_ms}ms avg</span>
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
