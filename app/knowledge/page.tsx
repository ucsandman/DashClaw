'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BookOpen, Plus, RotateCw, FileText, Globe, Archive, StickyNote, Pencil, Trash2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

const sourceIcons: Record<string, React.ElementType> = {
  files: FileText,
  urls: Globe,
  external: Archive,
  notes: StickyNote,
};

const ingestionVariant: Record<string, string> = {
  empty: 'default',
  pending: 'warning',
  syncing: 'info',
  synced: 'success',
  failed: 'error',
};

function timeAgo(dateString: string | null | undefined) {
  if (!dateString) return 'never';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface CollectionCardProps {
  c?: any;
  onDelete?: (collectionId: string) => void | Promise<void>;
}

function CollectionCard({ c, onDelete }: CollectionCardProps) {
  const Icon = sourceIcons[c.source_type] || FileText;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <Card className="h-full" data-entity-type="knowledge" data-entity-id={c.collection_id} data-entity-status={c.ingestion_status}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-2 min-w-0">
            <Icon size={16} className="text-secondary mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <Link href={`/knowledge/${c.collection_id}`} className="text-sm font-semibold text-white truncate hover:text-brand block">
                {c.name}
              </Link>
              {c.description && (
                <div className="text-xs text-tertiary truncate">{c.description}</div>
              )}
            </div>
          </div>
          <Badge variant={ingestionVariant[c.ingestion_status] || 'default'}>
            {c.ingestion_status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-3 text-[10px] text-tertiary uppercase tracking-wider">
          <span>{c.doc_count} items</span>
          <span>Created {timeAgo(c.created_at)}</span>
          <span>Synced {timeAgo(c.last_synced_at)}</span>
        </div>
        {c.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {c.tags.slice(0, 3).map((tag: any) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-secondary font-mono"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-3">
          <Link
            href={`/knowledge/${c.collection_id}`}
            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-white"
            aria-label={`Edit ${c.name}`}
          >
            <Pencil size={11} /> Edit
          </Link>
          {confirmDelete ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="text-error">Delete?</span>
              <button
                onClick={async () => {
                  setDeleting(true);
                  await onDelete?.(c.collection_id);
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
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function KnowledgePage() {
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/collections?limit=100');
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections || []);
      }
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  const handleDelete = useCallback(async (collectionId: string) => {
    try {
      const res = await fetch(`/api/knowledge/collections/${collectionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to delete collection');
        return;
      }
      await fetchCollections();
    } catch (err: any) {
      setError(err.message || 'Failed to delete collection');
    }
  }, [fetchCollections]);

  const selection = useSelection<any>(collections, (c) => c.collection_id);
  useSelectAllHotkey(selection.toggleAll);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selection.count} collection${selection.count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const { ok } = await bulkAction(selection.selectedIds, (id) => fetch(`/api/knowledge/collections/${id}`, { method: 'DELETE' }));
    setCollections((prev) => prev.filter((x) => !ok.includes(x.collection_id)));
    selection.clear();
  }

  const BULK_ACTIONS = [
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: bulkDelete, danger: true },
  ];

  const createStarter = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Runbook library',
          description: 'Incident response runbooks',
          source_type: 'files',
          tags: ['ops', 'oncall'],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create collection');
      }
      await fetchCollections();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageLayout
      title="Knowledge Collections"
      subtitle="Named knowledge sources that workflows and agents can bind to"
      breadcrumbs={['Studio', 'Knowledge']}
      maturity="beta"
      actions={
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); fetchCollections(); }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <Link
              href="/knowledge/new"
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
            >
              <Plus size={14} /> New Collection
            </Link>
          </div>
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-tertiary py-12 text-center">Loading...</div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge collections yet"
          description="Collections are named containers for documents, URLs, and notes that workflows can bind to. Phase 1 is metadata-only — vector retrieval comes later."
          action={
            <Link
              href="/knowledge/new"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors"
            >
              <Plus size={14} /> Create your first collection
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
            <span className="text-xs text-tertiary">Select all</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((c) => (
              <div key={c.collection_id} className="relative">
                <div className="absolute top-2 left-2 z-10">
                  <SelectCheckbox
                    checked={selection.isSelected(c.collection_id)}
                    onToggle={(e) => { e.stopPropagation(); selection.selectClick(c.collection_id, e.shiftKey); }}
                    label={`Select ${c.name || c.collection_id}`}
                  />
                </div>
                <CollectionCard c={c} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
