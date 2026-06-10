import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface CreateThreadFormProps {
  filterAgentId?: string | null;
  onCreated: (thread: any) => void;
  onCancel: () => void;
}

export default function CreateThreadForm({ filterAgentId, onCreated, onCancel }: CreateThreadFormProps) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/messages/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          created_by: filterAgentId || 'dashboard',
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create thread');
        return;
      }
      const data = await res.json();
      setName('');
      onCreated(data.thread);
    } catch {
      setError('Failed to create thread');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mb-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-secondary uppercase tracking-wide">New Thread</span>
        <button onClick={onCancel} className="text-tertiary hover:text-secondary" aria-label="Cancel new thread">
          <X size={14} />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="Thread name..."
          maxLength={100}
          autoFocus
          className="flex-1 px-3 py-1.5 text-sm bg-surface-primary border border-white/[0.06] rounded-md text-secondary placeholder:text-disabled"
        />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
        >
          <Plus size={12} /> Create
        </button>
      </div>
      {error && <div className="text-xs text-error mt-1">{error}</div>}
    </div>
  );
}
