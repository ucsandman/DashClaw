'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  fetchCalibrationProposals,
  ratifyProposal,
  dismissCalibrationProposal,
  undoCalibrationDecision,
  type CalibrationProposalsPayload,
  type CalibrationProposal,
} from '../lib/calibrationClient';

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

// Same compact button vocabulary as ReviewFeed/TuningProposals: neutral = no
// consequence, warning tint marks Ratify as the consequential one (it records
// the judgment the maintainer forges into the corpus).
const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

const RULE_LABELS: Record<CalibrationProposal['rule'], string> = {
  over_scored_benign: 'Over-scored benign',
  under_scored_danger: 'Under-scored danger',
  repeated_approvals: 'Repeated approvals',
};

/** The representative's human-readable shape, mirroring the miner's stdout line. */
function shapeLine(proposal: CalibrationProposal): string {
  const rep = proposal.representative || {};
  return String(
    rep.command_shape || rep.declared_goal || rep.action_type || '(no shape)',
  ).slice(0, 120);
}

function evidenceLine(proposal: CalibrationProposal): string | null {
  if (proposal.from_snapshot) return null;
  const parts = [`${proposal.count} event${proposal.count === 1 ? '' : 's'}`];
  if (proposal.evidence_tier) parts.push(`tier ${proposal.evidence_tier.replace(/_/g, ' ')}`);
  if (proposal.risk_min != null) {
    parts.push(
      proposal.risk_min === proposal.risk_max
        ? `risk ${proposal.risk_min}`
        : `risk ${proposal.risk_min}–${proposal.risk_max}`,
    );
  }
  return parts.join(' · ');
}

interface ProposalRowProps {
  proposal: CalibrationProposal;
  /** Set once Ratify/Dismiss has landed this session; swaps the row to a strip. */
  state?: 'ratified' | 'dismissed' | null;
  rowError?: string | null;
  onRatify: (proposal: CalibrationProposal) => void;
  onDismiss: (proposal: CalibrationProposal, reason: string) => void;
  onUndo: (proposal: CalibrationProposal) => void;
}

function ProposalRow({ proposal, state, rowError, onRatify, onDismiss, onUndo }: ProposalRowProps) {
  const [armed, setArmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');

  // Persisted status wins unless a this-session action just changed it.
  const status = state ?? proposal.status;
  const evidence = evidenceLine(proposal);
  const title = `${RULE_LABELS[proposal.rule] ?? proposal.rule}: ${proposal.suggested_name}`;

  return (
    <li className="py-3 space-y-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-primary">
          {RULE_LABELS[proposal.rule] ?? proposal.rule}
          <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-secondary">
            {proposal.suggested_label}
          </span>
        </p>
        <p className="text-sm text-secondary font-mono">{shapeLine(proposal)}</p>
        {evidence && <p className="text-xs text-tertiary">{evidence}</p>}
        {proposal.provenance && <p className="text-xs text-tertiary">{proposal.provenance}</p>}
        {proposal.needs_manual_context && status === 'pending' && (
          <p className="text-xs text-tertiary">
            Redacted shape — the maintainer supplies the runnable command at forge time.
          </p>
        )}
      </div>

      {status === 'forged' ? (
        <p className="text-xs text-secondary">
          In corpus as <span className="font-mono">{proposal.decision?.vector_name}</span>.
        </p>
      ) : status === 'ratified' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">
            Ratified &mdash; queued for the maintainer forge.
          </span>
          <button
            type="button"
            onClick={() => onUndo(proposal)}
            aria-label={`Undo ratify for ${title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : status === 'dismissed' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">Dismissed.</span>
          <button
            type="button"
            onClick={() => onUndo(proposal)}
            aria-label={`Undo dismiss for ${title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : armed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-status-warning">
            Records your ratification &mdash; the maintainer forges it into the corpus and commits;
            nothing changes until then.
          </span>
          <button
            type="button"
            onClick={() => { setArmed(false); onRatify(proposal); }}
            aria-label={`Confirm ratify for ${title}`}
            className={BTN_WARNING}
          >
            Confirm &mdash; ratify
          </button>
          <button type="button" onClick={() => setArmed(false)} className={BTN_NEUTRAL}>
            Cancel
          </button>
        </div>
      ) : dismissing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`calibration-dismiss-reason-${proposal.candidate_id}`} className="sr-only">
            Reason for dismissing {title}
          </label>
          <input
            id={`calibration-dismiss-reason-${proposal.candidate_id}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            aria-label={`Reason for dismissing ${title}`}
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
            aria-label={`Confirm dismiss for ${title}`}
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
            aria-label={`Ratify: ${title}`}
            className={BTN_WARNING}
          >
            Ratify&hellip;
          </button>
          <button
            type="button"
            onClick={() => setDismissing(true)}
            aria-label={`Dismiss: ${title}`}
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
 * Calibration proposals — the review surface for the calibration flywheel
 * (owner roadmap v2.6b). The weekly miner's proposals are computed on read
 * from this org's own ledger; Ratify/Dismiss record the human's judgment
 * (constitution §3 — the corpus commit stays with the maintainer session,
 * which consumes ?status=ratified and closes the loop with mark_forged).
 */
export default function CalibrationProposals() {
  const [data, setData] = useState<CalibrationProposalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rowState, setRowState] = useState<Record<string, 'ratified' | 'dismissed'>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchCalibrationProposals();
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

  const clearRowError = (id: string) =>
    setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });

  const handleRatify = useCallback((proposal: CalibrationProposal) => {
    const id = proposal.candidate_id;
    clearRowError(id);
    setRowState((prev) => ({ ...prev, [id]: 'ratified' }));
    ratifyProposal(proposal).catch((e: unknown) => {
      setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
    });
  }, []);

  const handleDismiss = useCallback((proposal: CalibrationProposal, reason: string) => {
    const id = proposal.candidate_id;
    clearRowError(id);
    setRowState((prev) => ({ ...prev, [id]: 'dismissed' }));
    dismissCalibrationProposal(proposal, reason).catch((e: unknown) => {
      setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErrors((prev) => ({ ...prev, [id]: (e as Error).message ?? 'Failed' }));
    });
  }, []);

  const handleUndo = useCallback((proposal: CalibrationProposal) => {
    const id = proposal.candidate_id;
    clearRowError(id);
    undoCalibrationDecision(id)
      .then(() => {
        // Reflect the undo without a full reload: the row returns to pending.
        setRowState((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setData((prev) =>
          prev
            ? {
                ...prev,
                proposals: prev.proposals.map((p) =>
                  p.candidate_id === id ? { ...p, status: 'pending', decision: null } : p,
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
        <span className="text-tertiary">Couldn&apos;t load calibration proposals.</span>
        <button onClick={load} className="text-brand hover:underline text-xs">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  return (
    <div>
      <span className={SECTION_LABEL}>Calibration proposals</span>
      <p className="mt-1 text-sm text-tertiary">
        Shapes mined from your own ledger where the risk scorer looks miscalibrated &mdash;
        ratifying queues a golden vector for the maintainer; nothing changes until it&apos;s
        forged and committed.
      </p>

      {data.proposals.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {data.proposals.map((proposal) => (
            <ProposalRow
              key={proposal.candidate_id}
              proposal={proposal}
              state={rowState[proposal.candidate_id] ?? null}
              rowError={rowErrors[proposal.candidate_id] ?? null}
              onRatify={handleRatify}
              onDismiss={handleDismiss}
              onUndo={handleUndo}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          No calibration proposals in the last {data.window_days} days &mdash; the scorer and
          your approvals agree.
        </p>
      )}
    </div>
  );
}
