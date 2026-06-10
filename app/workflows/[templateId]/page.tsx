'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Rocket, Copy, FileText, Cpu, CheckCircle2, ChevronRight,
} from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import WorkflowStepBuilder from '../components/WorkflowStepBuilder';
import WorkflowStepLegacyNotice from '../components/WorkflowStepLegacyNotice';
import WorkflowReferenceHelp from '../components/WorkflowReferenceHelp';
import WorkflowLinkedResourcesSection from '../components/WorkflowLinkedResourcesSection';
import { normalizeWorkflowStepData, sanitizeExecutableSteps } from '../lib/workflowStepFormModel.js';
import { loadWorkflowBuilderResources, mergeWorkflowBuilderResourceOptions } from '../lib/workflowBuilderResources.js';
import { compileWorkflowDraftPayload, createDefaultWorkflowDraft, decompileWorkflowTemplateToDraft } from '../lib/workflowDraftFormModel.js';

const statusVariant: Record<string, string> = {
  draft: 'default',
  active: 'success',
  archived: 'info',
};

export default function WorkflowTemplateDetailPage() {
  const router = useRouter();
  const { templateId } = useParams<{ templateId: string }>();
  const [template, setTemplate] = useState<any>(null);
  const [draft, setDraft] = useState<any>(createDefaultWorkflowDraft());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [stepsView, setStepsView] = useState('builder');
  const [savingSteps, setSavingSteps] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsStatus, setRunsStatus] = useState('all');
  const [savingLinks, setSavingLinks] = useState(false);
  const [workflowResources, setWorkflowResources] = useState<any>({
    modelStrategies: [],
    policies: [],
    knowledgeCollections: [],
    capabilities: [],
    promptTemplates: [],
    errors: [],
  });

  const fetchTemplate = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Template not found');
          return;
        }
        throw new Error('Failed to fetch template');
      }
      const { template: nextTemplate } = await res.json();
      setTemplate(nextTemplate);
      setDraft(decompileWorkflowTemplateToDraft(nextTemplate));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const qs = runsStatus === 'all' ? '' : `&status=${runsStatus}`;
      const res = await fetch(`/api/workflows/templates/${templateId}/runs?limit=10${qs}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
        setRunsTotal(typeof data.total === 'number' ? data.total : (data.runs || []).length);
      }
    } catch {
      // ignore
    } finally {
      setRunsLoading(false);
    }
  }, [templateId, runsStatus]);

  useEffect(() => {
    if (templateId) {
      fetchTemplate();
      loadRuns();
    }
  }, [templateId, fetchTemplate, loadRuns]);

  useEffect(() => {
    let active = true;
    if (!templateId) return undefined;

    loadWorkflowBuilderResources()
      .then((resources) => {
        if (!active) return;
        setWorkflowResources(resources);
      })
      .catch(() => {
        if (!active) return;
        setWorkflowResources({
          modelStrategies: [],
          policies: [],
          knowledgeCollections: [],
          capabilities: [],
          promptTemplates: [],
          errors: ['load_failed'],
        });
      });

    return () => {
      active = false;
    };
  }, [templateId]);

  // Run the workflow through the governed executor (/execute). Unlike /launch
  // (which only records an action), this evaluates guard + quota, runs every
  // step, persists step results + artifacts, and returns the run action_id.
  // On any outcome that produced a run we navigate to its timeline; policy
  // blocks / quota / no-steps have no run, so they surface inline.
  const handleRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));

      if (data.action_id) {
        // success OR failed-with-steps — the run timeline shows the outcome
        router.push(`/workflows/${templateId}/runs/${data.action_id}`);
        return;
      }

      let message;
      if (data.error === 'blocked_by_policy') {
        const reasons = (data.guard_decision?.reasons || []).join('; ');
        message = `Blocked by policy${reasons ? `: ${reasons}` : ''}`;
      } else if (data.error === 'quota_exceeded') {
        message = data.message || 'Monthly workflow execution limit exceeded.';
      } else if (data.error === 'workflow_has_no_steps') {
        message = 'This workflow has no executable steps yet — add steps in the builder first.';
      } else {
        message = data.error || 'Workflow execution failed.';
      }
      setRunError(message);
      loadRuns();
    } catch (err: any) {
      setRunError(err.message || 'Workflow execution failed.');
    } finally {
      setRunning(false);
    }
  };

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { template: dup } = await res.json();
        router.push(`/workflows/${dup.template_id}`);
        return;
      }
    } catch {
      // noop
    }
    setDuplicating(false);
  };

  if (loading) {
    return (
      <PageLayout title="Loading..." breadcrumbs={['Labs', 'Workflows']}>
        <div className="text-sm text-tertiary py-12 text-center">Loading...</div>
      </PageLayout>
    );
  }

  if (error || !template) {
    return (
      <PageLayout title="Template Not Found" breadcrumbs={['Labs', 'Workflows', templateId]}>
        <Card className="max-w-md mx-auto mt-12">
          <CardContent className="p-6 text-center">
            <div className="text-lg font-medium text-white mb-2">{error || 'Template not found'}</div>
            <div className="text-sm text-tertiary">{templateId}</div>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const persistedStepData = normalizeWorkflowStepData(template.steps);
  const stepData = persistedStepData.mode === 'legacy'
    ? persistedStepData
    : normalizeWorkflowStepData(draft.steps);
  const mergedWorkflowResources = mergeWorkflowBuilderResourceOptions(workflowResources, draft);
  const visibleStepCount = stepData.mode === 'builder'
    ? stepData.steps.length
    : (stepData.legacyFallback?.nodeCount || 0);

  return (
    <PageLayout
      title={template.name}
      subtitle={template.description || 'Workflow template'}
      breadcrumbs={['Labs', 'Workflows', template.slug]}
      maturity="beta"
      actions={(
        <div className="flex items-center gap-2">
          <Link
            href="/workflows"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <Copy size={14} /> {duplicating ? 'Duplicating...' : 'Duplicate'}
          </button>
          <button
            onClick={handleRun}
            disabled={running}
            aria-busy={running}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50"
          >
            <Rocket size={14} aria-hidden="true" /> {running ? 'Running…' : 'Run'}
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold text-white">v{template.version}</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Version</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="p-4 text-center">
            <Badge variant={statusVariant[template.status] || 'default'} size="sm">{template.status}</Badge>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-2">Status</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold text-white">{visibleStepCount}</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Steps</div>
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="p-4 text-center">
            <div className="text-xs font-mono text-secondary truncate">{template.slug}</div>
            <div className="text-[10px] text-tertiary uppercase tracking-wider mt-1">Slug</div>
          </CardContent>
        </Card>
      </div>

      {running && (
        <div role="status" className="mb-6 px-4 py-3 rounded-lg bg-surface-tertiary border border-border text-sm text-secondary">
          Running workflow steps through the governed executor… this can take up to two minutes.
        </div>
      )}
      {runError && (
        <div role="alert" className="mb-6 px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {runError}
        </div>
      )}

      <Card className="mb-4">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-secondary uppercase tracking-wider">Steps</span>
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() => setStepsView('builder')}
                disabled={stepData.mode !== 'builder'}
                className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${stepsView === 'builder' ? 'bg-brand text-white' : 'text-secondary hover:text-white'} disabled:opacity-40 disabled:hover:text-secondary`}
              >
                Builder
              </button>
              <button
                onClick={() => setStepsView('source')}
                className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${stepsView === 'source' ? 'bg-brand text-white' : 'text-secondary hover:text-white'}`}
              >
                Source
              </button>
              <button
                onClick={() => setStepsView('runs')}
                className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${stepsView === 'runs' ? 'bg-brand text-white' : 'text-secondary hover:text-white'}`}
              >
                Runs
              </button>
            </div>
          </div>
          {stepData.mode === 'builder' && stepsView !== 'runs' && (
            <button
              onClick={async () => {
                setSavingSteps(true);
                try {
                  const res = await fetch(`/api/workflows/templates/${templateId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ steps: sanitizeExecutableSteps(draft.steps) }),
                  });
                  if (res.ok) {
                    await fetchTemplate();
                  }
                } catch {
                  // noop
                }
                setSavingSteps(false);
              }}
              disabled={savingSteps}
              className="px-3 py-1.5 text-xs text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50"
            >
              {savingSteps ? 'Saving...' : 'Save Steps'}
            </button>
          )}
        </div>
        <CardContent className="p-5 pt-0">
          {stepsView === 'runs' ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <select
                  value={runsStatus}
                  onChange={(e) => setRunsStatus(e.target.value)}
                  aria-label="Filter runs by status"
                  className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-white focus:border-brand/50 focus:outline-none"
                >
                  <option value="all">All runs</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <span className="ml-auto text-xs text-tertiary tabular-nums">{runs.length} of {runsTotal} shown</span>
              </div>
              {runsLoading ? (
              <div className="text-sm text-tertiary py-4">Loading runs...</div>
            ) : runs.length === 0 ? (
              <div className="text-sm text-tertiary py-8 text-center">
                No runs yet. Press <span className="text-secondary">Run</span> to execute this workflow, or trigger it from the SDK or API.
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <Link
                    key={run.run_action_id}
                    href={`/workflows/${templateId}/runs/${run.run_action_id}`}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-white/[0.02] transition-colors"
                  >
                    <span aria-hidden="true" className={`w-2 h-2 rounded-full flex-shrink-0 ${run.status === 'completed' ? 'bg-status-success' : run.status === 'failed' ? 'bg-status-error' : 'bg-status-info'}`} />
                    <span className={`text-xs font-medium flex-shrink-0 ${run.status === 'completed' ? 'text-success' : run.status === 'failed' ? 'text-error' : 'text-info'}`}>{run.status}</span>
                    <span className="text-sm text-secondary flex-1 truncate">{run.declared_goal || 'Workflow run'}</span>
                    <span className="text-xs text-tertiary">{run.steps_completed}/{run.step_count} steps</span>
                    {run.duration_ms != null && <span className="text-xs font-mono text-tertiary">{(run.duration_ms / 1000).toFixed(1)}s</span>}
                    <span className="text-xs text-disabled">{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</span>
                  </Link>
                ))}
              </div>
              )}
            </>
          ) : (
            <>
              {workflowResources.errors?.length > 0 && stepData.mode === 'builder' && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-warning-subtle border border-warning/20 text-sm text-warning">
                  Some workflow resources could not be loaded. Saved values are preserved, but some selectors may be incomplete.
                </div>
              )}
              {stepsView === 'builder' ? (
                stepData.mode === 'builder' ? (
                  <div className="space-y-4">
                    <WorkflowStepBuilder
                      steps={stepData.steps}
                      onChange={(nextSteps: any) => setDraft((prev: any) => ({ ...prev, steps: nextSteps }))}
                      resourceOptions={mergedWorkflowResources}
                    />
                    <WorkflowReferenceHelp />
                  </div>
                ) : (
                  <WorkflowStepLegacyNotice legacyFallback={stepData.legacyFallback} />
                )
              ) : (
                <RawJsonBlock
                  label="Raw JSON (advanced)"
                  value={stepData.mode === 'builder' ? draft.steps : template.steps}
                  maxHeightClass="max-h-[420px]"
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Objective" icon={FileText} />
          <CardContent className="p-5 pt-0">
            <div className="text-sm text-secondary whitespace-pre-wrap">
              {template.objective || <span className="text-tertiary">No objective defined.</span>}
            </div>
          </CardContent>
        </Card>

        <WorkflowLinkedResourcesSection
          draft={draft}
          resourceOptions={mergedWorkflowResources}
          onChange={(patch: Record<string, any>) => setDraft((prev: any) => ({ ...prev, ...patch }))}
          saveAction={{
            label: savingLinks ? 'Saving linked resources...' : 'Save linked resources',
            disabled: savingLinks,
            onClick: async () => {
              setSavingLinks(true);
              try {
                const payload = compileWorkflowDraftPayload(draft);
                const res = await fetch(`/api/workflows/templates/${templateId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model_strategy_id: payload.model_strategy_id,
                    linked_policy_ids: payload.linked_policy_ids,
                    linked_knowledge_collection_ids: payload.linked_knowledge_collection_ids,
                    linked_capability_ids: payload.linked_capability_ids,
                    linked_prompt_template_ids: payload.linked_prompt_template_ids,
                    linked_capability_tags: payload.linked_capability_tags,
                  }),
                });
                if (res.ok) {
                  await fetchTemplate();
                }
              } catch {
                // noop
              }
              setSavingLinks(false);
            },
          }}
        />
      </div>

      {template.model_strategy_snapshot && (
        <Card className="mt-4">
          <CardHeader title="Last launched strategy snapshot" icon={Cpu} />
          <CardContent className="p-5 pt-0">
            <ModelStrategySnapshot snapshot={template.model_strategy_snapshot} />
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}

interface RawJsonBlockProps {
  label: string;
  value: any;
  maxHeightClass?: string;
}

// Collapsible raw-JSON block with a Copy button. Used for the deliberate
// builder/raw "Source" toggle where the JSON is meant to be read/copied, not
// parsed visually.
function RawJsonBlock({ label, value, maxHeightClass = 'max-h-[320px]' }: RawJsonBlockProps) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable: silent fail
    }
  }, [json]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-tertiary transition-colors hover:text-secondary"
          aria-label={`Copy ${label}`}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <CheckCircle2 size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`text-xs text-secondary bg-black/40 rounded-lg p-3 overflow-auto font-mono ${maxHeightClass}`}>
        {json}
      </pre>
    </div>
  );
}

// Renders the model-strategy snapshot as labeled governance fields (provider,
// model, fallback chain, budget) and keeps a collapsed raw view for completeness.
function ModelStrategySnapshot({ snapshot }: { snapshot: any }) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return <RawJsonBlock label="Raw snapshot" value={snapshot} />;
  }
  const provider = snapshot.provider ?? snapshot.primary_provider;
  const model = snapshot.model ?? snapshot.primary_model;
  const budget = snapshot.budget ?? snapshot.budget_usd ?? snapshot.max_cost ?? snapshot.cost_cap;
  // Fallback chain can arrive under a few shapes; normalize to a readable list.
  const rawFallback = snapshot.fallback_chain ?? snapshot.fallbacks ?? snapshot.fallback;
  const fallbackChain = Array.isArray(rawFallback)
    ? rawFallback.map((f) => (typeof f === 'string' ? f : (f?.model ?? f?.name ?? JSON.stringify(f))))
    : (typeof rawFallback === 'string' ? [rawFallback] : null);

  const fields: [string, any][] = [
    ['Provider', provider],
    ['Model', model],
    ['Budget', budget != null ? (typeof budget === 'number' ? `$${budget}` : String(budget)) : undefined],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '') as [string, any][];

  const hasStructured = fields.length > 0 || (fallbackChain && fallbackChain.length > 0);

  return (
    <div className="space-y-4">
      {hasStructured && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">{label}</dt>
              <dd className="break-words font-mono text-xs text-secondary">{String(value)}</dd>
            </div>
          ))}
          {fallbackChain && fallbackChain.length > 0 && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">Fallback chain</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {fallbackChain.map((f, i) => (
                  <span key={`${f}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <ChevronRight size={12} className="text-disabled" />}
                    <Badge variant="default" size="xs">{f}</Badge>
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
      <details className="group">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
          Raw snapshot
        </summary>
        <pre className="mt-2 text-xs text-secondary bg-black/40 rounded-lg p-3 overflow-auto max-h-[320px] font-mono">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}
