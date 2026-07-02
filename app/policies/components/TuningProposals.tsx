'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  fetchProposals,
  acceptProposal,
  dismissProposal,
  undismissProposal,
  type ProposalsPayload,
  type TuningProposal,
} from '../lib/proposalsClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

// Same compact button vocabulary as ReviewFeed: neutral = no consequence,
// warning tint marks "Apply" as the consequential one (it PATCHes a policy).
const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

/** Compact evidence line: fired/approval counts plus risk-score spread when present. */
function evidenceLine(proposal: TuningProposal): string | null {
  const { fired, approvals, approved_risk_scores } = proposal.evidence;
  if (fired.require_approval === 0) return null;
  const parts = [
    `${fired.require_approval} interrupted`,
    `${approvals.approved} approved, ${approvals.denied} denied`,
  ];
  if (approved_risk_scores) {
    parts.push(
      `approved risk scores ${approved_risk_scores.min}–${approved_risk_scores.max}, median ${approved_risk_scores.p50}`,
    );
  }
  return parts.join(' · ');
}

/** Confirm-button label for the second click — spells out the change for raise_risk_threshold. */
function applyLabel(proposal: TuningProposal): string {
  if (proposal.rule === 'raise_risk_threshold' && proposal.patch) {
    const threshold = proposal.patch.rules.threshold;
    return `Confirm — raise to ${threshold}`;
  }
  return 'Confirm — apply';
}

interface ProposalRowProps {
  proposal: TuningProposal;
  /** Set once Apply/Dismiss has landed for this row; swaps the row to a strip. */
  state?: 'applied' | 'dismissed' | null;
  rowError?: string | null;
  onApply: (proposal: TuningProposal) => void;
  onDismiss: (proposal: TuningProposal, reason: string) => void;
  onUndoDismiss: (proposal: TuningProposal) => void;
}

function ProposalRow({ proposal, state, rowError, onApply, onDismiss, onUndoDismiss }: ProposalRowProps) {
  const [armed, setArmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const canApply = !!proposal.patch;
  const evidence = evidenceLine(proposal);

  return (
    <li className="py-3 space-y-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-primary">{proposal.title}</p>
        <p className="text-sm text-secondary">{proposal.summary}</p>
        {evidence && <p className="text-xs text-tertiary">{evidence}</p>}
      </div>

      {state === 'applied' ? (
        <p className="text-xs text-secondary">Applied — &quot;{proposal.policy_name}&quot; updated.</p>
      ) : state === 'dismissed' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">Dismissed.</span>
          <button
            type="button"
            onClick={() => onUndoDismiss(proposal)}
            aria-label={`Undo dismiss for ${proposal.title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : armed ? (
        // Apply is the consequential action (PATCHes a policy) — spell out the
        // change and require a second, labeled click, same as ReviewFeed's Tighten.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-status-warning">
            Applies now to &quot;{proposal.policy_name}&quot;.
          </span>
          <button
            type="button"
            onClick={() => { setArmed(false); onApply(proposal); }}
            aria-label={`Confirm apply for ${proposal.title}`}
            className={BTN_WARNING}
          >
            {applyLabel(proposal)}
          </button>
          <button type="button" onClick={() => setArmed(false)} className={BTN_NEUTRAL}>
            Cancel
          </button>
        </div>
      ) : dismissing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`tuning-dismiss-reason-${proposal.id}`} className="sr-only">
            Reason for dismissing {proposal.title}
          </label>
          <input
            id={`tuning-dismiss-reason-${proposal.id}`}
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
          {canApply && (
            <button
              type="button"
              onClick={() => setArmed(true)}
              aria-label={`Apply: ${proposal.title}`}
              className={BTN_WARNING}
            >
              Apply&hellip;
            </button>
          )}
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

interface TuningProposalsProps {
  /** Fired when an accepted proposal PATCHes a policy, so the cockpit summary can refresh. */
  onPolicyChange?: () => void;
}

/**
 * Tuning proposals — the counterpart to ReviewFeed: review answers "what
 * interrupted you", tuning answers "what should change". Loads from
 * GET /api/policies/proposals; Accept PATCHes the policy via the existing
 * /api/policies route (a human ratifies — nothing auto-applies); Dismiss
 * records a reason via POST /api/policies/proposals.
 */
export default function TuningProposals({ onPolicyChange }: TuningProposalsProps = {}) {
  const [data, setData] = useState<ProposalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Rows that have landed an Accept/Dismiss this session; swaps the row to a strip.
  const [rowState, setRowState] = useState<Record<string, 'applied' | 'dismissed'>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchProposals();
      setData(payload);
      setRowState({});
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

  const handleApply = useCallback(
    (proposal: TuningProposal) => {
      if (!proposal.patch) return;
      const id = proposal.id;
      setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowState((prev) => ({ ...prev, [id]: 'applied' }));
      acceptProposal(proposal.policy_id, proposal.patch.rules)
        .then(() => {
          onPolicyChange?.();
        })
        .catch((e: unknown) => {
          setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
          setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
        });
    },
    [onPolicyChange],
  );

  const handleDismiss = useCallback((proposal: TuningProposal, reason: string) => {
    const id = proposal.id;
    setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setRowState((prev) => ({ ...prev, [id]: 'dismissed' }));
    dismissProposal(id, reason).catch((e: unknown) => {
      setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
    });
  }, []);

  const handleUndoDismiss = useCallback((proposal: TuningProposal) => {
    const id = proposal.id;
    setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    undismissProposal(id)
      .then(() => {
        setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
      })
      .catch((e: unknown) => {
        setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-between border-t border-border py-4 text-sm">
        <span className="text-tertiary">Couldn&apos;t load tuning proposals.</span>
        <button onClick={load} className="text-brand hover:underline text-xs">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  // No active policies at all — there is nothing to tune. Section is silent,
  // not present (PolicyCockpit already handles the "no mode applied" state).
  if (data.policies.length === 0) return null;

  return (
    <div>
      <span className={SECTION_LABEL}>Tuning proposals</span>
      <p className="mt-1 text-sm text-tertiary">
        Evidence-backed suggestions from how you&apos;ve actually been approving &mdash; nothing changes until you accept.
      </p>

      {data.proposals.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {data.proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              state={rowState[proposal.id] ?? null}
              rowError={rowErrors[proposal.id] ?? null}
              onApply={handleApply}
              onDismiss={handleDismiss}
              onUndoDismiss={handleUndoDismiss}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          No tuning proposals &mdash; policies match how you&apos;re actually approving.
        </p>
      )}
    </div>
  );
}
