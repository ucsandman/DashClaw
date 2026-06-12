'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Workflow, Plus, RotateCw, FileText, CheckSquare, Trash2, Sparkles, Pencil } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import WorkflowsTabs from './components/WorkflowsTabs';

const statusVariant: Record<string, string> = {
  draft: 'default',
  active: 'success',
  archived: 'info',
};

function timeAgo(dateString?: string | null): string {
  if (!dateString) return '';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface WorkflowCardProps {
  t: any;
  strategyName?: string | null;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onDelete?: (templateId: string) => Promise<void> | void;
}

function WorkflowCard({ t, strategyName, selected, selectionMode, onToggleSelect, onDelete }: WorkflowCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cardContent = (
    <Card className={`h-full transition-colors ${selected ? 'border-brand/40 ring-1 ring-brand/40' : ''}`} data-entity-type="workflow" data-entity-id={t.template_id} data-entity-status={t.status}>
      <CardContent className="p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{t.name}</div>
            <div className="truncate font-mono text-xs text-tertiary">{t.slug}</div>
          </div>
          <div className="flex items-center gap-2">
            {selectionMode && (
              <input
                type="checkbox"
                aria-label={`Select ${t.name}`}
                checked={selected}
                onChange={() => onToggleSelect(t.template_id)}
                onClick={(event) => event.stopPropagation()}
                className="h-3.5 w-3.5 cursor-pointer accent-brand"
              />
            )}
            <Badge variant={statusVariant[t.status] || 'default'}>{t.status}</Badge>
          </div>
        </div>
        {t.description && (
          <div className="mb-3 line-clamp-2 text-xs text-secondary">{t.description}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
          <span className="flex items-center gap-1"><FileText size={11} aria-hidden="true" />v{t.version}</span>
          <span aria-hidden="true" className="text-disabled">&middot;</span>
          <span className="tabular-nums">{(t.linked_policy_ids?.length || 0)} policies</span>
          <span aria-hidden="true" className="text-disabled">&middot;</span>
          <span className="tabular-nums">{(t.linked_capability_ids?.length || 0)} capabilities</span>
          {strategyName && (
            <>
              <span aria-hidden="true" className="text-disabled">&middot;</span>
              <span className="normal-case tracking-normal font-medium text-secondary" title="Model strategy">{strategyName}</span>
            </>
          )}
        </div>
        <div className="mt-2 text-[11px] tabular-nums text-tertiary">Updated {timeAgo(t.updated_at)}</div>
        {!selectionMode && (
          <div className="mt-3 flex items-center gap-3">
            <Link
              href={`/workflows/${t.template_id}`}
              className="inline-flex items-center gap-1 text-xs text-secondary transition-colors hover:text-white"
              aria-label={`Edit ${t.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil size={11} aria-hidden="true" /> Edit
            </Link>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-error">Delete?</span>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleting(true);
                    await onDelete?.(t.template_id);
                    setDeleting(false);
                    setConfirmDelete(false);
                  }}
                  disabled={deleting}
                  className="text-error transition-colors hover:text-error disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes'}
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(false); }}
                  className="text-secondary transition-colors hover:text-white"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }}
                className="inline-flex items-center gap-1 text-xs text-secondary transition-colors hover:text-error"
                aria-label={`Delete ${t.name}`}
              >
                <Trash2 size={11} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (selectionMode) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect(t.template_id)}
        className="text-left"
      >
        {cardContent}
      </button>
    );
  }

  return (
    <Link href={`/workflows/${t.template_id}`}>
      {cardContent}
    </Link>
  );
}

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [strategyNames, setStrategyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const selection = useSelection<any>(templates, (t) => t.template_id);
  const selectedIds = selection.selectedIds;
  const [deleting, setDeleting] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  useSelectAllHotkey(selection.toggleAll, selectionMode);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchTemplates = useCallback(async () => {
    try {
      const qs = statusFilter === 'all' ? '' : `&status=${statusFilter}`;
      const res = await fetch(`/api/workflows/templates?limit=100${qs}`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error('Failed to fetch workflow templates:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Strategy id -> name, so cards can show which model strategy a template
  // launches with (the id alone is meaningless to a reader).
  useEffect(() => {
    fetch('/api/model-strategies')
      .then((r) => (r.ok ? r.json() : { strategies: [] }))
      .then((d) => {
        const map: Record<string, string> = {};
        for (const s of d.strategies || []) map[s.strategy_id] = s.name;
        setStrategyNames(map);
      })
      .catch((err) => {
        console.warn('Failed to load model strategies for workflow cards:', err);
      });
  }, []);

  const handleDelete = useCallback(async (templateId: string) => {
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(body.error || 'Failed to delete template');
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.template_id !== templateId));
    } catch (err: any) {
      console.error(err.message || 'Failed to delete template');
    }
  }, []);

  async function handleDeleteSelected() {
    if (selectedIds.length === 0 || deleting) return;

    setDeleting(true);
    try {
      const results = await Promise.all(
        selectedIds.map((templateId) => fetch(`/api/workflows/templates/${templateId}`, {
          method: 'DELETE',
        }))
      );

      const deletedIds = selectedIds.filter((_, index) => results[index]?.ok);
      setTemplates((prev) => prev.filter((template) => !deletedIds.includes(template.template_id)));
      selection.clear();
      setSelectionMode(false);
    } finally {
      setDeleting(false);
      setConfirmingBulkDelete(false);
    }
  }

  const allSelected = selection.allSelected;

  return (
    <PageLayout agentFilter={false}
      title="Workflows"
      subtitle="A workflow template packages a repeatable agent task (steps, prompts, capabilities, policies, one model strategy) into a governed, versioned asset"
      breadcrumbs={['Labs', 'Workflows']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-surface-secondary p-0.5">
            {['all', 'draft', 'active', 'archived'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-surface-elevated text-white' : 'text-tertiary hover:text-secondary'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setLoading(true); fetchTemplates(); }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            aria-label="Refresh templates"
          >
            <RotateCw size={14} className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectionMode((value) => !value);
              selection.clear();
              setConfirmingBulkDelete(false);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <CheckSquare size={14} aria-hidden="true" />
            {selectionMode ? 'Cancel selection' : 'Select multiple'}
          </button>
          <Link
            href="/workflows/new"
            className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
          >
            <Plus size={14} aria-hidden="true" />
            New template
          </Link>
        </div>
      }
    >
      <WorkflowsTabs active="templates" />

      {!loading && templates.length > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-surface-secondary p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Workflow operations</div>
              <p className="mt-1 text-sm text-secondary">
                {selectionMode
                  ? 'Select the workflow templates you want to delete. This is the fastest way to clean up old test workflows.'
                  : 'Need a new workflow quickly? You can also describe it in plain English from the workflow builder with Generate with AI.'}
              </p>
              {!selectionMode && (
                <p className="mt-1 text-xs text-tertiary">
                  Playbook: the Branch Finish loop (finish prompts, coding standards, capability health) ships as a seeded
                  template via <code className="rounded bg-surface-tertiary px-1 py-0.5 font-mono text-secondary">npm run seed:branch-finish</code>.
                </p>
              )}
            </div>
            {selectionMode ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selection.toggleAll()}
                  className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
                {confirmingBulkDelete && selectedIds.length > 0 ? (
                  <span className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-subtle px-3 py-1.5 text-xs">
                    <span className="text-secondary">Delete {selectedIds.length} template{selectedIds.length === 1 ? '' : 's'}?</span>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={deleting}
                      className="font-semibold text-error transition-colors hover:text-error disabled:opacity-50"
                    >
                      {deleting ? 'Deleting…' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingBulkDelete(false)}
                      disabled={deleting}
                      className="text-secondary transition-colors hover:text-white disabled:opacity-50"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingBulkDelete(true)}
                    disabled={selectedIds.length === 0 || deleting}
                    className="flex items-center gap-1.5 rounded-lg border border-error/30 bg-error-subtle px-3 py-1.5 text-xs text-error transition-colors hover:border-error/50 hover:bg-error-subtle disabled:opacity-50"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {`Delete selected${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
                  </button>
                )}
              </div>
            ) : (
              <Link
                href="/workflows/new"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
              >
                <Sparkles size={14} aria-hidden="true" />
                Open AI workflow builder
              </Link>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-40 motion-safe:animate-pulse rounded-xl border border-border bg-surface-secondary"
            />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No workflow templates yet"
          description="Package repeatable operational patterns into reusable, versioned assets."
          action={(
            <div className="mx-auto max-w-md">
              <ol className="mb-4 space-y-2 text-left text-xs text-secondary">
                <li className="flex gap-2">
                  <span className="font-semibold tabular-nums text-tertiary">1.</span>
                  <span>Register the <Link href="/capabilities" className="text-brand hover:text-brand-hover">capabilities</Link> your agents are allowed to invoke.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold tabular-nums text-tertiary">2.</span>
                  <span>Pick or create a <Link href="/workflows/strategies" className="text-brand hover:text-brand-hover">model strategy</Link> (primary model, fallbacks, budget).</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold tabular-nums text-tertiary">3.</span>
                  <span>Compose the steps yourself, or describe the workflow in plain English and generate it with AI.</span>
                </li>
              </ol>
              <Link
                href="/workflows/new"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
              >
                <Plus size={14} aria-hidden="true" />
                Create your first template
              </Link>
            </div>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <WorkflowCard
              key={t.template_id}
              t={t}
              strategyName={t.model_strategy_id ? strategyNames[t.model_strategy_id] || null : null}
              selected={selectedIds.includes(t.template_id)}
              selectionMode={selectionMode}
              onToggleSelect={(id) => selection.selectClick(id)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
