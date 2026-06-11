'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchReview, postVerdict, type ReviewPayload, type WarnGroup } from '../lib/contractClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';
const VERDICT_TYPES = ['fine', 'always_allow', 'tighten'] as const;

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

type VerdictType = (typeof VERDICT_TYPES)[number];

interface GroupRowProps {
  group: WarnGroup;
  /** Called by the parent; parent owns optimistic dismiss + error state. */
  onVerdict: (group: WarnGroup, verdict: VerdictType) => void;
  /** Inline error to display (set by parent on POST failure). */
  verdictError?: string | null;
}

function GroupRow({ group, onVerdict, verdictError }: GroupRowProps) {
  return (
    <li className="py-2 space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-secondary">
          <span className="tabular-nums text-secondary font-medium">&#9656; {group.count}&times;</span>{' '}
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
          onClick={() => onVerdict(group, 'fine')}
          className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
        >
          Fine
        </button>
        <button
          type="button"
          onClick={() => onVerdict(group, 'always_allow')}
          className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
        >
          Always allow
        </button>
        <button
          type="button"
          onClick={() => onVerdict(group, 'tighten')}
          className="text-xs text-status-warning transition-colors hover:opacity-80 motion-reduce:transition-none"
        >
          Tighten
        </button>
      </div>
      {verdictError && <p className="pl-4 text-xs text-status-error">{verdictError}</p>}
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
  // Per-group error messages; populated on POST failure, cleared on next attempt.
  const [verdictErrors, setVerdictErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchReview();
      setData(payload);
      setDismissed(new Set());
      setVerdictErrors({});
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
    (group: WarnGroup, verdict: VerdictType) => {
      const key = group.shape.key;
      // Clear any prior error for this group, then optimistically dismiss.
      setVerdictErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setDismissed((prev) => new Set([...prev, key]));
      postVerdict(verdict, { action_type: group.shape.action_type, target_prefix: group.shape.target_prefix ?? null })
        .catch((e: unknown) => {
          // Restore the row and surface the error inline.
          setDismissed((prev) => { const next = new Set(prev); next.delete(key); return next; });
          setVerdictErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
        });
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
            <GroupRow
              key={group.shape.key}
              group={group}
              onVerdict={handleVerdict}
              verdictError={verdictErrors[group.shape.key] ?? null}
            />
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
