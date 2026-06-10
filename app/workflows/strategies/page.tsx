'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Cpu, Plus, RotateCw, DollarSign, Shield, Pencil, Trash2, CheckSquare } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useSelection } from '../../lib/useSelection';
import { useSelectAllHotkey } from '../../lib/useSelectAllHotkey';
import WorkflowsTabs from '../components/WorkflowsTabs';

const costVariant: Record<string, string> = {
  low: 'success',
  balanced: 'info',
  'high-quality': 'warning',
};

interface ModelRef {
  provider?: string;
  model?: string;
}

interface StrategyConfig {
  primary?: ModelRef;
  fallback?: ModelRef[];
  costSensitivity?: string;
  latencySensitivity?: string;
  maxBudgetUsd?: number | null;
  maxRetries?: number | null;
}

interface Strategy {
  strategy_id: string;
  name: string;
  description?: string;
  config?: StrategyConfig;
}

interface StrategyCardProps {
  s: Strategy;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onDelete?: (strategyId: string) => void | Promise<void>;
}

function StrategyCard({ s, selected, selectionMode, onToggleSelect, onDelete }: StrategyCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const primary = s.config?.primary || {};
  const fallbacks = s.config?.fallback || [];

  const cardContent = (
    <Card className={`h-full transition-colors ${selected ? 'border-brand/40 ring-1 ring-brand/40' : ''}`} data-entity-type="modelStrategy" data-entity-id={s.strategy_id}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            {selectionMode ? (
              <span className="block truncate text-sm font-semibold text-white">{s.name}</span>
            ) : (
              <Link href={`/workflows/strategies/${s.strategy_id}`} className="block truncate text-sm font-semibold text-white hover:text-brand">
                {s.name}
              </Link>
            )}
            {s.description && (
              <div className="text-xs text-tertiary truncate">{s.description}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectionMode && (
              <input
                type="checkbox"
                aria-label={`Select ${s.name}`}
                checked={selected}
                onChange={() => onToggleSelect(s.strategy_id)}
                onClick={(event) => event.stopPropagation()}
                className="h-3.5 w-3.5 cursor-pointer accent-brand"
              />
            )}
            {s.config?.costSensitivity && (
              <Badge variant={costVariant[s.config.costSensitivity] || 'default'}>
                {s.config.costSensitivity}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] text-tertiary uppercase tracking-wider">Primary</div>
          <div className="text-xs text-secondary font-mono">
            {primary.provider || '—'} · {primary.model || '—'}
          </div>
          {fallbacks.length > 0 && (
            <>
              <div className="text-[10px] text-tertiary uppercase tracking-wider mt-2">Fallback</div>
              <div className="text-xs text-secondary font-mono">
                {fallbacks.map((f) => `${f.provider}·${f.model}`).join(' → ')}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[10px] text-tertiary uppercase tracking-wider">
          {s.config?.maxBudgetUsd != null && (
            <span className="flex items-center gap-1"><DollarSign size={11} aria-hidden="true" />${s.config.maxBudgetUsd}</span>
          )}
          {s.config?.maxRetries != null && (
            <span className="flex items-center gap-1"><Shield size={11} aria-hidden="true" />{s.config.maxRetries} retries</span>
          )}
        </div>
        {!selectionMode && (
          <div className="flex items-center gap-2 mt-3">
            <Link
              href={`/workflows/strategies/${s.strategy_id}`}
              className="inline-flex items-center gap-1 text-xs text-secondary hover:text-white"
              aria-label={`Edit ${s.name}`}
            >
              <Pencil size={11} aria-hidden="true" /> Edit
            </Link>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-error">Delete?</span>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete?.(s.strategy_id);
                    setDeleting(false);
                    setConfirmDelete(false);
                  }}
                  disabled={deleting}
                  className="text-error hover:text-error disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-secondary hover:text-white"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 text-xs text-secondary hover:text-error"
                aria-label={`Delete ${s.name}`}
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
      <button type="button" onClick={() => onToggleSelect(s.strategy_id)} className="text-left">
        {cardContent}
      </button>
    );
  }
  return cardContent;
}

export default function ModelStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const selection = useSelection<Strategy>(strategies, (s) => s.strategy_id);
  const selectedIds = selection.selectedIds;
  const [deleting, setDeleting] = useState(false);
  useSelectAllHotkey(selection.toggleAll, selectionMode);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/model-strategies');
      if (res.ok) {
        const data = await res.json();
        setStrategies(data.strategies || []);
        setError(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to load strategies. Use Refresh to retry.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategies. Use Refresh to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStrategies(); }, [fetchStrategies]);

  const handleDelete = useCallback(async (strategyId: string) => {
    try {
      const res = await fetch(`/api/model-strategies/${strategyId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to delete strategy');
        return;
      }
      await fetchStrategies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete strategy');
    }
  }, [fetchStrategies]);

  async function handleDeleteSelected() {
    if (selectedIds.length === 0 || deleting) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selectedIds.length} model strateg${selectedIds.length === 1 ? 'y' : 'ies'}? Linked workflow templates will have their reference cleared.`)) {
      return;
    }
    setDeleting(true);
    try {
      const results = await Promise.all(
        selectedIds.map((strategyId) => fetch(`/api/model-strategies/${strategyId}`, { method: 'DELETE' }))
      );
      const deletedIds = selectedIds.filter((_, index) => results[index]?.ok);
      setStrategies((prev) => prev.filter((s) => !deletedIds.includes(s.strategy_id)));
      selection.clear();
      setSelectionMode(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageLayout agentFilter={false}
      title="Model strategies"
      subtitle="Provider and model fallback chains, budgets, and constraints, referenced by workflow templates"
      breadcrumbs={['Labs', 'Workflows', 'Model Strategies']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLoading(true); fetchStrategies(); }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            aria-label="Refresh strategies"
          >
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectionMode((value) => !value);
              selection.clear();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <CheckSquare size={14} aria-hidden="true" />
            {selectionMode ? 'Cancel selection' : 'Select multiple'}
          </button>
          <Link
            href="/workflows/strategies/new"
            className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
          >
            <Plus size={14} aria-hidden="true" /> New strategy
          </Link>
        </div>
      }
    >
      <WorkflowsTabs active="strategies" />

      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      {selectionMode && strategies.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface-secondary p-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-secondary">Select the strategies you want to delete.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selection.toggleAll()}
              className="rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              {selection.allSelected ? 'Clear all' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.length === 0 || deleting}
              className="flex items-center gap-1.5 rounded-lg border border-error/30 bg-error-subtle px-3 py-1.5 text-xs text-error transition-colors hover:border-error/50 disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden="true" />
              {deleting ? 'Deleting…' : `Delete selected${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-surface-secondary" />
          ))}
        </div>
      ) : strategies.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No model strategies yet"
          description="A strategy names a primary model, a fallback chain, a budget cap, and operating constraints. Workflow templates reference one strategy at launch."
          action={
            <Link
              href="/workflows/strategies/new"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
            >
              <Plus size={14} aria-hidden="true" /> Create your first strategy
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map((s) => (
            <StrategyCard
              key={s.strategy_id}
              s={s}
              selected={selectedIds.includes(s.strategy_id)}
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
