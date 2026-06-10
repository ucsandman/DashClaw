'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Cpu, Save } from 'lucide-react';
import PageLayout from '../../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import ModelStrategyBasicsSection from '../components/ModelStrategyBasicsSection';
import ModelStrategyExecutionSection from '../components/ModelStrategyExecutionSection';
import ModelStrategyConstraintsSection from '../components/ModelStrategyConstraintsSection';
import ModelStrategySummaryCard from '../components/ModelStrategySummaryCard';
import ModelStrategyAdvancedSection from '../components/ModelStrategyAdvancedSection';
import {
  buildModelStrategySummary,
  compileModelStrategyConfig,
  createDefaultModelStrategyFormState,
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

export default function NewModelStrategyPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formState, setFormState] = useState<ModelStrategyFormState>(createDefaultModelStrategyFormState);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showRawConfig, setShowRawConfig] = useState(false);

  const summary = useMemo(() => buildModelStrategySummary(formState), [formState]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const config = compileModelStrategyConfig(formState);
      const response = await fetch('/api/model-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          config,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create strategy');
      }

      const { strategy } = await response.json();
      router.push(`/workflows/strategies/${strategy.strategy_id}`);
    } catch (submitError: any) {
      setError(submitError.message);
      setSaving(false);
    }
  };

  return (
    <PageLayout
      title="New Model Strategy"
      subtitle="Define provider, fallback chain, budget cap, and operating constraints without editing raw JSON."
      breadcrumbs={['Labs', 'Workflows', 'Model Strategies', 'New']}
      maturity="beta"
      actions={
        <Link
          href="/workflows/strategies"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:text-white"
        >
          <ArrowLeft size={14} /> Back
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
        <Card>
          <CardHeader title="Basics" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyBasicsSection
              name={name}
              description={description}
              onNameChange={setName}
              onDescriptionChange={setDescription}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Default execution" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyExecutionSection
              execution={formState.execution}
              onExecutionChange={(execution) => setFormState((current) => ({ ...current, execution }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Operating constraints" icon={Cpu} />
          <CardContent className="space-y-4 p-5 pt-0">
            <ModelStrategyConstraintsSection
              constraints={formState.constraints}
              onConstraintsChange={(constraints) => setFormState((current) => ({ ...current, constraints }))}
            />
          </CardContent>
        </Card>

        <ModelStrategySummaryCard summary={summary} />

        <ModelStrategyAdvancedSection
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((current) => !current)}
          taskModes={formState.advanced.taskModes}
          onTaskModesChange={(taskModes) =>
            setFormState((current) => ({
              ...current,
              advanced: { ...current.advanced, taskModes },
            }))
          }
          rawConfigText={formState.advanced.rawConfigText}
          showRawConfig={showRawConfig}
          onToggleRawConfig={() => setShowRawConfig((current) => !current)}
          onRawConfigTextChange={(rawConfigText) =>
            setFormState((current) => ({
              ...current,
              advanced: { ...current.advanced, rawConfigText },
            }))
          }
        >
          <div className="text-sm text-secondary">
            Use task-mode overrides when only specific classes of work need a different model.
          </div>
        </ModelStrategyAdvancedSection>

        {error ? (
          <div className="rounded-lg border border-error/20 bg-error-subtle px-4 py-3 text-sm text-error">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Creating...' : 'Create Strategy'}
          </button>
          <Link href="/workflows/strategies" className="px-4 py-2 text-sm text-secondary transition-colors hover:text-white">
            Cancel
          </Link>
        </div>
      </form>
    </PageLayout>
  );
}
