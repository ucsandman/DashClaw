'use client';

import { useEffect, useState, useCallback } from 'react';
import { Layers } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { useEffectiveRole } from '../../hooks/useEffectiveRole';
import { fetchModes } from '../lib/modesClient';
import type { PolicyModeSummary } from '../lib/modesClient';
import ModeCard from './ModeCard';
import ModeDetailPanel from './ModeDetailPanel';

export default function ModesTab() {
  const { isAdmin, settled } = useEffectiveRole();
  const [modes, setModes] = useState<PolicyModeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchModes()
      .then((m) => {
        setModes(m);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = modes.find((m) => m.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return <EmptyState icon={Layers} title="Couldn't load modes" description={error} />;
  }

  if (modes.length === 0) {
    return <EmptyState icon={Layers} title="No modes available" description="The built-in mode catalog returned no entries." />;
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-xs leading-relaxed text-tertiary">
        Choose an operating mode. Each mode compiles to a pack of guard policies you can preview before
        applying — no need to author policy types by hand. Applying a mode is additive; your existing
        policies and raw YAML import are unaffected.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((m) => (
          <ModeCard key={m.id} mode={m} selected={m.id === selectedId} onSelect={() => setSelectedId(m.id)} />
        ))}
      </div>

      {selected && <ModeDetailPanel mode={selected} isAdmin={isAdmin} settled={settled} onApplied={load} />}
    </div>
  );
}
