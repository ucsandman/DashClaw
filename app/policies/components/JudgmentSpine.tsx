'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '../../components/ui/Skeleton';
import {
  fetchProposals,
  acceptProposal,
  dismissProposal,
  undismissProposal,
  type TuningProposal,
} from '../lib/proposalsClient';
import {
  fetchTighteningProposals,
  ratifyTighteningProposal,
  dismissTighteningProposal,
  undoTighteningDecision,
  type TighteningProposal,
} from '../lib/tighteningClient';
import {
  fetchLooseningProposals,
  ratifyLooseningProposal,
  dismissLooseningProposal,
  undoLooseningDecision,
  type LooseningProposal,
} from '../lib/looseningClient';
import {
  fetchCalibrationProposals,
  ratifyProposal,
  dismissCalibrationProposal,
  undoCalibrationDecision,
  type CalibrationProposal,
} from '../lib/calibrationClient';
import {
  fetchBehaviorSuggestions,
  simulateBehaviorSuggestion,
  adoptBehaviorSuggestion,
  dismissBehaviorSuggestion,
  undoBehaviorSuggestion,
  type BehaviorSuggestion,
  type BehaviorSimulation,
} from '../lib/behaviorClient';

// One shared button vocabulary across every queue: neutral = no consequence,
// warning tint marks the consequential primary (it changes a policy/corpus).
const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

const GROUP_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';
const INPUT_CLASS =
  'min-w-0 flex-1 rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs text-primary placeholder:text-tertiary focus:border-border-active focus:outline-none';

type QueueKey = 'tuning' | 'tightening' | 'loosening' | 'calibration' | 'behavior';
type Phase = 'pending' | 'accepted' | 'dismissed' | 'terminal';

function RowError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-xs text-status-error">{message}</p>;
}

// ---------------------------------------------------------------------------
// Proposal queues (tuning / tightening / calibration) — one grammar, one row.
// The three engines already share a decision shape (propose → ratify/dismiss →
// undo); the adapter supplies the per-queue copy and the client-lib calls.
// ---------------------------------------------------------------------------

interface ProposalView {
  key: string;
  title: string;
  badge?: string | null;
  desc?: ReactNode;
  mono?: ReactNode;
  evidence: ReactNode[];
  provenance?: ReactNode;
  note?: ReactNode;
  phase: Phase;
}

interface ProposalAdapter<Raw> {
  queue: QueueKey;
  anchorId: string;
  label: string;
  description: string;
  errorText: string;
  emptyText: (windowDays?: number) => string;
  reasonRequired: boolean;
  primaryVerb: string; // 'Apply' | 'Ratify'
  hasPrimary: (raw: Raw) => boolean;
  primaryArmed: (raw: Raw) => ReactNode;
  primaryConfirm: (raw: Raw) => string;
  accepted: (raw: Raw, result?: unknown) => ReactNode;
  dismissedText: ReactNode;
  undoAfterAccepted: boolean;
  terminal?: (raw: Raw) => ReactNode;
  fetch: () => Promise<{ items: Raw[]; windowDays?: number; note?: ReactNode }>;
  view: (raw: Raw) => ProposalView;
  primary: (raw: Raw) => Promise<unknown>;
  dismiss: (raw: Raw, reason: string) => Promise<void>;
  undo: (raw: Raw) => Promise<void>;
}

interface ProposalRowProps<Raw> {
  raw: Raw;
  view: ProposalView;
  adapter: ProposalAdapter<Raw>;
  override?: { phase: Phase; node?: ReactNode } | null;
  busy?: boolean;
  rowError?: string | null;
  onPrimary: (raw: Raw) => void;
  onDismiss: (raw: Raw, reason: string) => void;
  onUndo: (raw: Raw) => void;
}

function ProposalRow<Raw>({
  raw, view, adapter, override, busy, rowError, onPrimary, onDismiss, onUndo,
}: ProposalRowProps<Raw>) {
  const [armed, setArmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');

  const phase = override?.phase ?? view.phase;
  const title = view.title;
  const primaryVerb = adapter.primaryVerb;

  return (
    <li className="py-3 space-y-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-primary">
          {view.title}
          {view.badge && (
            <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-secondary">
              {view.badge}
            </span>
          )}
        </p>
        {view.desc && <p className="text-sm text-secondary">{view.desc}</p>}
        {view.mono && <p className="text-sm text-secondary font-mono">{view.mono}</p>}
        {view.evidence.map((line, i) => (
          <p key={i} className="text-xs text-tertiary">{line}</p>
        ))}
        {view.provenance && <p className="text-xs text-tertiary">{view.provenance}</p>}
        {view.note && phase === 'pending' && <p className="text-xs text-tertiary">{view.note}</p>}
      </div>

      {phase === 'terminal' ? (
        <p className="text-xs text-secondary">{adapter.terminal?.(raw)}</p>
      ) : phase === 'accepted' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">{override?.node ?? adapter.accepted(raw)}</span>
          {adapter.undoAfterAccepted && (
            <button
              type="button"
              onClick={() => onUndo(raw)}
              aria-label={`Undo ${primaryVerb} for ${title}`}
              className={BTN_NEUTRAL}
            >
              Undo
            </button>
          )}
        </div>
      ) : phase === 'dismissed' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">{adapter.dismissedText}</span>
          <button
            type="button"
            onClick={() => onUndo(raw)}
            aria-label={`Undo dismiss for ${title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : armed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-status-warning">{adapter.primaryArmed(raw)}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setArmed(false); onPrimary(raw); }}
            aria-label={`Confirm ${primaryVerb} for ${title}`}
            className={`${BTN_WARNING} disabled:opacity-50`}
          >
            {adapter.primaryConfirm(raw)}
          </button>
          <button type="button" onClick={() => setArmed(false)} className={BTN_NEUTRAL}>
            Cancel
          </button>
        </div>
      ) : dismissing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`spine-dismiss-${view.key}`} className="sr-only">
            Reason for dismissing {title}
          </label>
          <input
            id={`spine-dismiss-${view.key}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={adapter.reasonRequired ? 'Reason (required)' : 'Reason (optional)'}
            aria-label={`Reason for dismissing ${title}`}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            disabled={adapter.reasonRequired && !reason.trim()}
            onClick={() => {
              const trimmed = reason.trim();
              setDismissing(false);
              setReason('');
              onDismiss(raw, trimmed);
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
          {adapter.hasPrimary(raw) && (
            <button
              type="button"
              onClick={() => setArmed(true)}
              aria-label={`${primaryVerb}: ${title}`}
              className={BTN_WARNING}
            >
              {primaryVerb}&hellip;
            </button>
          )}
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
      <RowError message={rowError} />
    </li>
  );
}

interface ProposalGroupProps<Raw> {
  adapter: ProposalAdapter<Raw>;
  onCount: (pending: number) => void;
}

function ProposalGroup<Raw>({ adapter, onCount }: ProposalGroupProps<Raw>) {
  const [items, setItems] = useState<Raw[] | null>(null);
  const [windowDays, setWindowDays] = useState<number | undefined>(undefined);
  const [sectionNote, setSectionNote] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Per-row session overrides: {phase, node?} — the source of truth once set,
  // so an undo can pull a persisted accepted/dismissed row back to pending.
  const [overrides, setOverrides] = useState<Record<string, { phase: Phase; node?: ReactNode }>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { items: got, windowDays: wd, note } = await adapter.fetch();
      setItems(got);
      setWindowDays(wd);
      setSectionNote(note ?? null);
      setOverrides({});
      setRowErrors({});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => { load(); }, [load]);

  const effectivePhase = useCallback(
    (raw: Raw): Phase => {
      const key = adapter.view(raw).key;
      return overrides[key]?.phase ?? adapter.view(raw).phase;
    },
    [adapter, overrides],
  );

  // Report pending count up to the section header whenever it changes.
  const pending = items ? items.filter((raw) => effectivePhase(raw) === 'pending').length : 0;
  useEffect(() => { onCount(pending); }, [pending, onCount]);

  const clearErr = (key: string) =>
    setRowErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });

  const handlePrimary = useCallback((raw: Raw) => {
    const key = adapter.view(raw).key;
    clearErr(key);
    setBusy((prev) => ({ ...prev, [key]: true }));
    adapter.primary(raw)
      .then((result) => {
        setOverrides((prev) => ({ ...prev, [key]: { phase: 'accepted', node: adapter.accepted(raw, result) } }));
      })
      .catch((e: unknown) => {
        setRowErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
      })
      .finally(() => {
        setBusy((prev) => { const next = { ...prev }; delete next[key]; return next; });
      });
  }, [adapter]);

  const handleDismiss = useCallback((raw: Raw, reason: string) => {
    const key = adapter.view(raw).key;
    clearErr(key);
    setOverrides((prev) => ({ ...prev, [key]: { phase: 'dismissed' } }));
    adapter.dismiss(raw, reason).catch((e: unknown) => {
      setOverrides((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setRowErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
    });
  }, [adapter]);

  const handleUndo = useCallback((raw: Raw) => {
    const key = adapter.view(raw).key;
    clearErr(key);
    adapter.undo(raw)
      .then(() => {
        setOverrides((prev) => ({ ...prev, [key]: { phase: 'pending' } }));
      })
      .catch((e: unknown) => {
        setRowErrors((prev) => ({ ...prev, [key]: (e as Error).message ?? 'Failed' }));
      });
  }, [adapter]);

  return (
    <div id={adapter.anchorId} className="scroll-mt-20">
      <span className={GROUP_LABEL}>{adapter.label}</span>
      <p className="mt-1 text-sm text-tertiary">{adapter.description}</p>
      {sectionNote}

      {loading ? (
        <div className="mt-2 space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between border-t border-border py-4 text-sm">
          <span className="text-tertiary">{adapter.errorText}</span>
          <button onClick={load} className="text-brand hover:underline text-xs">Retry &rsaquo;</button>
        </div>
      ) : items && items.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {items.map((raw) => {
            const view = adapter.view(raw);
            return (
              <ProposalRow
                key={view.key}
                raw={raw}
                view={view}
                adapter={adapter}
                override={overrides[view.key] ?? null}
                busy={busy[view.key] ?? false}
                rowError={rowErrors[view.key] ?? null}
                onPrimary={handlePrimary}
                onDismiss={handleDismiss}
                onUndo={handleUndo}
              />
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">{adapter.emptyText(windowDays)}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function tuningEvidence(proposal: TuningProposal): ReactNode | null {
  const { fired, approvals, approved_risk_scores } = proposal.evidence;
  if (fired.require_approval === 0) return null;
  const parts = [
    `${fired.require_approval} interrupted`,
    `${approvals.approved} approved, ${approvals.denied} denied`,
  ];
  if (approved_risk_scores) {
    parts.push(`approved risk scores ${approved_risk_scores.min}–${approved_risk_scores.max}, median ${approved_risk_scores.p50}`);
  }
  return parts.join(' · ');
}

function tuningApplyLabel(proposal: TuningProposal): string {
  if (proposal.rule === 'raise_risk_threshold' && proposal.patch) {
    return `Confirm — raise to ${proposal.patch.rules.threshold}`;
  }
  return 'Confirm — apply';
}

function degradationNote(degradation: Awaited<ReturnType<typeof fetchProposals>>['degradation']): ReactNode {
  if (!degradation || degradation.degraded <= 0) return null;
  return (
    <div className="mt-2 rounded-md border border-border bg-surface-secondary px-3 py-2">
      <p className="text-xs text-secondary">
        <span className="font-medium text-status-warning">
          {degradation.degraded} of {degradation.total} decisions
        </span>{' '}
        in the last {degradation.window_days} days were deadline degradations ({(degradation.rate * 100).toFixed(1)}%)
        &mdash; the evaluation ran over budget, not a policy match. Excluded from the evidence below.
        {degradation.last_degraded_at && (
          <span className="text-tertiary"> Latest: {new Date(degradation.last_degraded_at).toLocaleString()}.</span>
        )}
      </p>
    </div>
  );
}

const tuningAdapter: ProposalAdapter<TuningProposal> = {
  queue: 'tuning',
  anchorId: 'tuning',
  label: 'Tuning',
  description: "Evidence-backed suggestions from how you've actually been approving — nothing changes until you accept.",
  errorText: "Couldn't load tuning proposals.",
  emptyText: () => "No pending tuning — policies match how you're actually approving.",
  reasonRequired: true,
  primaryVerb: 'Apply',
  hasPrimary: (p) => !!p.patch,
  primaryArmed: (p) => <>Applies now to &ldquo;{p.policy_name}&rdquo;.</>,
  primaryConfirm: (p) => tuningApplyLabel(p),
  accepted: (p) => <>Applied &mdash; &ldquo;{p.policy_name}&rdquo; updated.</>,
  dismissedText: 'Dismissed.',
  undoAfterAccepted: false,
  fetch: async () => {
    const payload = await fetchProposals();
    // No active policies at all — nothing to tune (parity with the old section).
    const items = payload.policies.length === 0 ? [] : payload.proposals;
    return { items, windowDays: payload.window_days, note: degradationNote(payload.degradation) };
  },
  view: (p) => {
    const evidence: ReactNode[] = [];
    const line = tuningEvidence(p);
    if (line) evidence.push(line);
    return { key: p.id, title: p.title, desc: p.summary, evidence, phase: 'pending' };
  },
  primary: (p) => acceptProposal(p.policy_id, p.patch!.rules),
  dismiss: (p, reason) => dismissProposal(p.id, reason),
  undo: (p) => undismissProposal(p.id),
};

const TIGHTENING_RULE_HELP =
  'High-risk action patterns that reached allow with nothing in their way — mirrored from your posture findings. Ratifying creates the require_approval policy in one click; dismissing records why and stops the re-proposal.';

const tighteningAdapter: ProposalAdapter<TighteningProposal> = {
  queue: 'tightening',
  anchorId: 'tightening',
  label: 'Tightening',
  description: TIGHTENING_RULE_HELP,
  errorText: "Couldn't load tightening proposals.",
  emptyText: (wd) => `No ungoverned high-risk patterns in the last ${wd ?? 7} days — every risky action met a policy.`,
  reasonRequired: true,
  primaryVerb: 'Ratify',
  hasPrimary: () => true,
  primaryArmed: (p) => (
    <>
      Creates an ACTIVE policy: &ldquo;{p.patch.name}&rdquo; &mdash; every &ldquo;{p.action_type}&rdquo; action
      will require approval from now on.
    </>
  ),
  primaryConfirm: () => 'Confirm — create policy',
  accepted: (p, result) => {
    const pid = (result as { policy_id?: string | null } | undefined)?.policy_id ?? p.decision?.policy_id ?? null;
    return (
      <>
        Policy created{pid ? <> &mdash; <span className="font-mono">{pid}</span></> : null}.
        This action type now requires approval; the posture finding is resolved.
      </>
    );
  },
  dismissedText: 'Dismissed — this pattern stops re-proposing.',
  undoAfterAccepted: true,
  fetch: async () => {
    const payload = await fetchTighteningProposals();
    return { items: payload.proposals ?? [], windowDays: payload.window_days };
  },
  view: (p) => {
    const status: Phase = p.status === 'ratified' ? 'accepted' : p.status === 'dismissed' ? 'dismissed' : 'pending';
    return {
      key: p.id,
      title: p.title,
      badge: p.risk_level,
      mono: <>require_approval &middot; {p.action_type}</>,
      evidence: [
        <>
          {`${p.evidence.observed_count} ungoverned allow${p.evidence.observed_count === 1 ? '' : 's'} · ${p.evidence.risk_min === p.evidence.risk_max ? `risk ${p.evidence.risk_min}` : `risk ${p.evidence.risk_min}–${p.evidence.risk_max}`} · last ${p.evidence.window_days} day${p.evidence.window_days === 1 ? '' : 's'}`}
          {' · '}
          <Link href="/decisions" className="text-brand hover:underline">evidence in the decisions ledger</Link>
        </>,
      ],
      phase: status,
    };
  },
  primary: (p) => ratifyTighteningProposal(p),
  dismiss: (p, reason) => dismissTighteningProposal(p, reason),
  undo: (p) => undoTighteningDecision(p.id),
};

const LOOSENING_RULE_HELP =
  'Policies you override yourself — interrupts approved ~100% of the time, mined from the same ledger tightening reads, pointed the other way. Ratifying relaxes the policy in one click; dismissing records why and stops the re-proposal.';

function looseningMono(p: LooseningProposal): ReactNode {
  return p.rule === 'relax_policy_scope'
    ? <>remove &ldquo;{p.action_type}&rdquo; &middot; {p.policy_name}</>
    : <>deactivate &middot; {p.policy_name}</>;
}

const looseningAdapter: ProposalAdapter<LooseningProposal> = {
  queue: 'loosening',
  anchorId: 'loosening',
  label: 'Loosening',
  description: LOOSENING_RULE_HELP,
  errorText: "Couldn't load loosening proposals.",
  emptyText: (wd) => `No over-interrupting patterns in the last ${wd ?? 30} days — every interrupt is earning its click.`,
  reasonRequired: true,
  primaryVerb: 'Ratify',
  hasPrimary: () => true,
  primaryArmed: (p) =>
    p.rule === 'relax_policy_scope' ? (
      <>
        Relaxes &ldquo;{p.policy_name}&rdquo; now &mdash; &ldquo;{p.action_type}&rdquo; actions stop
        requiring approval; the rest of the policy stays governed.
      </>
    ) : (
      <>
        Deactivates &ldquo;{p.policy_name}&rdquo; now &mdash; it stops interrupting entirely.
        Reactivate any time at /policies.
      </>
    ),
  primaryConfirm: (p) =>
    p.rule === 'relax_policy_scope' ? 'Confirm — relax policy' : 'Confirm — deactivate policy',
  accepted: (p) =>
    p.rule === 'relax_policy_scope' ? (
      <>Relaxed &mdash; &ldquo;{p.action_type}&rdquo; no longer interrupts; the policy keeps its other action types.</>
    ) : (
      <>Deactivated &mdash; &ldquo;{p.policy_name}&rdquo; no longer interrupts. It remains at /policies, toggleable.</>
    ),
  dismissedText: 'Dismissed — this pattern stops re-proposing.',
  undoAfterAccepted: true,
  fetch: async () => {
    const payload = await fetchLooseningProposals();
    return { items: payload.proposals ?? [], windowDays: payload.window_days };
  },
  view: (p) => {
    const status: Phase = p.status === 'ratified' ? 'accepted' : p.status === 'dismissed' ? 'dismissed' : 'pending';
    const ev = p.evidence;
    return {
      key: p.id,
      title: p.title,
      badge: p.rule === 'relax_policy_scope' ? 'carve-out' : 'deactivate',
      mono: looseningMono(p),
      evidence: [
        <>
          {`${ev.fired} interrupted · ${ev.approvals.approved} approved, ${ev.approvals.denied} denied (${Math.round(ev.override_rate * 1000) / 10}% overridden) · last ${ev.window_days} day${ev.window_days === 1 ? '' : 's'}`}
          {' · '}
          <Link href="/decisions" className="text-brand hover:underline">evidence in the decisions ledger</Link>
        </>,
      ],
      phase: status,
    };
  },
  primary: (p) => ratifyLooseningProposal(p),
  dismiss: (p, reason) => dismissLooseningProposal(p, reason),
  undo: (p) => undoLooseningDecision(p.id),
};

const CALIBRATION_RULE_LABELS: Record<CalibrationProposal['rule'], string> = {
  over_scored_benign: 'Over-scored benign',
  under_scored_danger: 'Under-scored danger',
  repeated_approvals: 'Repeated approvals',
};

function calibrationShape(proposal: CalibrationProposal): string {
  const rep = proposal.representative || {};
  return String(rep.command_shape || rep.declared_goal || rep.action_type || '(no shape)').slice(0, 120);
}

function calibrationEvidence(proposal: CalibrationProposal): ReactNode | null {
  if (proposal.from_snapshot) return null;
  const parts = [`${proposal.count} event${proposal.count === 1 ? '' : 's'}`];
  if (proposal.evidence_tier) parts.push(`tier ${proposal.evidence_tier.replace(/_/g, ' ')}`);
  if (proposal.risk_min != null) {
    parts.push(proposal.risk_min === proposal.risk_max ? `risk ${proposal.risk_min}` : `risk ${proposal.risk_min}–${proposal.risk_max}`);
  }
  return parts.join(' · ');
}

const calibrationAdapter: ProposalAdapter<CalibrationProposal> = {
  queue: 'calibration',
  anchorId: 'calibration',
  label: 'Calibration',
  description: "Shapes mined from your own ledger where the risk scorer looks miscalibrated — ratifying queues a golden vector for the maintainer; nothing changes until it's forged and committed.",
  errorText: "Couldn't load calibration proposals.",
  emptyText: (wd) => `No pending calibration in the last ${wd ?? 30} days — the scorer and your approvals agree.`,
  reasonRequired: true,
  primaryVerb: 'Ratify',
  hasPrimary: () => true,
  primaryArmed: () => (
    <>Records your ratification &mdash; the maintainer forges it into the corpus and commits; nothing changes until then.</>
  ),
  primaryConfirm: () => 'Confirm — ratify',
  accepted: () => <>Ratified &mdash; queued for the maintainer forge.</>,
  dismissedText: 'Dismissed.',
  undoAfterAccepted: true,
  terminal: (p) => <>In corpus as <span className="font-mono">{p.decision?.vector_name}</span>.</>,
  fetch: async () => {
    const payload = await fetchCalibrationProposals();
    return { items: payload.proposals, windowDays: payload.window_days };
  },
  view: (p) => {
    const status: Phase =
      p.status === 'forged' ? 'terminal'
        : p.status === 'ratified' ? 'accepted'
          : p.status === 'dismissed' ? 'dismissed'
            : 'pending';
    return {
      key: p.candidate_id,
      title: CALIBRATION_RULE_LABELS[p.rule] ?? p.rule,
      badge: p.suggested_label,
      mono: calibrationShape(p),
      evidence: calibrationEvidence(p) ? [calibrationEvidence(p)] : [],
      provenance: p.provenance || undefined,
      note: p.needs_manual_context
        ? 'Redacted shape — the maintainer supplies the runnable command at forge time.'
        : undefined,
      phase: status,
    };
  },
  primary: (p) => ratifyProposal(p),
  dismiss: (p, reason) => dismissCalibrationProposal(p, reason),
  undo: (p) => undoCalibrationDecision(p.candidate_id),
};

// ---------------------------------------------------------------------------
// Behavior queue — the outlier: simulate-gated adopt, suppress-similar dismiss,
// and a "Refine in Policy Coach" link instead of an inline edit modal.
// ---------------------------------------------------------------------------

const BEHAVIOR_TYPE_LABELS: Record<string, string> = {
  destructive_command_approval: 'Destructive commands → approval',
  protected_path_approval: 'Protected paths → approval',
  repeated_reload_warn: 'Repeated file reloads',
  failed_loop_warn: 'Repeated command failures',
  model_task_mismatch_warn: 'Cheap model on heavy task',
  agent_allowlist: 'Safe operating envelope',
};

function simLine(sim: BehaviorSimulation): string {
  const parts = [
    `replay ${sim.total}`,
    `allow ${sim.allow}`,
    `warn ${sim.warn}`,
    `approval ${sim.require_approval}`,
    `block ${sim.block}`,
  ];
  if (sim.likely_false_positives && sim.likely_false_positives > 0) {
    parts.push(`${sim.likely_false_positives} likely false positive${sim.likely_false_positives === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

interface BehaviorRowProps {
  s: BehaviorSuggestion;
  phase: Phase;
  acceptedNote?: ReactNode;
  sim?: BehaviorSimulation | null;
  busy?: boolean;
  rowError?: string | null;
  onSimulate: (s: BehaviorSuggestion) => void;
  onAdopt: (s: BehaviorSuggestion) => void;
  onDismiss: (s: BehaviorSuggestion, reason: string, suppressSimilar: boolean) => void;
  onUndo: (s: BehaviorSuggestion) => void;
}

function BehaviorRow({
  s, phase, acceptedNote, sim, busy, rowError, onSimulate, onAdopt, onDismiss, onUndo,
}: BehaviorRowProps) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [suppress, setSuppress] = useState(false);
  const label = BEHAVIOR_TYPE_LABELS[s.type] ?? s.type;
  const title = `${label} · ${s.agent_id}`;
  const adoptLabel = s.advisory ? 'Accept observation' : 'Adopt as draft';

  return (
    <li className="py-3 space-y-1.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-primary">
          {label}
          <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-secondary">
            {s.enforceable ? 'enforceable' : 'advisory'}
          </span>
          <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs font-normal text-secondary">
            {s.severity}
          </span>
        </p>
        <p className="text-sm text-secondary font-mono">{s.agent_id}</p>
        <p className="text-sm text-secondary">{s.expected_effect}</p>
        <p className="text-xs text-tertiary">
          {s.matching_sample_size} of {s.sample_size} samples · target {s.target} · confidence {s.confidence}% · FP risk {s.false_positive_risk}
        </p>
        {sim && <p className="text-xs text-tertiary">{simLine(sim)}</p>}
      </div>

      {phase === 'accepted' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">{acceptedNote ?? 'Adopted.'}</span>
          <button
            type="button"
            onClick={() => onUndo(s)}
            aria-label={`Undo adopt for ${title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : phase === 'dismissed' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-secondary">Dismissed.</span>
          <button
            type="button"
            onClick={() => onUndo(s)}
            aria-label={`Undo dismiss for ${title}`}
            className={BTN_NEUTRAL}
          >
            Undo
          </button>
        </div>
      ) : dismissing ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label htmlFor={`spine-behavior-dismiss-${s.id}`} className="sr-only">
              Reason for dismissing {title}
            </label>
            <input
              id={`spine-behavior-dismiss-${s.id}`}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              aria-label={`Reason for dismissing ${title}`}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = reason.trim();
                setDismissing(false);
                setReason('');
                onDismiss(s, trimmed, suppress);
                setSuppress(false);
              }}
              aria-label={`Confirm dismiss for ${title}`}
              className={BTN_NEUTRAL}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => { setDismissing(false); setReason(''); setSuppress(false); }}
              className={BTN_NEUTRAL}
            >
              Cancel
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={suppress}
              onChange={(e) => setSuppress(e.target.checked)}
              className="accent-brand"
            />
            Suppress similar suggestions of this type for this agent
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSimulate(s)}
            aria-label={`${sim ? 'Re-simulate' : 'Simulate'}: ${title}`}
            className={`${BTN_NEUTRAL} disabled:opacity-50`}
          >
            {sim ? 'Re-simulate' : 'Simulate'}
          </button>
          <button
            type="button"
            disabled={busy || !sim}
            title={!sim ? 'Simulate first' : undefined}
            onClick={() => onAdopt(s)}
            aria-label={`${adoptLabel}: ${title}`}
            className={`${BTN_WARNING} disabled:opacity-50`}
          >
            {adoptLabel}
          </button>
          <button
            type="button"
            onClick={() => setDismissing(true)}
            aria-label={`Dismiss: ${title}`}
            className={BTN_NEUTRAL}
          >
            Dismiss&hellip;
          </button>
          <Link href="/policy-coach" className="text-xs text-tertiary hover:text-brand hover:underline">
            Refine in Policy Coach &rarr;
          </Link>
        </div>
      )}
      <RowError message={rowError} />
    </li>
  );
}

function BehaviorGroup({ onCount }: { onCount: (pending: number) => void }) {
  const [items, setItems] = useState<BehaviorSuggestion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [phases, setPhases] = useState<Record<string, { phase: Phase; node?: ReactNode }>>({});
  const [sims, setSims] = useState<Record<string, BehaviorSimulation | null>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchBehaviorSuggestions();
      setItems(payload.suggestions);
      setPhases({});
      setSims({});
      setRowErrors({});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const phaseOf = (id: string): Phase => phases[id]?.phase ?? 'pending';
  const pending = items ? items.filter((s) => phaseOf(s.id) === 'pending').length : 0;
  useEffect(() => { onCount(pending); }, [pending, onCount]);

  const clearErr = (id: string) =>
    setRowErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });

  const handleSimulate = useCallback((s: BehaviorSuggestion) => {
    clearErr(s.id);
    setBusy((prev) => ({ ...prev, [s.id]: true }));
    simulateBehaviorSuggestion(s.id)
      .then((sim) => setSims((prev) => ({ ...prev, [s.id]: sim })))
      .catch((e: unknown) => setRowErrors((prev) => ({ ...prev, [s.id]: (e as Error).message ?? 'Simulation failed' })))
      .finally(() => setBusy((prev) => { const next = { ...prev }; delete next[s.id]; return next; }));
  }, []);

  const handleAdopt = useCallback((s: BehaviorSuggestion) => {
    clearErr(s.id);
    setBusy((prev) => ({ ...prev, [s.id]: true }));
    adoptBehaviorSuggestion(s.id)
      .then((res) => {
        const node = res.note || (res.advisory ? 'Observation accepted.' : 'Draft policy created (inactive).');
        setPhases((prev) => ({ ...prev, [s.id]: { phase: 'accepted', node } }));
      })
      .catch((e: unknown) => setRowErrors((prev) => ({ ...prev, [s.id]: (e as Error).message ?? 'Adoption failed' })))
      .finally(() => setBusy((prev) => { const next = { ...prev }; delete next[s.id]; return next; }));
  }, []);

  const handleDismiss = useCallback((s: BehaviorSuggestion, reason: string, suppress: boolean) => {
    clearErr(s.id);
    setPhases((prev) => ({ ...prev, [s.id]: { phase: 'dismissed' } }));
    dismissBehaviorSuggestion(s.id, reason || null, suppress).catch((e: unknown) => {
      setPhases((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
      setRowErrors((prev) => ({ ...prev, [s.id]: (e as Error).message ?? 'Dismiss failed' }));
    });
  }, []);

  const handleUndo = useCallback((s: BehaviorSuggestion) => {
    clearErr(s.id);
    undoBehaviorSuggestion(s.id)
      .then(() => setPhases((prev) => ({ ...prev, [s.id]: { phase: 'pending' } })))
      .catch((e: unknown) => setRowErrors((prev) => ({ ...prev, [s.id]: (e as Error).message ?? 'Undo failed' })));
  }, []);

  return (
    <div id="behavior" className="scroll-mt-20">
      <span className={GROUP_LABEL}>Behavior</span>
      <p className="mt-1 text-sm text-tertiary">
        Evidence-backed suggestions learned from recorded agent behavior — simulate the impact, then adopt as an
        inactive draft or accept the observation. Nothing is enforced until you activate it.
      </p>

      {loading ? (
        <div className="mt-2 space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between border-t border-border py-4 text-sm">
          <span className="text-tertiary">Couldn&apos;t load behavior suggestions.</span>
          <button onClick={load} className="text-brand hover:underline text-xs">Retry &rsaquo;</button>
        </div>
      ) : items && items.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {items.map((s) => (
            <BehaviorRow
              key={s.id}
              s={s}
              phase={phaseOf(s.id)}
              acceptedNote={phases[s.id]?.node}
              sim={sims[s.id]}
              busy={busy[s.id] ?? false}
              rowError={rowErrors[s.id] ?? null}
              onSimulate={handleSimulate}
              onAdopt={handleAdopt}
              onDismiss={handleDismiss}
              onUndo={handleUndo}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-tertiary">
          No pending behavior suggestions — turn on the recorder in Policy Coach to learn new ones.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The spine: one section, five labeled groups, one decision grammar.
// ---------------------------------------------------------------------------

const QUEUE_LABELS: Record<QueueKey, string> = {
  tuning: 'Tuning',
  tightening: 'Tightening',
  loosening: 'Loosening',
  calibration: 'Calibration',
  behavior: 'Behavior',
};

export default function JudgmentSpine() {
  const [counts, setCounts] = useState<Record<QueueKey, number | null>>({
    tuning: null, tightening: null, loosening: null, calibration: null, behavior: null,
  });

  const setCount = useCallback((queue: QueueKey, n: number) => {
    setCounts((prev) => (prev[queue] === n ? prev : { ...prev, [queue]: n }));
  }, []);

  const onCountTuning = useCallback((n: number) => setCount('tuning', n), [setCount]);
  const onCountTightening = useCallback((n: number) => setCount('tightening', n), [setCount]);
  const onCountLoosening = useCallback((n: number) => setCount('loosening', n), [setCount]);
  const onCountCalibration = useCallback((n: number) => setCount('calibration', n), [setCount]);
  const onCountBehavior = useCallback((n: number) => setCount('behavior', n), [setCount]);

  const total = (Object.values(counts) as (number | null)[])
    .reduce<number>((sum, n) => sum + (n ?? 0), 0);

  return (
    <section aria-labelledby="judgment-queue-heading" className="space-y-8">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="judgment-queue-heading" className="text-sm font-semibold text-primary">
            Judgment queue{total > 0 ? <span className="ml-2 text-tertiary tabular-nums">{total} pending</span> : null}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
            {(Object.keys(QUEUE_LABELS) as QueueKey[]).map((q) => (
              <span key={q} className={counts[q] ? 'text-secondary' : undefined}>
                {QUEUE_LABELS[q]} <span className="tabular-nums">{counts[q] ?? '—'}</span>
              </span>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-tertiary">
          Every pending judgment across tuning, tightening, loosening, calibration, and behavior — one place, one decision grammar.
          A human ratifies each one; nothing changes until you click.
        </p>
      </div>

      <ProposalGroup adapter={tuningAdapter} onCount={onCountTuning} />
      <ProposalGroup adapter={tighteningAdapter} onCount={onCountTightening} />
      <ProposalGroup adapter={looseningAdapter} onCount={onCountLoosening} />
      <ProposalGroup adapter={calibrationAdapter} onCount={onCountCalibration} />
      <BehaviorGroup onCount={onCountBehavior} />
    </section>
  );
}
