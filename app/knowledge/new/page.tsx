'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, BookOpen } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';

const SOURCE_TYPES = ['files', 'urls', 'external', 'notes'];

export default function NewKnowledgeCollectionPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState('files');
  const [tagsText, setTagsText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch('/api/knowledge/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          source_type: sourceType,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create collection');
      }
      const { collection } = await res.json();
      router.push(`/knowledge/${collection.collection_id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <PageLayout
      title="New Knowledge Collection"
      subtitle="Create a named container for documents and sources"
      breadcrumbs={['Labs', 'Knowledge', 'New']}
      maturity="beta"
      actions={
        <Link href="/knowledge" className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors">
          <ArrowLeft size={14} /> Back
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        <Card>
          <CardHeader title="Collection Details" icon={BookOpen} />
          <CardContent className="p-5 pt-0 space-y-4">
            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Name <span className="text-error">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Runbook library" />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Incident response runbooks and playbooks" />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Source type</label>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand">
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Tags <span className="text-disabled">(comma-separated)</span></label>
              <input type="text" value={tagsText} onChange={(e) => setTagsText(e.target.value)}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="ops, oncall, runbooks" />
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50">
            <Save size={14} /> {saving ? 'Creating...' : 'Create Collection'}
          </button>
          <Link href="/knowledge" className="px-4 py-2 text-sm text-secondary hover:text-white transition-colors">Cancel</Link>
        </div>
      </form>
    </PageLayout>
  );
}
