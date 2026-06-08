'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Cpu, Plus, RotateCw, DollarSign, Shield, Pencil, Trash2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

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
  onDelete?: (strategyId: string) => void | Promise<void>;
}

function StrategyCard({ s, onDelete }: StrategyCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const primary = s.config?.primary || {};
  const fallbacks = s.config?.fallback || [];

  return (
    <Card className="h-full" data-entity-type="modelStrategy" data-entity-id={s.strategy_id}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            <Link href={`/model-strategies/${s.strategy_id}`} className="text-sm font-semibold text-white truncate hover:text-brand block">
              {s.name}
            </Link>
            {s.description && (
              <div className="text-xs text-tertiary truncate">{s.description}</div>
            )}
          </div>
          {s.config?.costSensitivity && (
            <Badge variant={costVariant[s.config.costSensitivity] || 'default'}>
              {s.config.costSensitivity}
            </Badge>
          )}
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
            <span className="flex items-center gap-1"><DollarSign size={11} />${s.config.maxBudgetUsd}</span>
          )}
          {s.config?.maxRetries != null && (
            <span className="flex items-center gap-1"><Shield size={11} />{s.config.maxRetries} retries</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Link
            href={`/model-strategies/${s.strategy_id}`}
            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-white"
            aria-label={`Edit ${s.name}`}
          >
            <Pencil size={11} /> Edit
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
                {deleting ? 'Deleting...' : 'Yes'}
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
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ModelStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/model-strategies');
      if (res.ok) {
        const data = await res.json();
        setStrategies(data.strategies || []);
      }
    } catch (err) {
      console.error('Failed to fetch strategies:', err);
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

  const createDefault = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/model-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Balanced default',
          description: 'GPT-4.1 primary, Claude Sonnet 4 fallback, balanced cost',
          config: {
            primary: { provider: 'openai', model: 'gpt-4.1' },
            fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4' }],
            costSensitivity: 'balanced',
            latencySensitivity: 'medium',
            maxBudgetUsd: 0.5,
            maxRetries: 2,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create strategy');
      }
      await fetchStrategies();
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageLayout
      title="Model Strategies"
      subtitle="Reusable provider/model strategy records linked to workflows"
      breadcrumbs={['Studio', 'Model Strategies']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setLoading(true); fetchStrategies(); }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors"
          >
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link
            href="/model-strategies/new"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Strategy
          </Link>
        </div>
      }
    >
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-tertiary py-12 text-center">Loading...</div>
      ) : strategies.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No model strategies yet"
          description="Define reusable model/provider strategies with fallback chains, budget caps, and task-mode overrides. Link them to workflow templates."
          action={
            <Link
              href="/model-strategies/new"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
            >
              <Plus size={14} /> Create your first strategy
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map((s) => (
            <StrategyCard key={s.strategy_id} s={s} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
