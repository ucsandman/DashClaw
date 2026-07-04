'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  fetchTighteningProposals,
  ratifyTighteningProposal,
  dismissTighteningProposal,
  undoTighteningDecision,
  type TighteningProposalsPayload,
  type TighteningProposal,
} from '../lib/tighteningClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

// Same compact button vocabulary as ReviewFeed/TuningProposals/Calibration:
// warning tint marks Ratify as the consequential one (it creates an ACTIVE
// require_approval policy in the same click).
const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

function evidenceLine(proposal: TighteningProposal): string {
  const e = proposal.evidence;
  const risk = e.risk_min === e.risk_max ? `risk ${e.risk_min}` : `risk ${e.risk_min}–${e.risk_max}`;
  return `${e.observed_count} ungoverned allow${e.observed_count === 1 ? '' : 's'} · ${risk} · last ${e.window_days} day${e.window_days === 1 ? '' : 's'}`;
}

interface ProposalRowProps {
  proposal: TighteningProposal;
  /** Set once Ratify/Dismiss has landed this session; swaps the row to a strip. */
  state?: 'ratified' | 'dismissed' | null;
  /** Policy created by a this-session ratify (persisted rows carry it in decision). */
  createdPolicyId?: string | null;
  rowError?: string | null;
  busy?: boolean;
  onRatify: (proposal: TighteningProposal) => void;
  onDismiss: (proposal: TighteningProposal, reason: string) => void;
  onUndo: (proposal: TighteningProposal) => void;
}

function ProposalRow({
  proposal, state, createdPolicyId, rowError, busy, onRatify, onDismiss, onUndo,
}: ProposalRowProps) {
  const [armed, setArmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');

  // Persisted status wins unless a this-session action just changed it.
  const status = state ?? proposal.status;
  const policyId = createdPolicyId ?? proposal.decision?.policy_id ?? null;

  return (
    <li className="py-3 space-y-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-primary">
          {proposal.title}
          <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-secondary">
            {proposal.risk_level}
          </span>
        </p>
        <p className="text-sm text-secondary font-mono">
          require_approval · {proposal.action_type}
        </p>
        <p className="text-xs text-tertiary">
          {evidenceLine(proposal)}
          {' · '}
          <Link href="/decisions" className="text-brand hover:underline">
            evidence in the decisions ledger
          </Link>
        </p>
      </div>

      {status === 'ratified' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">
            Policy created{policyId ? <> &mdash; <span className="font-mono">{policyId}</span></> : null}.
            This action type now requires approval; the posture finding is resolved.
          </span>
          <button
            type="button"
            onClick={() => onUndo(proposal)}
            aria-label={`Undo ratify for ${proposal.title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : status === 'dismissed' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">Dismissed &mdash; this pattern stops re-proposing.</span>
          <button
            type="button"
            onClick={() => onUndo(proposal)}
            aria-label={`Undo dismiss for ${proposal.title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : armed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-status-warning">
            Creates an ACTIVE policy: &ldquo;{proposal.patch.name}&rdquo; &mdash; every
            &ldquo;{proposal.action_type}&rdquo; action will require approval from now on.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setArmed(false); onRatify(proposal); }}
            aria-label={`Confirm ratify for ${proposal.title}`}
            className={`${BTN_WARNING} disabled:opacity-50`}
          >
            Confirm &mdash; create policy
          </button>
          <button type="button" onClick={() => setArmed(false)} className={BTN_NEUTRAL}>
            Cancel
          </button>
        </div>
      ) : dismissing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`tightening-dismiss-reason-${proposal.id}`} className="sr-only">
            Reason for dismissing {proposal.title}
          </label>
          <input
            id={`tightening-dismiss-reason-${proposal.id}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            aria-label={`Reason for dismissing ${proposal.title}`}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs text-primary placeholder:text-tertiary focus:border-border-active focus:outline-none"
          />
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              const trimmed = reason.trim();
              setDismissing(false);
              setReason('');
              onDismiss(proposal, trimmed);
            }}
            aria-label={`Confirm dismiss for ${proposal.title}`}
            className={`${BTN_NEUTRAL} disabled:opacity-50`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => { setDismissing(false); setReason(''); }}
            className={BTN_NEUTRAL}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setArmed(true)}
            aria-label={`Ratify: ${proposal.title}`}
            className={BTN_WARNING}
          >
            Ratify&hellip;
          </button>
          <button
            type="button"
            onClick={() => setDismissing(true)}
            aria-label={`Dismiss: ${proposal.title}`}
            className={BTN_NEUTRAL}
          >
            Dismiss&hellip;
          </button>
        </div>
      )}
      {rowError && <p role="alert" className="text-xs text-status-error">{rowError}</p>}
    </li>
  );
}

/**
 * Tightening proposals — findings become proposals (owner roadmap v3.2).
 * The tuning engine only loosens; this section owns the other direction:
 * posture's pattern-collapsed "ungoverned high-risk action reached allow"
 * findings, re-rendered as one-click policy proposals. Ratify creates the
 * require_approval policy server-side and resolves the mirrored posture
 * finding (constitution §3 — a human clicks every policy into existence).
 */
export default function TighteningProposals({ onPolicyChange }: { onPolicyChange?: () => void }) {
  const [data, setData] = useState<TighteningProposalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rowState, setRowState] = useState<Record<string, 'ratified' | 'dismissed'>>({});
  const [createdPolicies, setCreatedPolicies] = useState<Record<string, string | null>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchTighteningProposals();
      setData(payload);
      setRowState({});
      setCreatedPolicies({});
      setRowErrors({});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clearRowError = (id: string) =>
    setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });

  // Ratify awaits the server (it creates a real policy) rather than the
  // optimistic pattern the other rows use — the strip needs the policy id and
  // the policies list above needs a refresh only on actual success.
  const handleRatify = useCallback((proposal: TighteningProposal) => {
    const id = proposal.id;
    clearRowError(id);
    setBusy((prev) => ({ ...prev, [id]: true }));
    ratifyTighteningProposal(proposal)
      .then(({ policy_id }) => {
        setRowState((prev) => ({ ...prev, [id]: 'ratified' }));
        setCreatedPolicies((prev) => ({ ...prev, [id]: policy_id }));
        onPolicyChange?.();
      })
      .catch((e: unknown) => {
        setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
      })
      .finally(() => {
        setBusy((prev) => { const next = { ...prev }; delete next[id]; return next; });
      });
  }, [onPolicyChange]);

  const handleDismiss = useCallback((proposal: TighteningProposal, reason: string) => {
    const id = proposal.id;
    clearRowError(id);
    setRowState((prev) => ({ ...prev, [id]: 'dismissed' }));
    dismissTighteningProposal(proposal, reason).catch((e: unknown) => {
      setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
    });
  }, []);

  const handleUndo = useCallback((proposal: TighteningProposal) => {
    const id = proposal.id;
    clearRowError(id);
    undoTighteningDecision(id)
      .then(() => {
        // The row returns to pending. A ratify-created policy stays (it is a
        // first-class policy now) — governed-suppression hides the proposal on
        // the next full load, so keep this-session state truthful in place.
        setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setCreatedPolicies((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setData((prev) =>
          prev
            ? {
                ...prev,
                proposals: prev.proposals.map((p) =>
                  p.id === id ? { ...p, status: 'pending', decision: null } : p,
                ),
              }
            : prev,
        );
      })
      .catch((e: unknown) => {
        setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-between border-t border-border py-4 text-sm">
        <span className="text-tertiary">Couldn&apos;t load tightening proposals.</span>
        <button onClick={load} className="text-brand hover:underline text-xs">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  return (
    <div id="tightening">
      <span className={SECTION_LABEL}>Tightening proposals</span>
      <p className="mt-1 text-sm text-tertiary">
        High-risk action patterns that reached allow with nothing in their way &mdash; mirrored
        from your posture findings. Ratifying creates the require_approval policy in one click;
        dismissing records why and stops the re-proposal.
      </p>

      {(data.proposals ?? []).length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {(data.proposals ?? []).map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              state={rowState[proposal.id] ?? null}
              createdPolicyId={createdPolicies[proposal.id] ?? null}
              rowError={rowErrors[proposal.id] ?? null}
              busy={busy[proposal.id] ?? false}
              onRatify={handleRatify}
              onDismiss={handleDismiss}
              onUndo={handleUndo}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          No ungoverned high-risk patterns in the last {data.window_days ?? 7} days &mdash; every
          risky action met a policy.
        </p>
      )}
    </div>
  );
}
