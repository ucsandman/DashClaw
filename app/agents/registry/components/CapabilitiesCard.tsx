'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none';

interface Capability {
  capability_id: string;
  name: string;
  risk_level: string;
}

interface CapabilitiesCardProps {
  agentId: string;
  capabilities?: Capability[];
  onChange?: (next: Capability[]) => void;
}

/**
 * Capabilities grouped under a registered agent, plus an "Add capability" picker
 * sourced from /api/capabilities (already-grouped ones filtered out). Calls
 * onChange(nextCapabilities) so the parent can refresh the detail view.
 */
export default function CapabilitiesCard({ agentId, capabilities = [], onChange }: CapabilitiesCardProps) {
  const [allCapabilities, setAllCapabilities] = useState<Capability[]>([]);
  const [picked, setPicked] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/capabilities');
        if (res.ok && !cancelled) setAllCapabilities((await res.json()).capabilities || []);
      } catch { /* picker stays empty if the fetch fails */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setPicked(''); setError(null); }, [agentId]);

  const groupedIds = useMemo(() => new Set(capabilities.map((c) => c.capability_id)), [capabilities]);
  const available = useMemo(
    () => allCapabilities.filter((c) => !groupedIds.has(c.capability_id)),
    [allCapabilities, groupedIds],
  );
  const pickedCapability = available.find((c) => c.capability_id === picked);

  const handleAdd = async () => {
    if (!picked) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/registry/${agentId}/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability_id: picked }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Failed to add capability'); return; }
      setPicked('');
      onChange?.(json.capabilities || []);
    } catch {
      setError('Failed to add capability');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card>
      <div className="border-b border-border px-5 py-3 text-sm font-semibold text-white">Capabilities</div>
      <CardContent>
        {capabilities.length === 0 ? (
          <p className="text-xs text-tertiary">No capabilities grouped under this agent yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {capabilities.map((c) => (
              <li key={c.capability_id} className="flex items-center justify-between text-xs">
                <span className="text-secondary">{c.name}</span>
                <Badge size="xs">{c.risk_level}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Add capability</div>
          {allCapabilities.length === 0 ? (
            <p className="text-xs text-tertiary">
              No capabilities exist in this workspace yet.{' '}
              <Link href="/capabilities/new" className="text-brand hover:underline">Create your first capability</Link>{' '}
              (endpoint + auth + schema), then group it here.
            </p>
          ) : available.length === 0 ? (
            <p className="text-xs text-tertiary">All capabilities are already grouped under this agent.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <select value={picked} onChange={(e) => setPicked(e.target.value)} className={`${INPUT_CLASS} flex-1`}>
                <option value="">Select a capability…</option>
                {available.map((c) => (
                  <option key={c.capability_id} value={c.capability_id}>{c.name}</option>
                ))}
              </select>
              {pickedCapability && <Badge size="xs">{pickedCapability.risk_level}</Badge>}
              <button onClick={handleAdd} disabled={adding || !picked}
                className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
