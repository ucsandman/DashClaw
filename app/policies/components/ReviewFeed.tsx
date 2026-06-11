'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchReview, postVerdict, type ReviewPayload, type WarnGroup } from '../lib/contractClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function decisionTone(decision: string): string {
  switch (decision.toLowerCase()) {
    case 'block': return 'text-status-error';
    case 'require_approval': return 'text-status-warning';
    default: return 'text-tertiary';
  }
}

interface GroupRowProps {
  group: WarnGroup;
  onVerdict: (group: WarnGroup, verdict: 'fine' | 'always_allow' | 'tighten') => Promise<void>;
}

function GroupRow({ group, onVerdict }: GroupRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleVerdict = async (verdict: 'fine' | 'always_allow' | 'tighten') => {
    setBusy(true);
    setError(null);
    try {
      await onVerdict(group, verdict);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <li className="py-2 space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-secondary">
          <span className="tabular-nums text-secondary font-medium">&#9658; {group.count}&times;</span>{' '}
          {group.shape.label}
        </span>
        <span className="shrink-0 tabular-nums text-xs text-tertiary">{formatRelative(group.latest_at)}</span>
      </div>
      {group.sample_goal && (
        <p className="text-xs text-tertiary pl-4 truncate">{group.sample_goal}</p>
      )}
      <div className="flex items-center gap-3 pl-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleVerdict('fine')}
          className="text-xs text-tertiary transition-colors hover:text-secondary disabled:opacity-50 motion-reduce:transition-none"
        >
          Fine
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleVerdict('always_allow')}
          className="text-xs text-tertiary transition-colors hover:text-secondary disabled:opacity-50 motion-reduce:transition-none"
        >
          Always allow
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleVerdict('tighten')}
          className="text-xs text-status-warning transition-colors hover:opacity-80 disabled:opacity-50 motion-reduce:transition-none"
        >
          Tighten
        </button>
      </div>
      {error && <p className="pl-4 text-xs text-status-error">{error}</p>}
    </li>
  );
}

/**
 * Review feed — warn-grouped actions that need a verdict.
 * Loads from GET /api/policies/review and posts verdicts via
 * POST /api/policies/review/verdict.
 */
export default function ReviewFeed() {
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Optimistically removed group keys while verdicts are in-flight.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchReview();
      setData(payload);
      setDismissed(new Set());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleVerdict = useCallback(
    async (group: WarnGroup, verdict: 'fine' | 'always_allow' | 'tighten') => {
      // Optimistically remove the row.
      setDismissed((prev) => new Set([...prev, group.shape.key]));
      await postVerdict(verdict, { action_type: group.shape.action_type, target_prefix: group.shape.target_prefix ?? null });
      // On success, keep dismissed. Error is thrown to GroupRow for inline display.
    },
    [],
  );

  const handleMarkAll = useCallback(async () => {
    await postVerdict('mark_all_reviewed');
    await load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-between border-t border-border py-4 text-sm">
        <span className="text-tertiary">Couldn&apos;t load review feed.</span>
        <button onClick={load} className="text-brand hover:underline text-xs">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  const visibleGroups = data.groups.filter((g) => !dismissed.has(g.shape.key));
  const totalCount = data.groups.length;
  const cursorDate = data.cursor ? new Date(data.cursor).toLocaleDateString() : '';

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={SECTION_LABEL}>
          To review
          {totalCount > 0 && (
            <span className="ml-1.5 normal-case font-sans text-tertiary tabular-nums">
              &middot; <span className="tabular-nums">{totalCount}</span> recorded since {cursorDate}
            </span>
          )}
        </span>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
          >
            Mark all reviewed
          </button>
        )}
      </div>

      {/* Warn groups */}
      {visibleGroups.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {visibleGroups.map((group) => (
            <GroupRow key={group.shape.key} group={group} onVerdict={handleVerdict} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          Nothing to review — your agents stayed inside the contract.
        </p>
      )}

      {/* Interrupted you section */}
      {data.interrupts.length > 0 && (
        <div className="mt-6">
          <span className={SECTION_LABEL}>
            Interrupted you (<span className="tabular-nums">{data.interrupts.length}</span>)
          </span>
          <ul className="mt-2 divide-y divide-border">
            {data.interrupts.map((row, i) => {
              const decision = String(row.decision ?? '');
              const agentLabel = String(row.agent_name ?? row.agent_id ?? 'agent');
              const actionType = String(row.action_type ?? '');
              const createdAt = String(row.created_at ?? '');
              const id = String(row.id ?? i);
              return (
                <li key={id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className={`shrink-0 font-mono text-xs uppercase ${decisionTone(decision)}`}>
                    {decision.toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate text-secondary">{agentLabel}</span>
                  <span className="shrink-0 text-tertiary">{actionType}</span>
                  <span className="shrink-0 tabular-nums text-xs text-tertiary">{formatRelative(createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
