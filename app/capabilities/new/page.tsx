'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Wrench } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { compileCapabilityPayload } from '../lib/capabilityFormModel.js';
import CapabilityModeSelector from './components/CapabilityModeSelector';
import CapabilityBasicsSection from './components/CapabilityBasicsSection';
import CapabilityHttpRuntimeSection from './components/CapabilityHttpRuntimeSection';
import CapabilitySummaryCard from './components/CapabilitySummaryCard';

function splitTags(tags: string): string[] {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function createEmptyInputField() {
  return {
    label: '',
    key: '',
    type: 'string',
    required: false,
    helpText: '',
  };
}

export default function NewCapabilityPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState('registry_only');
  const [form, setForm] = useState<Record<string, any>>({
    name: '',
    description: '',
    category: '',
    source_type: 'internal_sdk',
    auth_type: 'none',
    risk_level: 'medium',
    requires_approval: false,
    tags: '',
    docs_url: '',
    health_status: 'unknown',
  });
  const [runtime, setRuntime] = useState<Record<string, any>>({
    endpoint: '',
    method: 'POST',
    timeout_ms: 60000,
    auth: {
      type: 'none',
      token_setting: '',
    },
    retry_policy: {
      max_retries: 0,
      backoff: 'none',
      base_delay_ms: 1000,
      max_delay_ms: 30000,
    },
    circuit_breaker: {
      enabled: false,
      consecutive_failures: 5,
    },
    inputFields: [],
  });

  function updateForm(key: string, value: any) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateRuntime(key: string, value: any) {
    setRuntime((current) => {
      if (key.startsWith('auth.')) {
        const authKey = key.replace('auth.', '');
        return {
          ...current,
          auth: {
            ...current.auth,
            [authKey]: value,
          },
        };
      }

      if (key.startsWith('retry_policy.')) {
        const retryKey = key.replace('retry_policy.', '');
        return {
          ...current,
          retry_policy: {
            ...current.retry_policy,
            [retryKey]: value,
          },
        };
      }

      if (key.startsWith('circuit_breaker.')) {
        const cbKey = key.replace('circuit_breaker.', '');
        return {
          ...current,
          circuit_breaker: {
            ...current.circuit_breaker,
            [cbKey]: value,
          },
        };
      }

      return {
        ...current,
        [key]: value,
      };
    });
  }

  function updateInputField(index: number, key: string, value: any) {
    setRuntime((current) => ({
      ...current,
      inputFields: current.inputFields.map((field: any, fieldIndex: number) => (
        fieldIndex === index ? { ...field, [key]: value } : field
      )),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = compileCapabilityPayload({
        mode,
        metadata: {
          ...form,
          tags: splitTags(form.tags),
        },
        runtime,
      });

      const response = await fetch('/api/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to register capability');
      }

      router.push('/capabilities');
    } catch (err: any) {
      setError(err.message || 'Failed to register capability');
      setSaving(false);
    }
  }

  return (
    <PageLayout
      title="Register Capability"
      subtitle="Add a callable capability to the governed registry"
      breadcrumbs={['Studio', 'Capabilities', 'New']}
      maturity="stable"
      actions={(
        <Link href="/capabilities" className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors">
          <ArrowLeft size={14} /> Back
        </Link>
      )}
    >
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
        <Card>
          <CardHeader title="Capability Details" icon={Wrench} />
          <CardContent className="grid gap-6 p-5 pt-0 xl:grid-cols-[minmax(0,2fr)_320px]">
            <div className="space-y-6">
              <CapabilityModeSelector mode={mode} onChange={setMode} />
              <CapabilityBasicsSection form={form as any} mode={mode} onChange={updateForm} />

              {mode === 'runnable_http' ? (
                <CapabilityHttpRuntimeSection
                  runtime={runtime as any}
                  onRuntimeChange={updateRuntime}
                  onAddInputField={() => setRuntime((current) => ({
                    ...current,
                    inputFields: [...current.inputFields, createEmptyInputField()],
                  }))}
                  onUpdateInputField={updateInputField}
                  onRemoveInputField={(index) => setRuntime((current) => ({
                    ...current,
                    inputFields: current.inputFields.filter((_: any, fieldIndex: number) => fieldIndex !== index),
                  }))}
                />
              ) : null}
            </div>

            <div className="space-y-4">
              <CapabilitySummaryCard
                mode={mode}
                form={form as any}
                runtime={runtime}
                fieldCount={runtime.inputFields.filter((field: any) => field.key.trim()).length}
              />
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Registering...' : 'Register Capability'}
          </button>
          <Link href="/capabilities" className="px-4 py-2 text-sm text-secondary hover:text-white transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </PageLayout>
  );
}
