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
  Inbox,
  TriangleAlert,
  SlidersHorizontal,
  ShieldPlus,
  ShieldMinus,
  Gauge,
  ChevronDown,
} from 'lucide-react';
import styles from '../policies.module.css';
import ApprovalFloodBanner from '../../components/ApprovalFloodBanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
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
  type LooseningProposal,
} from '../lib/looseningClient';
import {
  fetchCalibrationProposals,
  ratifyProposal,
  dismissCalibrationProposal,
  undoCalibrationDecision,
  type CalibrationProposal,
} from '../lib/calibrationClient';

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
  | { kind: 'loosen'; key: string; proposal: LooseningProposal }
  | { kind: 'calibration'; key: string; proposal: CalibrationProposal };

// Once a user acts, the resolution is the source of truth for that row — it
// survives a background parent refetch (only our own load() resets it).
type Resolution =
  | { type: 'gone' } // warn "fine": cleared review state, no rule, row removed
  | { type: 'strip'; node: ReactNode; undo?: () => Promise<void> };

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
    case 'calibration': {
      const p = item.proposal;
      const evidence: ReactNode[] = [];
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
      return `Creates a require-approval rule for ${item.group.shape.action_type}`;
    case 'tuning':
      return `Applies now to "${item.proposal.policy_name}"`;
    case 'tighten':
      return `Creates a require-approval rule for ${item.proposal.action_type}`;
    case 'loosen':
      return `Relaxes "${item.proposal.policy_name}" now`;
    case 'calibration':
      return 'Queues a golden vector for the maintainer to forge';
  }
}

// Primary verb (default) and its armed confirm label.
const PRIMARY: Record<InboxItem['kind'], { verb: string; confirm: string }> = {
  warn: { verb: 'Always allow', confirm: 'Create rule' }, // warn primary handled by split button
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
  onPrimary,
  onDismiss,
  onUndo,
}: RowProps) {
  const [armed, setArmed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const d = describe(item);
  const primary = PRIMARY[item.kind];
  const leadLabel = typeof d.lead === 'string' ? d.lead : d.label;

  // ----- resolved: show the landed/dismissed strip + Undo -----
  let acts: ReactNode;
  let expansion: ReactNode = null;

  if (resolution?.type === 'strip') {
    acts = (
      <>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{resolution.node}</span>
        {resolution.undo && (
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
        )}
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
  } else if (item.kind === 'warn') {
    // Three verbs kept compact via a split button: Always allow (primary),
    // with a caret menu for Mark fine / Tighten.
    acts = (
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
          onClick={() => onWarnPrimary(item, 'always_allow')}
          aria-label={`Always allow ${leadLabel}`}
          className={`${styles.btn} ${styles.btnSm} ${styles.btnSuccess}`}
        >
          <Check size={13} aria-hidden="true" />
          Always allow
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
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setArmed(true);
              }}
            >
              <ShieldPlus size={13} aria-hidden="true" />
              Tighten&hellip;
            </button>
          </div>
        )}
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
          {error && <div className={styles.rowError}>{error}</div>}
        </div>
        <div className={styles.inboxActs}>{acts}</div>
      </div>
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
  onCountRef.current = onCount;
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
      postVerdict(verdict, warnShape(item.group))
        .then((res) => {
          const pid = res.policy?.id ?? null;
          const node = verdict === 'always_allow' ? `Allowed — ${label}` : `Approval rule created — ${label}`;
          resolve(key, { type: 'strip', node, undo: pid ? () => deletePolicy(pid) : undefined });
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
        default:
          setBusyKey(key, false);
          return;
      }
      call
        .then(() => {
          resolve(key, { type: 'strip', node: 'Dismissed', undo });
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

  return (
    <section aria-labelledby="triage-heading">
      {/* Section header */}
      <div className={styles.secHead}>
        <div className={styles.lhs}>
          <h2 id="triage-heading">Needs your call</h2>
          <span className={`${styles.countPill}${pending > 0 ? ` ${styles.hot}` : ''}`}>{pending}</span>
          <span className={styles.secHelp}>
            Observed patterns become one decision, one click. Review verdicts and tuning proposals, unified.
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
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting"
          description="No pending verdicts or tuning proposals. Your agents are running inside policy."
        />
      ) : (
        <>
          <div className={styles.inbox}>
            {visibleItems.map((item) => (
              <InboxRow
                key={item.key}
                item={item}
                resolution={resolutions[item.key]}
                busy={busy[item.key] ?? false}
                error={errors[item.key] ?? null}
                onFine={handleFine}
                onWarnPrimary={handleWarnPrimary}
                onPrimary={handlePrimary}
                onDismiss={handleDismiss}
                onUndo={handleUndo}
              />
            ))}
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
