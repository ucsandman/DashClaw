'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Cpu, Save, Trash2 } from 'lucide-react';
import PageLayout from '../../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import ModelStrategyBasicsSection from '../components/ModelStrategyBasicsSection';
import ModelStrategyExecutionSection from '../components/ModelStrategyExecutionSection';
import ModelStrategyConstraintsSection from '../components/ModelStrategyConstraintsSection';
import ModelStrategySummaryCard from '../components/ModelStrategySummaryCard';
import ModelStrategyAdvancedSection from '../components/ModelStrategyAdvancedSection';
import ModelStrategyTestPanel from '../components/ModelStrategyTestPanel';
import {
  buildModelStrategySummary,
  compileModelStrategyConfig,
  decompileModelStrategyConfig,
  requiresAdvancedStrategyConfig,
} from '../lib/modelStrategyFormModel';

interface ModelStrategyFormState {
  execution: {
    primaryProvider: string;
    primaryModel: string;
    fallbacks: { provider: string; model: string }[];
    maxRetries: number;
  };
  constraints: {
    costSensitivity: string;
    latencySensitivity: string;
    maxBudgetUsd: number;
    allowedProviders: string[];
    disallowedProviders: string[];
  };
  advanced: {
    taskModes: { taskMode: string; provider: string; model: string }[];
    rawConfigText: string;
  };
}

interface ModelStrategy {
  strategy_id: string;
  name: string;
  description?: string;
  config?: any;
}

export default function ModelStrategyDetailPage() {
  const router = useRouter();
  const { strategyId } = useParams<{ strategyId: string }>();
  const [strategy, setStrategy] = useState<ModelStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formState, setFormState] = useState<ModelStrategyFormState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showRawConfig, setShowRawConfig] = useState(false);
  const [advancedWarning, setAdvancedWarning] = useState<string | null>(null);

  const fetchStrategy = useCallback(async () => {
    try {
      const response = await fetch(`/api/model-strategies/${strategyId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Strategy not found');
          return;
        }
        throw new Error('Failed to fetch');
      }

      const { strategy: nextStrategy } = await response.json();
      setStrategy(nextStrategy);
      setName(nextStrategy.name);
      setDescription(nextStrategy.description || '');
      setFormState(decompileModelStrategyConfig(nextStrategy.config));
      setAdvancedWarning(
        requiresAdvancedStrategyConfig(nextStrategy.config)
          ? 'Advanced config details require manual review. Some stored settings use shapes the guided builder cannot fully round-trip yet.'
          : null
      );
    } catch (fetchError: any) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => {
    if (strategyId) {
      fetchStrategy();
    }
  }, [strategyId, fetchStrategy]);

  const summary = useMemo(
    () => buildModelStrategySummary(formState),
    [formState]
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const config = compileModelStrategyConfig(formState);
      const response = await fetch(`/api/model-strategies/${strategyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          config,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Save failed');
      }

      await fetchStrategy();
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this model strategy? Linked workflow templates will have their reference cleared.')) return;
    try {
      const response = await fetch(`/api/model-strategies/${strategyId}`, { method: 'DELETE' });
      if (response.ok) {
        router.push('/workflows/strategies');
      }
    } catch (deleteError: any) {
      setError(deleteError.message);
    }
  };

  if (loading) {
    return (
      <PageLayout title="Loading..." breadcrumbs={['Labs', 'Workflows', 'Model Strategies']}>
        <div className="py-12 text-center text-sm text-tertiary">Loading...</div>
      </PageLayout>
    );
  }

  if (error && !strategy) {
    return (
      <PageLayout title="Strategy Not Found" breadcrumbs={['Labs', 'Workflows', 'Model Strategies', strategyId]}>
        <Card className="mx-auto mt-12 max-w-md">
          <CardContent className="p-6 text-center">
            <div className="mb-2 text-lg font-medium text-white">{error}</div>
            <div className="text-sm text-tertiary">{strategyId}</div>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={strategy!.name}
      subtitle="Guided model strategy configuration"
      breadcrumbs={['Labs', 'Workflows', 'Model Strategies', strategy!.name]}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/workflows/strategies"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-sm text-error transition-colors hover:bg-error-subtle hover:text-error"
          >
            <Trash2 size={14} /> Delete
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader title="Basics" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyBasicsSection
              name={name}
              description={description}
              onNameChange={setName}
              onDescriptionChange={setDescription}
            />
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-tertiary">Strategy ID</div>
              <div className="font-mono text-xs text-secondary">{strategy!.strategy_id}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Default execution" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyExecutionSection
              execution={formState!.execution}
              onExecutionChange={(execution) => setFormState((current) => ({ ...current!, execution }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Operating constraints" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyConstraintsSection
              constraints={formState!.constraints}
              onConstraintsChange={(constraints) => setFormState((current) => ({ ...current!, constraints }))}
            />
          </CardContent>
        </Card>

        <ModelStrategySummaryCard summary={summary} />

        <ModelStrategyAdvancedSection
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((current) => !current)}
          warning={advancedWarning}
          taskModes={formState!.advanced.taskModes}
          onTaskModesChange={(taskModes) =>
            setFormState((current) => ({
              ...current!,
              advanced: { ...current!.advanced, taskModes },
            }))
          }
          rawConfigText={formState!.advanced.rawConfigText}
          showRawConfig={showRawConfig}
          onToggleRawConfig={() => setShowRawConfig((current) => !current)}
          onRawConfigTextChange={(rawConfigText) =>
            setFormState((current) => ({
              ...current!,
              advanced: { ...current!.advanced, rawConfigText },
            }))
          }
        />

        <ModelStrategyTestPanel strategyId={strategyId} />
      </div>
    </PageLayout>
  );
}
