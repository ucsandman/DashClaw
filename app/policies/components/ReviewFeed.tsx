'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchReview, postVerdict, type ReviewPayload, type WarnGroup } from '../lib/contractClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';
const VERDICT_TYPES = ['fine', 'always_allow', 'tighten'] as const;

// Compact button vocabulary for verdict actions. Neutral = no rule created /
// permissive; warning tint marks "tighten" as the consequential one.
const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

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

/** A rule created from this row this session; policyId is null while the POST is in flight. */
interface CreatedRule {
  policyId: string | null;
  verdict: 'always_allow' | 'tighten';
}

/** What "tighten" will compile to — mirrors the verdict route's path/host split. */
function tightenConsequence(group: WarnGroup): string {
  const prefix = group.shape.target_prefix;
  if (prefix && prefix.includes('/')) {
    return `New rule: require approval for any action under ${prefix}.`;
  }
  if (prefix) {
    return `New rule: require approval for ${group.shape.label} actions.`;
  }
  // No target to narrow to: this gates the whole action_type, fleet-wide.
  return `New rule: require approval for every "${group.shape.action_type}" action, fleet-wide.`;
}

interface GroupRowProps {
  group: WarnGroup;
  /** Called by the parent; parent owns optimistic state + errors. */
  onVerdict: (group: WarnGroup, verdict: VerdictType) => void;
  /** Inline error to display (set by parent on POST/DELETE failure). */
  verdictError?: string | null;
  /** Set once a verdict created a rule for this row; enables Undo. */
  created?: CreatedRule | null;
  onUndo: (group: WarnGroup) => void;
}

function GroupRow({ group, onVerdict, verdictError, created, onUndo }: GroupRowProps) {
  const [confirming, setConfirming] = useState(false);
  const label = group.shape.label;

  return (
    <li className="py-2.5 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-secondary">
          <span className="tabular-nums text-secondary font-medium">&#9656; {group.count}&times;</span>{' '}
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-xs text-tertiary">{formatRelative(group.latest_at)}</span>
      </div>
      {group.sample_goal && (
        <p className="text-xs text-tertiary pl-4 truncate">{group.sample_goal}</p>
      )}

      {created ? (
        // Verdict landed: say what now exists and offer the way back.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-4">
          <span className="text-xs text-secondary">
            {created.verdict === 'tighten'
              ? `Approval rule created for ${label}.`
              : `Allow grant created for ${label}.`}
          </span>
          <button
            type="button"
            disabled={!created.policyId}
            onClick={() => onUndo(group)}
            aria-label={`Undo rule for ${label}`}
            className={`${BTN_NEUTRAL} disabled:opacity-50`}
          >
            Undo
          </button>
        </div>
      ) : confirming ? (
        // Tighten is the one verdict that gates agents behind a human — spell
        // out the rule it creates and require a second, labeled click.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-4">
          <span className="text-xs text-status-warning">{tightenConsequence(group)}</span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onVerdict(group, 'tighten'); }}
            aria-label={`Create approval rule for ${label}`}
            className={BTN_WARNING}
          >
            Create rule
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={BTN_NEUTRAL}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-4">
          <button
            type="button"
            onClick={() => onVerdict(group, 'fine')}
            title="Dismiss: creates no rule"
            aria-label={`Mark ${label} as fine`}
            className={BTN_NEUTRAL}
          >
            Fine
          </button>
          <button
            type="button"
            onClick={() => onVerdict(group, 'always_allow')}
            title="Creates a standing allow grant: this shape never warns again"
            aria-label={`Always allow ${label}`}
            className={BTN_NEUTRAL}
          >
            Always allow
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Creates a require-approval rule: asks you to confirm first"
            aria-label={`Tighten ${label}`}
            className={BTN_WARNING}
          >
            Tighten&hellip;
          </button>
        </div>
      )}
      {verdictError && <p className="pl-4 text-xs text-status-error">{verdictError}</p>}
    </li>
  );
}

interface ReviewFeedProps {
  /** Fired when a verdict creates or removes a policy, so the contract panel can refresh. */
  onPolicyChange?: () => void;
}

/**
 * Review feed — warn-grouped actions that need a verdict.
 * Loads from GET /api/policies/review and posts verdicts via
 * POST /api/policies/review/verdict.
 */
export default function ReviewFeed({ onPolicyChange }: ReviewFeedProps = {}) {
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Optimistically removed group keys while "fine" verdicts are in-flight.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Per-group error messages; populated on POST failure, cleared on next attempt.
  const [verdictErrors, setVerdictErrors] = useState<Record<string, string>>({});
  // Rules created from this feed this session, keyed by shape key (enables Undo).
  const [created, setCreated] = useState<Record<string, CreatedRule>>({});
  const [markAllError, setMarkAllError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchReview();
      setData(payload);
      setDismissed(new Set());
      setVerdictErrors({});
      setCreated({});
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
      const shape = { action_type: group.shape.action_type, target_prefix: group.shape.target_prefix ?? null };
      // Clear any prior error for this group.
      setVerdictErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });

      if (verdict === 'fine') {
        // Review-state only: optimistically dismiss, restore on failure.
        setDismissed((prev) => new Set([...prev, key]));
        postVerdict('fine', shape).catch((e: unknown) => {
          setDismissed((prev) => { const next = new Set(prev); next.delete(key); return next; });
          setVerdictErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
        });
        return;
      }

      // Policy-creating verdicts: keep the row visible, swap to the created
      // strip, and capture the policy id so Undo can delete it.
      setCreated((prev) => ({ ...prev, [key]: { policyId: null, verdict } }));
      postVerdict(verdict, shape)
        .then((res) => {
          const policyId = res.policy?.id ?? null;
          setCreated((prev) => ({ ...prev, [key]: { policyId, verdict } }));
          onPolicyChange?.();
        })
        .catch((e: unknown) => {
          setCreated((prev) => { const next = { ...prev }; delete next[key]; return next; });
          setVerdictErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
        });
    },
    [onPolicyChange],
  );

  const handleUndo = useCallback(
    async (group: WarnGroup) => {
      const key = group.shape.key;
      const entry = created[key];
      if (!entry?.policyId) return;
      setVerdictErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
      try {
        const res = await fetch(`/api/policies?id=${encodeURIComponent(entry.policyId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Failed to undo (${res.status})`);
        setCreated((prev) => { const next = { ...prev }; delete next[key]; return next; });
        onPolicyChange?.();
      } catch (e) {
        setVerdictErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
      }
    },
    [created, onPolicyChange],
  );

  const handleMarkAll = useCallback(async () => {
    setMarkAllError(null);
    try {
      await postVerdict('mark_all_reviewed');
      await load();
    } catch (e) {
      setMarkAllError((e as Error).message ?? 'Failed');
    }
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
            className={BTN_NEUTRAL}
          >
            Mark all reviewed
          </button>
        )}
      </div>
      {markAllError && <p className="mt-1 text-xs text-status-error">{markAllError}</p>}

      {/* Warn groups */}
      {visibleGroups.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {visibleGroups.map((group) => (
            <GroupRow
              key={group.shape.key}
              group={group}
              onVerdict={handleVerdict}
              verdictError={verdictErrors[group.shape.key] ?? null}
              created={created[group.shape.key] ?? null}
              onUndo={handleUndo}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          Nothing to review. Your agents stayed inside the contract.
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
