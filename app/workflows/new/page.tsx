'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import WorkflowStepBuilder from '../components/WorkflowStepBuilder';
import WorkflowReferenceHelp from '../components/WorkflowReferenceHelp';
import WorkflowLinkedResourcesSection from '../components/WorkflowLinkedResourcesSection';
import WorkflowAiDraftPanel from '../components/WorkflowAiDraftPanel';
import { compileWorkflowDraftPayload, createDefaultWorkflowDraft } from '../lib/workflowDraftFormModel.js';
import { normalizeGeneratedWorkflowDraft } from '../lib/workflowAiDrafts.js';
import { loadWorkflowBuilderResources, mergeWorkflowBuilderResourceOptions } from '../lib/workflowBuilderResources.js';

export default function NewWorkflowTemplatePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [resourceError, setResourceError] = useState(false);
  const [resources, setResources] = useState<any>({
    modelStrategies: [],
    policies: [],
    knowledgeCollections: [],
    capabilities: [],
    promptTemplates: [],
    errors: [],
  });
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [draft, setDraft] = useState<any>(createDefaultWorkflowDraft());

  useEffect(() => {
    let active = true;

    loadWorkflowBuilderResources()
      .then((nextResources) => {
        if (!active) return;
        setResources(nextResources);
        setResourceError(nextResources.errors.length > 0);
      })
      .catch(() => {
        if (!active) return;
        setResourceError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const update = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft((prev: any) => ({ ...prev, [key]: event.target.value }));
  const updateDraft = (patch: Record<string, any>) => setDraft((prev: any) => ({ ...prev, ...patch }));
  const mergedResources = mergeWorkflowBuilderResourceOptions(resources, draft);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError('Name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/workflows/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compileWorkflowDraftPayload(draft)),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create template');
      }

      const { template } = await res.json();
      router.push(`/workflows/${template.template_id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  const handleGenerateDraft = async (requestPayload: any) => {
    setGeneratingDraft(true);
    setDraftError(null);
    setDraftNotes([]);

    try {
      const res = await fetch('/api/workflows/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: requestPayload.description,
          api_key: requestPayload.apiKey,
          provider: requestPayload.provider,
          model: requestPayload.model,
          prefer_existing_resources: requestPayload.preferExistingResources,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setDraftError(data.error || 'Failed to generate workflow draft');
        return;
      }

      const normalized = normalizeGeneratedWorkflowDraft(data.draft, mergedResources);
      setDraft((prev: any) => createDefaultWorkflowDraft({
        ...prev,
        ...normalized.draft,
      }));
      setDraftNotes([...(data.warnings || []), ...normalized.notes]);
      setShowAiPanel(false);
    } catch (err: any) {
      setDraftError(err.message);
    } finally {
      setGeneratingDraft(false);
    }
  };

  return (
    <PageLayout
      title="New Workflow Template"
      subtitle="Define a reusable, versioned operational pattern"
      breadcrumbs={['Labs', 'Workflows', 'New']}
      maturity="beta"
      actions={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAiPanel((value) => !value)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
          >
            <Sparkles size={14} /> {showAiPanel ? 'Hide AI Draft' : 'Generate with AI'}
          </button>
          <Link
            href="/workflows"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </Link>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
        <div className="rounded-xl border border-active/20 bg-brand/10 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-orange-100">Prefer to describe the workflow instead?</div>
              <p className="mt-1 text-sm text-orange-200/80">
                Use AI to draft the workflow basics, linked resources, and executable steps into this editor, then review and save it manually.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAiPanel((value) => !value)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand/90"
            >
              <Sparkles size={14} />
              {showAiPanel ? 'Hide AI Draft Builder' : 'Open AI Draft Builder'}
            </button>
          </div>
        </div>

        {showAiPanel && (
          <WorkflowAiDraftPanel
            loading={generatingDraft}
            error={draftError}
            onGenerate={handleGenerateDraft}
          />
        )}

        {draftNotes.length > 0 && (
          <div className="rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
            <div className="font-medium text-amber-200 mb-1">Draft review notes</div>
            <ul className="space-y-1">
              {draftNotes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          </div>
        )}

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                aria-label="Name"
                value={draft.name}
                onChange={update('name')}
                required
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Release hotfix workflow"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
                Slug <span className="text-disabled">(auto-generated if blank)</span>
              </label>
              <input
                type="text"
                value={draft.slug}
                onChange={update('slug')}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-brand"
                placeholder="release-hotfix"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                value={draft.description}
                onChange={update('description')}
                rows={2}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Short summary shown on the template card"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
                Objective
              </label>
              <textarea
                value={draft.objective}
                onChange={update('objective')}
                rows={3}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Declared goal for runs launched from this template"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                value={draft.status}
                onChange={update('status')}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <WorkflowLinkedResourcesSection
          draft={draft}
          resourceOptions={mergedResources}
          onChange={updateDraft}
        />

        <Card>
          <div className="px-5 pt-5 pb-3">
            <span className="text-sm font-medium text-secondary uppercase tracking-wider">Steps</span>
            <span className="text-xs text-tertiary ml-2">Build a real ordered sequence of executable workflow steps.</span>
          </div>
          <CardContent className="p-5 pt-0">
            <div className="space-y-4">
              {resourceError && (
                <div className="px-4 py-3 rounded-lg bg-warning-subtle border border-warning/20 text-sm text-warning">
                  Some workflow resources could not be loaded. You can still author the workflow, but some selectors may be incomplete.
                </div>
              )}
              <WorkflowStepBuilder
                steps={draft.steps}
                onChange={(nextSteps: any) => updateDraft({ steps: nextSteps })}
                resourceOptions={mergedResources}
              />
              <WorkflowReferenceHelp />
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Creating...' : 'Create Template'}
          </button>
          <Link
            href="/workflows"
            className="px-4 py-2 text-sm text-secondary hover:text-white transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </PageLayout>
  );
}
