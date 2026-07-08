'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileJson, Package, ChevronDown, ChevronRight, Trash2, Copy, Check } from 'lucide-react';
import MarkdownBody from './MarkdownBody';

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-tertiary px-2 py-1 text-[10px] font-medium text-tertiary transition-colors hover:text-secondary hover:border-border-hover"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

const MARKDOWN_TYPES = new Set(['report', 'markdown', 'md', 'transcript']);

function isMarkdownArtifact(type: unknown): boolean {
  if (!type) return false;
  return MARKDOWN_TYPES.has(String(type).toLowerCase());
}

const TYPE_PILL: Record<string, string> = {
  json: 'bg-blue-400/10 text-info border-blue-400/20',
  evidence_bundle: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
  report: 'bg-emerald-400/10 text-success border-success/20',
  file: 'bg-zinc-400/10 text-secondary border-zinc-400/20',
  transcript: 'bg-amber-400/10 text-warning border-warning/20',
  patch: 'bg-orange-400/10 text-brand border-active/20',
};

interface ArtifactRowProps {
  artifact: any;
  onDelete: (artifactId: string) => void;
  deleting: boolean;
}

function ArtifactRow({ artifact, onDelete, deleting }: ArtifactRowProps) {
  const [expanded, setExpanded] = useState(false);
  const pill = TYPE_PILL[artifact.artifact_type] || TYPE_PILL.file;

  return (
    <div className="rounded-lg border border-border bg-white/[0.02]">
      <div className="flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-3 px-4 py-3 text-left"
        >
          <FileJson className="w-4 h-4 text-tertiary flex-shrink-0" />
          <span className="text-sm text-secondary flex-1">{artifact.name}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${pill}`}>
            {artifact.artifact_type}
          </span>
          <span className="text-[10px] text-disabled">
            {artifact.created_at ? new Date(artifact.created_at).toLocaleString() : ''}
          </span>
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-tertiary" />
          ) : (
            <ChevronRight className="w-3 h-3 text-tertiary" />
          )}
        </button>
        <button
          onClick={() => onDelete(artifact.artifact_id)}
          disabled={deleting}
          aria-label={`Delete ${artifact.name}`}
          className="mr-2 rounded p-1.5 text-tertiary transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {expanded && artifact.content != null && (() => {
        const isString = typeof artifact.content === 'string';
        const text = isString ? artifact.content : JSON.stringify(artifact.content, null, 2);
        const renderMarkdown = isString && isMarkdownArtifact(artifact.artifact_type);
        return (
          <div className="px-4 pb-4 border-t border-border">
            <div className="mt-3 mb-2 flex justify-end">
              <CopyButton text={text} />
            </div>
            {renderMarkdown ? (
              <MarkdownBody content={text} className="max-h-48 overflow-auto" />
            ) : (
              <pre className="text-xs text-secondary bg-black/30 rounded p-2 overflow-auto max-h-48">
                {text}
              </pre>
            )}
          </div>
        );
      })()}
    </div>
  );
}

interface ArtifactsTabProps {
  actionId: string;
}

export default function ArtifactsTab({ actionId }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bundleSummary, setBundleSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/actions/${actionId}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.artifacts || []);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [actionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerateBundle() {
    setGenerating(true);
    setError(null);
    setBundleSummary(null);
    try {
      const res = await fetch('/api/artifacts/evidence-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_id: actionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === 'action_not_found' ? 'Action not found.' : (data.error || 'Failed to generate evidence bundle.'));
        return;
      }
      // Surface the assembled bundle the endpoint returns (previously discarded).
      // The endpoint now returns a signed envelope; the bundle content is under `payload`.
      const payload = (data.payload || data) as Record<string, any>;
      setBundleSummary({
        steps: Array.isArray(payload.steps) ? payload.steps.length : 0,
        artifacts: Array.isArray(payload.artifacts) ? payload.artifacts.length : 0,
        generated_at: payload.generated_at,
      });
      // Refresh artifacts list to show the new bundle
      const listRes = await fetch(`/api/actions/${actionId}/artifacts`);
      if (listRes.ok) {
        const list = await listRes.json();
        setArtifacts(list.artifacts || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate evidence bundle.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(artifactId: string) {
    setDeletingId(artifactId);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifactId}`, { method: 'DELETE' });
      if (res.ok) {
        setArtifacts((prev) => prev.filter((a) => a.artifact_id !== artifactId));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error === 'artifact_not_found' ? 'Artifact not found.' : 'Failed to delete artifact.');
      }
    } catch {
      setError('Failed to delete artifact.');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-tertiary py-4">Loading artifacts...</div>;
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-border bg-surface-secondary py-12 text-center">
        <div className="text-sm text-error mb-3">Failed to load artifacts.</div>
        <button
          onClick={load}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-tertiary">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleGenerateBundle}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors disabled:opacity-50"
        >
          <Package className="w-3 h-3" />
          {generating ? 'Generating...' : 'Generate Evidence Bundle'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {bundleSummary && (
        <div role="status" className="rounded-lg border border-success/20 bg-success-subtle px-3 py-2 text-xs text-success">
          Evidence bundle generated: {bundleSummary.steps} step{bundleSummary.steps === 1 ? '' : 's'}, {bundleSummary.artifacts} artifact{bundleSummary.artifacts === 1 ? '' : 's'}
          {bundleSummary.generated_at ? ` · ${new Date(bundleSummary.generated_at).toLocaleString()}` : ''}.
        </div>
      )}

      {artifacts.length === 0 ? (
        <div className="text-sm text-tertiary py-8 text-center">
          No artifacts linked to this action yet.
        </div>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactRow
              key={a.artifact_id}
              artifact={a}
              onDelete={handleDelete}
              deleting={deletingId === a.artifact_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
