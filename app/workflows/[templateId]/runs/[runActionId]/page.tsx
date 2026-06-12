'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import PageLayout from '../../../../components/PageLayout';
import WorkflowRunHeader from './components/WorkflowRunHeader';
import WorkflowRunTimeline from './components/WorkflowRunTimeline';
import ArtifactsTab from '../../../../components/ArtifactsTab';
import Link from 'next/link';

export default function WorkflowRunDetailPage() {
  const { templateId, runActionId } = useParams<{ templateId: string; runActionId: string }>();
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/runs/${runActionId}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'not_found' : 'fetch_failed');
        return null;
      }
      const data = await res.json();
      setRun(data);
      setError(null);
      return data;
    } catch {
      setError('fetch_failed');
      return null;
    } finally {
      setLoading(false);
    }
  }, [templateId, runActionId]);

  // Poll while the run is still executing so the timeline advances live
  // instead of freezing on the first snapshot (a run can take up to ~2 min).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const data = await loadRun();
      if (cancelled) return;
      if (data && (data.status === 'running' || data.status === 'pending')) {
        timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadRun]);

  async function handleCancel() {
    setCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/runs/${runActionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err.message || 'Cancel failed');
      }
      await loadRun();
    } catch {
      setActionError('Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  async function handleResume(stepId?: any) {
    // The header's Resume button passes a click event; only a string is a
    // real step_id (the per-step "Resume from here" affordance).
    const fromStep = typeof stepId === 'string' ? stepId : null;
    setResuming(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/runs/${runActionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromStep ? { from_step: fromStep } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/workflows/${templateId}/runs/${data.action_id}`;
      } else {
        const err = await res.json().catch(() => ({}));
        setActionError(err.message || 'Resume failed');
      }
    } catch {
      setActionError('Resume failed');
    } finally {
      setResuming(false);
    }
  }

  if (loading) {
    return (
      <PageLayout title="Loading run...">
        <div className="motion-safe:animate-pulse text-tertiary text-sm">Loading workflow run...</div>
      </PageLayout>
    );
  }

  if (error === 'not_found') {
    return (
      <PageLayout title="Run not found">
        <div className="text-center py-12">
          <p className="text-secondary mb-4">This workflow run was not found.</p>
          <Link href={`/workflows/${templateId}`} className="text-info hover:text-info text-sm">
            Back to workflow
          </Link>
        </div>
      </PageLayout>
    );
  }

  if (error || !run) {
    return (
      <PageLayout title="Error">
        <div className="text-center py-12">
          <p className="text-error mb-4">Failed to load workflow run.</p>
          <button onClick={() => window.location.reload()} className="text-info hover:text-info text-sm">
            Retry
          </button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={run.template_name || 'Workflow Run'} maturity="beta">
      <div className="space-y-8">
        {actionError && (
          <div role="alert" className="rounded-lg border border-border bg-error-subtle p-3 text-sm text-error">
            {actionError}
          </div>
        )}
        <WorkflowRunHeader run={run} templateId={templateId} onResume={handleResume} resuming={resuming} onCancel={handleCancel} cancelling={cancelling} />
        <div>
          <h2 className="text-sm font-medium text-secondary mb-3">Steps</h2>
          <WorkflowRunTimeline steps={run.steps} runStatus={run.status} onResumeFromStep={handleResume} />
        </div>
        <div>
          <h2 className="text-sm font-medium text-secondary mb-3">Artifacts</h2>
          <ArtifactsTab actionId={runActionId} />
        </div>
      </div>
    </PageLayout>
  );
}
