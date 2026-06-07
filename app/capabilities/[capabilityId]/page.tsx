'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ShieldCheck, Wrench } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { EmptyState } from '../../components/ui/EmptyState';
import CapabilityStatusHero from './components/CapabilityStatusHero';
import CapabilityHealthCards from './components/CapabilityHealthCards';
import CapabilityFactsCard from './components/CapabilityFactsCard';
import CapabilityHistoryTable from './components/CapabilityHistoryTable';
import CapabilityTestPanel from './components/CapabilityTestPanel';
import CapabilityInvokePanel from './components/CapabilityInvokePanel';
import CapabilityAccessTab from './components/CapabilityAccessTab';
import {
  deriveGeneratedInputFields,
  isRunnableHttpCapability,
} from '../lib/capabilityFormModel.js';

async function readJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || 'Request failed');
  }
  return body;
}

interface HistoryFilters {
  actionType: string;
  status: string;
}

interface SubmitArgs {
  error?: string;
  payload?: Record<string, any>;
  declaredGoal?: string;
  agentId?: string;
}

export default function CapabilityDetailPage({ params }: { params?: { capabilityId?: string } }) {
  const routeParams = useParams() as Record<string, any> | null;
  const capabilityId = params?.capabilityId || routeParams?.capabilityId;
  const [capability, setCapability] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({ actionType: 'all', status: 'all' });
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [testSubmitting, setTestSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [invokePanelOpen, setInvokePanelOpen] = useState(false);
  const [invokeSubmitting, setInvokeSubmitting] = useState(false);
  const [invokeResult, setInvokeResult] = useState<any>(null);
  const hasInitializedHistory = useRef(false);
  const generatedTestFields = deriveGeneratedInputFields(capability);
  const canTestCapability = isRunnableHttpCapability(capability);

  const loadCapabilityDetail = useCallback(async () => {
    const capabilityBody = await fetch(`/api/capabilities/${capabilityId}`).then(readJson);
    setCapability(capabilityBody.capability || null);
  }, [capabilityId]);

  const loadHealthSummary = useCallback(async () => {
    setHealthError(null);
    try {
      const healthBody = await fetch(`/api/capabilities/${capabilityId}/health`).then(readJson);
      setHealth(healthBody || null);
      return healthBody;
    } catch (err: any) {
      setHealth(null);
      setHealthError(err.message || 'Failed to load health summary');
      return null;
    }
  }, [capabilityId]);

  const loadHistory = useCallback(async (filters: HistoryFilters) => {
    const params = new URLSearchParams();
    if (filters.actionType && filters.actionType !== 'all') {
      params.set('action_type', filters.actionType);
    }
    if (filters.status && filters.status !== 'all') {
      params.set('status', filters.status);
    }
    params.set('limit', '20');

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const historyBody = await fetch(`/api/capabilities/${capabilityId}/history?${params.toString()}`).then(readJson);
      setHistory(historyBody.events || []);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [capabilityId]);

  const handleRefresh = useCallback(async () => {
    if (!capabilityId) {
      setError('Capability id is required');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loadCapabilityDetail();
      await Promise.all([
        loadHealthSummary(),
        loadHistory(historyFilters),
      ]);
      hasInitializedHistory.current = true;
    } catch (err: any) {
      setError(err.message || 'Failed to load capability');
    } finally {
      setLoading(false);
    }
  }, [capabilityId, historyFilters, loadCapabilityDetail, loadHealthSummary, loadHistory]);

  useEffect(() => {
    hasInitializedHistory.current = false;
    handleRefresh();
    // Remount only on capabilityId change; including handleRefresh would re-run on every
    // filter change and double-fetch (the filter effect below already handles that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilityId]);

  useEffect(() => {
    if (!hasInitializedHistory.current) return;
    loadHistory(historyFilters);
  }, [historyFilters, loadHistory]);

  const handleTestSubmit = useCallback(async ({ error: parseError, payload, declaredGoal }: SubmitArgs) => {
    if (parseError) {
      setTestResult({ error: parseError });
      return;
    }

    setTestSubmitting(true);
    setTestResult(null);

    try {
      const body: Record<string, any> = { ...payload };
      if (declaredGoal) {
        body.declared_goal = declaredGoal;
      }

      const response = await fetch(`/api/capabilities/${capabilityId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resultBody = await response.json().catch(() => ({}));
      setTestResult(resultBody);

      await Promise.all([
        loadHealthSummary(),
        loadHistory(historyFilters),
      ]);
    } catch (err: any) {
      setTestResult({ error: err.message || 'Failed to run capability test' });
    } finally {
      setTestSubmitting(false);
    }
  }, [capabilityId, historyFilters, loadHealthSummary, loadHistory]);

  // Real governed invocation. The route returns a structured body for every
  // outcome (success and each rejection), so we keep the parsed body even when
  // the HTTP status is non-2xx and let the panel render it.
  const handleInvokeSubmit = useCallback(async ({ error: parseError, payload, declaredGoal, agentId }: SubmitArgs) => {
    if (parseError) {
      setInvokeResult({ error: parseError });
      return;
    }

    setInvokeSubmitting(true);
    setInvokeResult(null);

    try {
      const body: Record<string, any> = { ...payload };
      if (declaredGoal) body.declared_goal = declaredGoal;
      if (agentId) body.agent_id = agentId;

      const response = await fetch(`/api/capabilities/${capabilityId}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resultBody = await response.json().catch(() => ({ error: 'Invocation failed' }));
      setInvokeResult(resultBody);

      // An invocation records an action and updates health — refresh both.
      await Promise.all([
        loadHealthSummary(),
        loadHistory(historyFilters),
      ]);
    } catch (err: any) {
      setInvokeResult({ error: err.message || 'Failed to invoke capability' });
    } finally {
      setInvokeSubmitting(false);
    }
  }, [capabilityId, historyFilters, loadHealthSummary, loadHistory]);

  return (
    <PageLayout
      title={capability?.name || 'Capability detail'}
      subtitle="Operator view for capability health, certification, and recent activity"
      breadcrumbs={['Studio', 'Capabilities', capability?.name || capabilityId || 'Detail']}
      maturity="stable"
    >
      {loading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-6">
            <div className="h-32 animate-pulse rounded-xl border border-border bg-surface-secondary" />
            <div className="h-40 animate-pulse rounded-xl border border-border bg-surface-secondary" />
            <div className="h-48 animate-pulse rounded-xl border border-border bg-surface-secondary" />
          </div>
          <div className="space-y-6">
            <div className="h-48 animate-pulse rounded-xl border border-border bg-surface-secondary" />
            <div className="h-40 animate-pulse rounded-xl border border-border bg-surface-secondary" />
          </div>
        </div>
      ) : error ? (
        <EmptyState
          icon={Wrench}
          title="Capability unavailable"
          description={error}
          action={(
            <Link
              href="/capabilities"
              className="inline-flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              Back to registry
            </Link>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-6">
            <CapabilityStatusHero
              capability={capability}
              health={health}
              loading={loading}
              onRefresh={handleRefresh}
              onOpenTest={() => setTestPanelOpen(true)}
            />

            <CapabilityHealthCards health={health} />

            {healthError ? (
              <div role="alert" className="rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning">
                <span className="font-medium">Health summary unavailable.</span>{' '}
                <span>{healthError}</span>
              </div>
            ) : null}

            <CapabilityHistoryTable
              events={history}
              filters={historyFilters}
              loading={historyLoading}
              error={historyError}
              onRetry={() => loadHistory(historyFilters)}
              onFiltersChange={(patch) => {
                setHistoryFilters((current) => ({ ...current, ...patch }));
              }}
            />
          </div>

          <div className="space-y-6">
            {canTestCapability ? (
              <div className="space-y-4">
                {/* The status hero already provides the "Run test" trigger. */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInvokePanelOpen((v) => !v)}
                    aria-pressed={invokePanelOpen}
                    className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
                  >
                    {invokePanelOpen ? 'Hide invoke' : 'Invoke'}
                  </button>
                </div>
                {testPanelOpen ? (
                  <CapabilityTestPanel
                    fields={generatedTestFields}
                    isSubmitting={testSubmitting}
                    result={testResult}
                    onSubmit={handleTestSubmit}
                  />
                ) : null}
                {invokePanelOpen ? (
                  <CapabilityInvokePanel
                    fields={generatedTestFields}
                    isSubmitting={invokeSubmitting}
                    result={invokeResult}
                    onSubmit={handleInvokeSubmit}
                  />
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface-tertiary px-4 py-3 text-sm text-secondary">
                Testing and invocation are available for runnable HTTP capabilities only.
              </div>
            )}

            <CapabilityFactsCard capability={capability} health={health} />

            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
                Access rules
              </h3>
              <CapabilityAccessTab capabilityId={capabilityId} />
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
