'use client';

// Unified "Needs your call" triage inbox for the redesigned /policies page.
// Merges five previously-separate decision queues — warn-group verdicts, tuning,
// tightening, loosening, and calibration — into one list with one decision
// grammar. Each queue keeps its own server semantics (see the *Client modules);
// this component only unifies the surface. Nothing changes until a human clicks.

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  Check,
  RotateCcw,
  TriangleAlert,
  SlidersHorizontal,
  ShieldPlus,
  ShieldMinus,
  Gauge,
  ChevronDown,
  BellOff,
} from 'lucide-react';
import styles from '../policies.module.css';
import ApprovalFloodBanner from '../../components/ApprovalFloodBanner';
import { Skeleton } from '../../components/ui/Skeleton';
import { shapeIsGrantable } from '../../lib/policy-shapes';
import { fetchReview, postVerdict, type WarnGroup } from '../lib/contractClient';
import {
  fetchProposals,
  dismissProposal,
  undismissProposal,
  acceptProposal,
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
  isPrecedent,
  isBudget,
  type AnyLooseningProposal,
} from '../lib/looseningClient';
import {
  fetchCalibrationProposals,
  ratifyProposal,
  dismissCalibrationProposal,
  undoCalibrationDecision,
  CALIBRATION_RULE_LABEL,
  type CalibrationProposal,
} from '../lib/calibrationClient';
import {
  addShapeException,
  removeShapeException,
  muteMisfire,
  unmuteMisfire,
  isMisfireMuted,
  type Misfire,
} from '../lib/misfireClient';

interface TriageInboxProps {
  /** Called after ANY action that alters policies/decisions so the parent
   *  refetches summary/contract/ledger. */
  onChanged: () => void;
  /** Reports total pending items (sum of all five queues) when it changes. */
  onCount?: (pending: number) => void;
}

// One item per row; discriminated by kind. Keys are prefixed so ids never
// collide across queues.
type InboxItem =
  | { kind: 'warn'; key: string; group: WarnGroup }
  | { kind: 'tuning'; key: string; proposal: TuningProposal }
  | { kind: 'tighten'; key: string; proposal: TighteningProposal }
  | { kind: 'loosen'; key: string; proposal: AnyLooseningProposal }
  | { kind: 'calibration'; key: string; proposal: CalibrationProposal }
  // Pinned first: one command shape held three times in 24h by ONE Short List
  // line. A report, not a proposal — the exit is a shape-scoped exception.
  | { kind: 'misfire'; key: string; misfire: Misfire };

// Once a user acts, the resolution is the source of truth for that row — it
// survives a background parent refetch (only our own load() resets it).
type Resolution =
  | { type: 'gone' } // warn "fine": cleared review state, no rule, row removed
  // `undoNote` says why the strip has no Undo — a resolved row that simply
  // drops the verb reads as a bug; one that says "append-only" reads as law.
  | { type: 'strip'; node: ReactNode; undo?: () => Promise<void>; undoNote?: string };

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function errMsg(e: unknown): string {
  return (e as Error)?.message ?? 'Something went wrong';
}

const code = (v: ReactNode) => <code className={styles.code}>{v}</code>;

// ---------------------------------------------------------------------------
// Per-kind descriptor: tag, icon, plain-English lead, and evidence facts.
// ---------------------------------------------------------------------------

interface Descriptor {
  tagClass: string | undefined;
  Icon: typeof TriangleAlert;
  label: string;
  lead: ReactNode;
  evidence: ReactNode[];
}

function describe(item: InboxItem): Descriptor {
  switch (item.kind) {
    case 'warn': {
      const { shape, count, latest_at, sample_goal } = item.group;
      const evidence: ReactNode[] = [
        <>Fired <b>{count}&times;</b> recently</>,
        <>last <b>{relativeTime(latest_at)}</b></>,
      ];
      if (sample_goal) evidence.push(<>sample: {truncate(sample_goal, 60)}</>);
      return {
        tagClass: styles.ktWarn,
        Icon: TriangleAlert,
        label: 'Warn group',
        lead: (
          <>
            Agents keep tripping the warn on {code(shape.action_type)}
            {shape.target_prefix ? <> under {code(shape.target_prefix)}</> : null}.
          </>
        ),
        evidence,
      };
    }
    case 'tuning': {
      const p = item.proposal;
      const { fired, approvals, override_rate } = p.evidence;
      const evidence: ReactNode[] = [
        <>Interrupted <b>{fired.require_approval}&times;</b></>,
        <><b>{approvals.approved}</b> approved / <b>{approvals.denied}</b> denied</>,
      ];
      if (override_rate != null) {
        evidence.push(<>override <b>{Math.round(override_rate * 100)}%</b></>);
      }
      return {
        tagClass: styles.ktTune,
        Icon: SlidersHorizontal,
        label: 'Tuning',
        lead: p.title || p.summary,
        evidence,
      };
    }
    case 'tighten': {
      const p = item.proposal;
      const { observed_count, risk_max } = p.evidence;
      return {
        tagClass: styles.ktTight,
        Icon: ShieldPlus,
        label: 'Tighten',
        lead: p.title,
        evidence: [
          <>observed <b>{observed_count}&times;</b></>,
          <>peak risk <b>{risk_max}</b></>,
          <>risk <b>{p.risk_level}</b></>,
        ],
      };
    }
    case 'loosen': {
      const p = item.proposal;
      // A precedent counts evidence per SHAPE (approvals, spread across days),
      // not per policy, so it has no override rate to show. The day count is
      // the load-bearing number: it is what separates a considered pattern
      // from one frantic session, and the operator should see it.
      if (isPrecedent(p)) {
        return {
          tagClass: styles.ktLoose,
          Icon: ShieldMinus,
          label: 'Loosen',
          lead: p.title,
          evidence: [
            <>you approved <b>{p.evidence.approved}&times;</b></>,
            <>across <b>{p.evidence.distinct_days}</b> days</>,
            <>never denied</>,
            <>expires in <b>{p.ttl_days}d</b></>,
          ],
        };
      }
      // An interruption-budget report has NO approval evidence by design — the
      // whole point is that it fires when nobody resolved anything. Showing an
      // override rate here would be showing a rate over zero samples.
      if (isBudget(p)) {
        return {
          tagClass: styles.ktLoose,
          Icon: ShieldMinus,
          label: 'Loosen',
          lead: p.title,
          evidence: [
            <><b>{p.evidence.fired}&times;</b> in {p.evidence.window_hours}h</>,
            <>budget <b>{p.evidence.budget}</b></>,
            p.auto_demoted
              ? <>now <b>warning only</b></>
              : <><b>still interrupting</b> (ungrantable)</>,
          ],
        };
      }
      const { approvals, override_rate } = p.evidence;
      const resolved = approvals.approved + approvals.denied;
      return {
        tagClass: styles.ktLoose,
        Icon: ShieldMinus,
        label: 'Loosen',
        lead: p.title,
        evidence: [
          <><b>{approvals.approved}</b>/<b>{resolved}</b> approved</>,
          <>override <b>{Math.round(override_rate * 100)}%</b></>,
        ],
      };
    }
    case 'misfire': {
      const m = item.misfire;
      // The rows carry no adjudication outcome by design (the operator who is
      // drowning is the one who stops clicking), so volume alone is the line.
      const resolved = m.approvals + m.denials;
      return {
        tagClass: styles.ktLoose,
        Icon: BellOff,
        label: 'Misfire',
        lead: (
          <>
            &ldquo;{m.shape_key}&rdquo; was held by {m.policy_name} {m.count} times in {m.window_hours}h.
          </>
        ),
        evidence: resolved > 0
          ? [<><b>{m.approvals}</b> approvals</>, <><b>{m.denials}</b> denials</>]
          : [<><b>{m.count}</b> holds</>],
      };
    }
    case 'calibration': {
      const p = item.proposal;
      const evidence: ReactNode[] = [];
      // The mining rule leads: one shape can mine under two rules at once, and
      // those candidates match on name, count, risk band and tier. Without the
      // rule the operator gets two identical rows and no way to tell them apart.
      const ruleLabel = CALIBRATION_RULE_LABEL[p.rule];
      if (ruleLabel) evidence.push(<>{ruleLabel}</>);
      if (p.count != null) evidence.push(<><b>{p.count}&times;</b> events</>);
      if (p.risk_min != null && p.risk_max != null) {
        evidence.push(
          <>risk <b>{p.risk_min === p.risk_max ? p.risk_min : `${p.risk_min}–${p.risk_max}`}</b></>,
        );
      }
      evidence.push(<span className={styles.mono}>opens in /calibration</span>);
      return {
        tagClass: styles.ktCal,
        Icon: Gauge,
        label: 'Calibration',
        lead: p.suggested_name || 'Risk scorer looks miscalibrated on this shape.',
        evidence,
      };
    }
  }
}

// The consequence spelled out at the armed step (second click).
function armedConsequence(item: InboxItem): string {
  switch (item.kind) {
    case 'warn':
      return `Adds a Short List line that holds ${item.group.shape.action_type} for your approval`;
    case 'misfire':
      return `Stops this one shape on "${item.misfire.policy_name}" — the line keeps enforcing everything else`;
    case 'tuning':
      return `Applies now to "${item.proposal.policy_name}"`;
    case 'tighten':
      return `Creates a require-approval rule for ${item.proposal.action_type}`;
    case 'loosen':
      // The effect line must state the SCOPE, not just the act. A precedent
      // creates standing authority, so say what it covers and for how long.
      if (isPrecedent(item.proposal)) {
        return `Creates a ${item.proposal.ttl_days}-day grant for this exact kind of action — nothing else`;
      }
      // Budget ratify is PERMANENT deactivation, not the guard's temporary
      // downgrade. Saying "relaxes" here would understate it.
      if (isBudget(item.proposal)) {
        return `Turns "${item.proposal.policy_name}" off for good — the automatic downgrade is only temporary`;
      }
      return `Relaxes "${item.proposal.policy_name}" now`;
    case 'calibration':
      return 'Queues a golden vector for the maintainer to forge';
  }
}

// Primary verb (default) and its armed confirm label.
const PRIMARY: Record<InboxItem['kind'], { verb: string; confirm: string }> = {
  warn: { verb: 'Stop warning', confirm: 'Confirm: promote to Hold' }, // warn primary handled by split button
  misfire: { verb: 'Stop asking', confirm: 'Confirm: stop asking' },
  tuning: { verb: 'Ratify', confirm: 'Confirm: apply' },
  tighten: { verb: 'Create rule', confirm: 'Confirm: create rule' },
  loosen: { verb: 'Relax', confirm: 'Confirm: relax' },
  calibration: { verb: 'Queue vector', confirm: 'Confirm: queue vector' },
};

// ---------------------------------------------------------------------------
// Row — renders the three parts (kind, body, acts) plus every interactive
// state (armed / dismissing / resolved-strip). Local state is UI-only; the
// resolution + async live in the parent so optimism survives a refetch.
// ---------------------------------------------------------------------------

interface RowProps {
  item: InboxItem;
  resolution: Resolution | undefined;
  busy: boolean;
  error: string | null;
  onFine: (item: InboxItem) => void;
  onWarnPrimary: (item: InboxItem, verdict: 'always_allow' | 'tighten') => void;
  onRetro: (item: InboxItem, verdict: 'retro_fine' | 'retro_stop') => void;
  onPrimary: (item: InboxItem) => void;
  onDismiss: (item: InboxItem, reason: string) => void;
  onUndo: (item: InboxItem, undo: () => Promise<void>) => void;
}

function InboxRow({
  item,
  resolution,
  busy,
  error,
  onFine,
  onWarnPrimary,
  onRetro,
  onPrimary,
  onDismiss,
  onUndo,
}: RowProps) {
  const [armed, setArmed] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const d = describe(item);
  const primary = PRIMARY[item.kind];
  const leadLabel = typeof d.lead === 'string' ? d.lead : d.label;
  // The new verbs repeat once per row, so their labels have to name the row:
  // "Yes" five times over is five identical buttons to a screen reader.
  const rowName =
    item.kind === 'warn'
      ? item.group.shape.label
      : item.kind === 'misfire'
        ? `"${item.misfire.shape_key}" on ${item.misfire.policy_name}`
        : leadLabel;
  const whyId = `triage-why-${item.key}`;
  // A warn group is grantable only when its shape carries a target. Most Bash
  // groups don't: the hook forwards `target` only for a shell redirection or a
  // script-then-execute hit, so the common case reaches this row unscoped.
  const grantable = item.kind !== 'warn' || shapeIsGrantable(item.group.shape.target_prefix);

  // ----- resolved: show the landed/dismissed strip + Undo -----
  let acts: ReactNode;
  let expansion: ReactNode = null;

  if (resolution?.type === 'strip') {
    acts = (
      <>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{resolution.node}</span>
        {resolution.undo ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUndo(item, resolution.undo!)}
            aria-label={`Undo for ${leadLabel}`}
            className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
          >
            <RotateCcw size={13} aria-hidden="true" />
            Undo
          </button>
        ) : resolution.undoNote ? (
          <button
            type="button"
            disabled
            title={resolution.undoNote}
            aria-label={`Undo unavailable for ${leadLabel} — ${resolution.undoNote}`}
            className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
          >
            <RotateCcw size={13} aria-hidden="true" />
            Undo
          </button>
        ) : null}
      </>
    );
  } else if (armed) {
    // Second-click confirm for the consequential primary.
    expansion = (
      <div style={{ color: 'var(--color-warning)', fontSize: '12px', marginTop: '8px' }}>
        {armedConsequence(item)}
      </div>
    );
    acts = (
      <>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setArmed(false);
            if (item.kind === 'warn') onWarnPrimary(item, 'tighten');
            else onPrimary(item);
          }}
          aria-label={`${primary.confirm} for ${leadLabel}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
        >
          {primary.confirm}
        </button>
      </>
    );
  } else if (dismissing) {
    expansion = (
      <div className={styles.inboxReason}>
        <label htmlFor={`triage-reason-${item.key}`} className={styles.mono} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Reason for dismissing {leadLabel}
        </label>
        <input
          id={`triage-reason-${item.key}`}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          aria-label={`Reason for dismissing ${leadLabel}`}
        />
      </div>
    );
    acts = (
      <>
        <button
          type="button"
          onClick={() => {
            setDismissing(false);
            setReason('');
          }}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => {
            const trimmed = reason.trim();
            setDismissing(false);
            setReason('');
            onDismiss(item, trimmed);
          }}
          aria-label={`Confirm dismiss for ${leadLabel}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
        >
          Confirm
        </button>
      </>
    );
  } else if (item.kind === 'misfire') {
    // Report, not proposal: one consequential verb (two-click), one that costs
    // nothing, and the blast radius on demand. No reason box — "keep asking"
    // means the interruption was RIGHT, which needs no justification.
    acts = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => setArmed(true)}
          aria-label={`Stop asking about ${rowName}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
        >
          <BellOff size={13} aria-hidden="true" />
          Stop asking about &quot;{item.misfire.shape_key}&quot;
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDismiss(item, 'keep asking')}
          aria-label={`Keep asking about ${rowName}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
        >
          Keep asking
        </button>
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          aria-expanded={whyOpen}
          aria-controls={whyId}
          aria-label={`Why? Effect of stopping ${rowName}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
        >
          Why?
        </button>
      </>
    );
  } else if (item.kind === 'warn') {
    // Three verbs kept compact via a split button: the primary, with a caret
    // menu for the rest. WHICH verb leads depends on whether the shape can be
    // granted at all — an unscoped shape has no target to grant, and offering
    // "Always allow" on one is offering a guaranteed 400 (see grantable above).
    acts = (
      <div className={styles.retroStack}>
        {/* The retrospective pair leads: it is the only verdict that costs the
            agent nothing, and the only one a quiet posture can ever earn. */}
        <div className={styles.retroAsk}>
          <span className={styles.retroQ}>Would you have wanted these stopped?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetro(item, 'retro_stop')}
            aria-label={`Yes — ${rowName} should have been stopped`}
            className={`${styles.btn} ${styles.btnSm}`}
          >
            Yes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetro(item, 'retro_fine')}
            aria-label={`No — ${rowName} was fine`}
            className={`${styles.btn} ${styles.btnSm}`}
          >
            No
          </button>
        </div>
        <div
          className={styles.splitBtn}
          ref={splitRef}
        onBlur={(e) => {
          if (!splitRef.current?.contains(e.relatedTarget as Node)) setMenuOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMenuOpen(false);
        }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => (grantable ? onWarnPrimary(item, 'always_allow') : onFine(item))}
          aria-label={`${grantable ? 'Stop warning' : 'Mark fine'} ${leadLabel}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnSuccess}`}
        >
          <Check size={13} aria-hidden="true" />
          {grantable ? 'Stop warning' : 'Mark fine'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More verdicts"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnSuccess} ${styles.caretBtn}`}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className={styles.splitBtnMenu} role="menu">
            {grantable && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onFine(item);
                }}
              >
                <Check size={13} aria-hidden="true" />
                Mark fine
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setArmed(true);
              }}
            >
              <ShieldPlus size={13} aria-hidden="true" />
              Promote to Hold&hellip;
            </button>
          </div>
        )}
        </div>
      </div>
    );
  } else {
    // Proposal default: Dismiss (ghost danger, left) + primary (right).
    const canPrimary = item.kind !== 'tuning' || !!item.proposal.patch?.rules;
    acts = (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDismissing(true)}
          aria-label={`Dismiss ${leadLabel}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost} ${styles.btnDanger}`}
        >
          Dismiss&hellip;
        </button>
        {canPrimary && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setArmed(true)}
            aria-label={`${primary.verb} for ${leadLabel}`}
            className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
          >
            {primary.verb}
          </button>
        )}
      </>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.inboxItem}>
        <div className={styles.inboxKind}>
          <span className={`${styles.kindTag} ${d.tagClass}`}>
            <d.Icon size={12} aria-hidden="true" />
            {d.label}
          </span>
        </div>
        <div className={styles.inboxBody}>
          <div className={styles.lead}>{d.lead}</div>
          <div className={styles.evidence}>
            {d.evidence.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
          {expansion}
          {item.kind === 'misfire' && whyOpen && !resolution && (
            <div id={whyId} className={styles.rowNote}>
              A shape-scoped exception on this one line. The line keeps enforcing
              everything else. Undo from the Short List &rarr; Details.
            </div>
          )}
          {item.kind === 'warn' && !grantable && !resolution && (
            <div className={styles.rowNote}>
              No target scope:{' '}
              {code(item.group.shape.action_type)}{' '}
              actions here name no file or host. A &ldquo;stop warning&rdquo; would cover every{' '}
              {item.group.shape.action_type} action and switch off any approval rule for it.{' '}
              <b>Mark fine</b> hides this until it happens again; <b>Promote to Hold</b> makes it ask first.
            </div>
          )}
          {error && <div className={styles.rowError}>{error}</div>}
        </div>
        <div className={styles.inboxActs}>{acts}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — groups one kind into a collapsible, capped, bulk-clearable block.
// On a live instance a single queue can be dozens of items; grouping + a cap
// keeps the page short, and "Dismiss all" / "Mark all fine" clears the noise.
// ---------------------------------------------------------------------------

const SECTION_META: Array<{
  kind: InboxItem['kind'];
  label: string;
  Icon: typeof TriangleAlert;
  tagClass: string | undefined;
}> = [
  // Friction-removing first, enforcement last. A page that opens with "here is
  // more enforcement you could add" is a page people close. Misfires are pinned
  // above everything: they are the interruptions happening right now.
  { kind: 'misfire', label: 'Misfires', Icon: BellOff, tagClass: styles.ktLoose },
  { kind: 'loosen', label: 'Loosen', Icon: ShieldMinus, tagClass: styles.ktLoose },
  { kind: 'calibration', label: 'Calibration', Icon: Gauge, tagClass: styles.ktCal },
  { kind: 'warn', label: 'Warn groups', Icon: TriangleAlert, tagClass: styles.ktWarn },
  { kind: 'tuning', label: 'Tuning', Icon: SlidersHorizontal, tagClass: styles.ktTune },
  { kind: 'tighten', label: 'Tighten', Icon: ShieldPlus, tagClass: styles.ktTight },
];

const SECTION_CAP = 4;

type RowHandlers = Pick<RowProps, 'onFine' | 'onWarnPrimary' | 'onRetro' | 'onPrimary' | 'onDismiss' | 'onUndo'>;

interface SectionProps {
  meta: (typeof SECTION_META)[number];
  items: InboxItem[];
  pendingCount: number;
  resolutions: Record<string, Resolution>;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  handlers: RowHandlers;
  onFineAll: (items: InboxItem[]) => void;
  onDismissAll: (items: InboxItem[], reason: string) => void;
}

function InboxSection({
  meta,
  items,
  pendingCount,
  resolutions,
  busy,
  errors,
  handlers,
  onFineAll,
  onDismissAll,
}: SectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [bulkReason, setBulkReason] = useState<string | null>(null); // null = idle
  const [confirmFine, setConfirmFine] = useState(false);

  const { Icon, label, tagClass } = meta;
  const isWarn = meta.kind === 'warn';
  // Muting is per-shape judgment; a "mute all" button is how a report queue
  // becomes decorative.
  const bulkable = meta.kind !== 'misfire';
  const unresolved = items.filter((i) => !resolutions[i.key]);
  const shown = showAll ? items : items.slice(0, SECTION_CAP);
  const hiddenCount = items.length - shown.length;

  return (
    <div className={styles.inboxSection}>
      <div className={styles.sectionHead}>
        <button
          type="button"
          className={styles.headBtn}
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} (${pendingCount})`}
        >
          <ChevronDown size={15} className={`${styles.chev} ${collapsed ? styles.collapsed : ''}`} aria-hidden="true" />
          <span className={`${styles.kindTag} ${tagClass}`}>
            <Icon size={12} aria-hidden="true" />
            {label}
          </span>
          <span className={styles.sCount}>{pendingCount}</span>
        </button>

        {unresolved.length > 0 && bulkable &&
          (isWarn ? (
            confirmFine ? (
              <>
                <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setConfirmFine(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm}`}
                  onClick={() => {
                    setConfirmFine(false);
                    onFineAll(unresolved);
                  }}
                >
                  Confirm: mark {unresolved.length} fine
                </button>
              </>
            ) : (
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setConfirmFine(true)}>
                Mark all fine
              </button>
            )
          ) : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost} ${styles.btnDanger}`}
              onClick={() => setBulkReason((r) => (r == null ? '' : null))}
            >
              Dismiss all {unresolved.length}
            </button>
          ))}
      </div>

      {!collapsed && !isWarn && bulkReason != null && unresolved.length > 0 && (
        <div className={styles.bulkReason}>
          <input
            type="text"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            placeholder={`Reason to dismiss all ${unresolved.length} (required)`}
            aria-label={`Reason to dismiss all ${label}`}
          />
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setBulkReason(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!bulkReason.trim()}
            className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
            onClick={() => {
              const r = bulkReason.trim();
              setBulkReason(null);
              onDismissAll(unresolved, r);
            }}
          >
            Dismiss {unresolved.length}
          </button>
        </div>
      )}

      {!collapsed && (
        <div className={styles.sectionRows}>
          {shown.map((item) => (
            <InboxRow
              key={item.key}
              item={item}
              resolution={resolutions[item.key]}
              busy={busy[item.key] ?? false}
              error={errors[item.key] ?? null}
              {...handlers}
            />
          ))}
          {hiddenCount > 0 ? (
            <div className={styles.showMoreRow}>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setShowAll(true)}>
                Show {hiddenCount} more
              </button>
            </div>
          ) : showAll && items.length > SECTION_CAP ? (
            <div className={styles.showMoreRow}>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setShowAll(false)}>
                Show less
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The inbox.
// ---------------------------------------------------------------------------

export default function TriageInbox({ onChanged, onCount }: TriageInboxProps) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [markAllError, setMarkAllError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rev, tun, tig, loo, cal] = await Promise.allSettled([
      fetchReview(),
      fetchProposals(),
      fetchTighteningProposals(),
      fetchLooseningProposals(),
      fetchCalibrationProposals(),
    ]);

    const next: InboxItem[] = [];
    const failedQueues: string[] = [];

    if (rev.status === 'fulfilled') {
      for (const g of rev.value.groups) next.push({ kind: 'warn', key: `warn:${g.shape.key}`, group: g });
    } else failedQueues.push('warn groups');

    if (tun.status === 'fulfilled') {
      // No active policies at all — nothing to tune (parity with the old feed).
      if (tun.value.policies.length > 0) {
        for (const p of tun.value.proposals) {
          if (p.severity === 'actionable') next.push({ kind: 'tuning', key: `tune:${p.id}`, proposal: p });
        }
      }
    } else failedQueues.push('tuning');

    if (tig.status === 'fulfilled') {
      for (const p of tig.value.proposals) {
        if (p.status === 'pending') next.push({ kind: 'tighten', key: `tight:${p.id}`, proposal: p });
      }
    } else failedQueues.push('tightening');

    if (loo.status === 'fulfilled') {
      for (const p of loo.value.proposals) {
        if (p.status === 'pending') next.push({ kind: 'loosen', key: `loose:${p.id}`, proposal: p });
      }
      // Misfires ride the same payload — one report, one request.
      for (const m of loo.value.misfires ?? []) {
        if (isMisfireMuted(m.policy_id, m.shape_key)) continue;
        next.push({ kind: 'misfire', key: `misfire:${m.policy_id}:${m.shape_key}`, misfire: m });
      }
    } else failedQueues.push('loosening');

    if (cal.status === 'fulfilled') {
      for (const p of cal.value.proposals) {
        if (p.status === 'pending') next.push({ kind: 'calibration', key: `cal:${p.candidate_id}`, proposal: p });
      }
    } else failedQueues.push('calibration');

    setItems(next);
    setFailed(failedQueues);
    setResolutions({});
    setErrors({});
    setBusy({});
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ----- pending count reported up (ref keeps onCount out of the dep list) -----
  const pending = items.filter((it) => !resolutions[it.key]).length;
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);
  useEffect(() => {
    onCountRef.current?.(pending);
  }, [pending]);

  const clearErr = (key: string) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const nextErrs = { ...prev };
      delete nextErrs[key];
      return nextErrs;
    });
  const setErr = (key: string, msg: string) => setErrors((prev) => ({ ...prev, [key]: msg }));
  const setBusyKey = (key: string, v: boolean) =>
    setBusy((prev) => {
      if (v) return { ...prev, [key]: true };
      const nextBusy = { ...prev };
      delete nextBusy[key];
      return nextBusy;
    });
  const resolve = (key: string, res: Resolution) => setResolutions((prev) => ({ ...prev, [key]: res }));
  const unresolve = (key: string) =>
    setResolutions((prev) => {
      const nextRes = { ...prev };
      delete nextRes[key];
      return nextRes;
    });

  const warnShape = (g: WarnGroup) => ({
    action_type: g.shape.action_type,
    target_prefix: g.shape.target_prefix ?? null,
  });

  async function deletePolicy(id: string): Promise<void> {
    const res = await fetch(`/api/policies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Undo failed (${res.status})`);
    }
  }

  // warn "fine": optimistic remove, no rule created, revert on error.
  const handleFine = useCallback((item: InboxItem) => {
    if (item.kind !== 'warn') return;
    const { key } = item;
    clearErr(key);
    resolve(key, { type: 'gone' });
    postVerdict('fine', warnShape(item.group))
      .then(() => onChanged())
      .catch((e) => {
        unresolve(key);
        setErr(key, errMsg(e));
      });
  }, [onChanged]);

  // warn "always allow" / "tighten": create a rule, land a strip + Undo (delete).
  const handleWarnPrimary = useCallback(
    (item: InboxItem, verdict: 'always_allow' | 'tighten') => {
      if (item.kind !== 'warn') return;
      const { key } = item;
      const label = item.group.shape.label;
      clearErr(key);
      setBusyKey(key, true);
      postVerdict(verdict, warnShape(item.group), verdict === 'tighten' ? { short_list: true } : undefined)
        .then((res) => {
          const pid = res.policy?.id ?? null;
          const node = verdict === 'always_allow' ? `Stopped warning: ${label}` : `Promoted to Hold: ${label}`;
          resolve(key, { type: 'strip', node, undo: pid ? () => deletePolicy(pid) : undefined });
          onChanged();
        })
        .catch((e) => setErr(key, errMsg(e)))
        .finally(() => setBusyKey(key, false));
    },
    [onChanged],
  );

  // Retrospective verdict: one click, no arm. It creates no rule and stops
  // nothing — it labels a group the operator has already lived with, which is
  // the only calibration feedstock a quiet posture can produce. Append-only by
  // contract (spec §2.5), so the strip carries no Undo and says why.
  const handleRetro = useCallback(
    (item: InboxItem, verdict: 'retro_fine' | 'retro_stop') => {
      if (item.kind !== 'warn') return;
      const { key } = item;
      clearErr(key);
      setBusyKey(key, true);
      postVerdict(verdict, warnShape(item.group))
        .then((res) => {
          const n = res.labeled_total;
          resolve(key, {
            type: 'strip',
            node: n != null ? `Recorded — ${n} verdicts so far` : 'Recorded',
            undoNote: 'Verdicts are append-only.',
          });
          onChanged();
        })
        .catch((e) => setErr(key, errMsg(e)))
        .finally(() => setBusyKey(key, false));
    },
    [onChanged],
  );

  // proposal primary (ratify/apply) — dispatched by kind.
  const handlePrimary = useCallback(
    (item: InboxItem) => {
      const { key } = item;
      clearErr(key);
      setBusyKey(key, true);
      let work: Promise<{ node: ReactNode; undo?: () => Promise<void> }>;
      switch (item.kind) {
        case 'tuning':
          work = acceptProposal(item.proposal.policy_id, item.proposal.patch!.rules).then(() => ({
            node: 'Applied',
          }));
          break;
        case 'tighten':
          work = ratifyTighteningProposal(item.proposal).then(() => ({
            node: 'Rule created',
            undo: () => undoTighteningDecision(item.proposal.id),
          }));
          break;
        case 'loosen':
          work = ratifyLooseningProposal(item.proposal).then(() => ({
            node: 'Relaxed',
            undo: () => undoLooseningDecision(item.proposal.id),
          }));
          break;
        case 'misfire':
          work = addShapeException(item.misfire.policy_id, item.misfire.shape_key).then(() => ({
            node: `Stopped asking about "${item.misfire.shape_key}"`,
            undo: () => removeShapeException(item.misfire.policy_id, item.misfire.shape_key),
          }));
          break;
        case 'calibration':
          work = ratifyProposal(item.proposal).then(() => ({
            node: 'Queued for calibration',
            undo: () => undoCalibrationDecision(item.proposal.candidate_id),
          }));
          break;
        default:
          setBusyKey(key, false);
          return;
      }
      work
        .then(({ node, undo }) => {
          resolve(key, { type: 'strip', node, undo });
          onChanged();
        })
        .catch((e) => setErr(key, errMsg(e)))
        .finally(() => setBusyKey(key, false));
    },
    [onChanged],
  );

  // proposal dismiss (with reason) — dispatched by kind, undoable.
  const handleDismiss = useCallback(
    (item: InboxItem, reason: string) => {
      const { key } = item;
      clearErr(key);
      setBusyKey(key, true);
      let call: Promise<void>;
      let undo: () => Promise<void>;
      switch (item.kind) {
        case 'tuning':
          call = dismissProposal(item.proposal.id, reason);
          undo = () => undismissProposal(item.proposal.id);
          break;
        case 'tighten':
          call = dismissTighteningProposal(item.proposal, reason);
          undo = () => undoTighteningDecision(item.proposal.id);
          break;
        case 'loosen':
          call = dismissLooseningProposal(item.proposal, reason);
          undo = () => undoLooseningDecision(item.proposal.id);
          break;
        case 'calibration':
          call = dismissCalibrationProposal(item.proposal, reason);
          undo = () => undoCalibrationDecision(item.proposal.candidate_id);
          break;
        case 'misfire': {
          // "Keep asking" changes nothing about the org: the operator said the
          // interruption was right. It is a 24h mute in this browser so the
          // same report can come back when it happens again.
          const { policy_id, shape_key } = item.misfire;
          muteMisfire(policy_id, shape_key);
          call = Promise.resolve();
          undo = async () => unmuteMisfire(policy_id, shape_key);
          break;
        }
        default:
          setBusyKey(key, false);
          return;
      }
      call
        .then(() => {
          resolve(key, { type: 'strip', node: item.kind === 'misfire' ? 'Muted for 24h' : 'Dismissed', undo });
          onChanged();
        })
        .catch((e) => setErr(key, errMsg(e)))
        .finally(() => setBusyKey(key, false));
    },
    [onChanged],
  );

  // strip Undo — run the stored undo, then return the row to pending.
  const handleUndo = useCallback(
    (item: InboxItem, undo: () => Promise<void>) => {
      const { key } = item;
      clearErr(key);
      setBusyKey(key, true);
      undo()
        .then(() => {
          unresolve(key);
          onChanged();
        })
        .catch((e) => setErr(key, errMsg(e)))
        .finally(() => setBusyKey(key, false));
    },
    [onChanged],
  );

  // Bulk clear a whole section — reuses the per-item paths so optimism + undo
  // still work on each row.
  const handleFineAll = useCallback((its: InboxItem[]) => {
    its.forEach((it) => handleFine(it));
  }, [handleFine]);
  const handleDismissAll = useCallback((its: InboxItem[], reason: string) => {
    its.forEach((it) => handleDismiss(it, reason));
  }, [handleDismiss]);

  const handleMarkAll = useCallback(async () => {
    setMarkAllError(null);
    try {
      await postVerdict('mark_all_reviewed');
      onChanged();
      await load();
    } catch (e) {
      setMarkAllError(errMsg(e));
    }
  }, [load, onChanged]);

  const hasWarnGroups = items.some((it) => it.kind === 'warn');
  const visibleItems = items.filter((it) => resolutions[it.key]?.type !== 'gone');

  // An empty queue renders nothing at all — no card, no "nothing waiting" box.
  // An empty to-do list still reads as homework, and on day 0 this section is
  // empty by design. The flood banner still gets its chance: a flood is a live
  // condition, not a proposal, and it self-hides when there is none.
  if (!loading && visibleItems.length === 0 && failed.length === 0) {
    return (
      <div id="needs-your-call">
        <ApprovalFloodBanner
          onResolved={() => {
            load();
            onChanged();
          }}
        />
      </div>
    );
  }

  return (
    <section id="needs-your-call" aria-labelledby="triage-heading">
      {/* Section header */}
      <div className={styles.secHead}>
        <div className={styles.lhs}>
          <h2 id="triage-heading">Needs your call</h2>
          <span className={`${styles.countPill}${pending > 0 ? ` ${styles.hot}` : ''}`}>{pending}</span>
          <span className={styles.secHelp}>
            Observed patterns become one decision, one click. Verdicts here cost your agent nothing.
          </span>
        </div>
        <button
          type="button"
          disabled={!hasWarnGroups}
          onClick={handleMarkAll}
          className={`${styles.btn} ${styles.btnSm}`}
        >
          <Check size={14} aria-hidden="true" />
          Mark all reviewed
        </button>
      </div>
      {markAllError && <div className={styles.rowError}>{markAllError}</div>}

      {/* Flood banner (self-hides when there is no flood) */}
      <ApprovalFloodBanner
        onResolved={() => {
          load();
          onChanged();
        }}
      />

      {/* Unified inbox list */}
      {loading ? (
        <div className={styles.inbox}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.card}>
              <div className={styles.inboxItem}>
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div>
            {SECTION_META.map((meta) => {
              const kindItems = visibleItems.filter((it) => it.kind === meta.kind);
              if (kindItems.length === 0) return null;
              const pendingCount = kindItems.filter((it) => !resolutions[it.key]).length;
              return (
                <InboxSection
                  key={meta.kind}
                  meta={meta}
                  items={kindItems}
                  pendingCount={pendingCount}
                  resolutions={resolutions}
                  busy={busy}
                  errors={errors}
                  handlers={{
                    onFine: handleFine,
                    onWarnPrimary: handleWarnPrimary,
                    onRetro: handleRetro,
                    onPrimary: handlePrimary,
                    onDismiss: handleDismiss,
                    onUndo: handleUndo,
                  }}
                  onFineAll={handleFineAll}
                  onDismissAll={handleDismissAll}
                />
              );
            })}
          </div>
          <div className={styles.verbFoot}>
            <RotateCcw size={12} aria-hidden="true" />
            <span>
              Every action is undoable. <b>Dismiss</b> (with a reason) clears an item without a rule.
            </span>
          </div>
        </>
      )}

      {failed.length > 0 && (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px', marginTop: '8px' }}>
          Couldn&apos;t load: {failed.join(', ')}.
        </div>
      )}
    </section>
  );
}
