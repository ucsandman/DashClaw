'use client';

import Link from 'next/link';
import { ArrowRight, ShieldOff } from 'lucide-react';
import type { PolicySummary } from '../lib/modesClient';
import ApprovalPausePanel from './ApprovalPausePanel';
import styles from '../policies.module.css';

/**
 * The /policies fold (spec 4.1-4.2): a conditional alert row, then two stat
 * cards — the interruption count that made the maintainer disable every policy
 * in June 2026, and the pending-approval count. Every number is real.
 *
 * Cut deliberately: "Enforcement · active rules" (the Short List counter says
 * it now), "Decisions · last 30d" and "Governed agents" (both belong on
 * /decisions), and the friction prose (the card is the sentence).
 */

interface PostureCardsProps {
  summary: PolicySummary;
  friction: { interrupts_7d: number; est_seconds: number } | null;
  inboxCount: number;
  /** Opens the ledger on the grants that nullified the inert rules. */
  onReviewSuppressed: (grantIds: string[]) => void;
}

/** Attention spent, in the coarsest unit that still reads honestly. */
function estAttention(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function PostureCards({ summary, friction, onReviewSuppressed }: PostureCardsProps) {
  const interrupts = friction?.interrupts_7d ?? 0;
  const seconds = friction?.est_seconds ?? 0;

  const budget = summary.budgetReport;
  const overBudget = (budget?.policiesOverBudget ?? 0) + (budget?.shapesOverBudget ?? 0);

  // Spec 4.1: an inert rule that is a BLOCK or a Short List line is an alert
  // above the fold and never behind a disclosure — a silently neutered
  // catastrophe rule is the false confidence this product exists to prevent.
  // Every interrupting rule is on the Short List by derivation, so membership
  // is the whole test; the rest (warn-class) render struck through in the
  // ledger instead.
  const shortListIds = new Set((summary.shortList ?? []).map((line) => line.id));
  const alerting = (summary.inert ?? []).filter((p) => shortListIds.has(p.id));

  return (
    <>
      {alerting.length > 0 && (
        <div role="alert" className={`${styles.card} ${styles.inertBanner}`}>
          <div className={styles.inertHead}>
            <ShieldOff size={16} aria-hidden="true" />
            <span>
              {alerting.length} Short List {alerting.length === 1 ? 'rule is' : 'rules are'} currently inert — suppressed by an allow grant
            </span>
          </div>
          <ul className={styles.inertList}>
            {alerting.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>{' '}
                <span className={styles.inertTypes}>({p.action_types.join(', ')})</span>{' '}
                is downgraded to allow by{' '}
                {p.suppressed_by.map((g, i) => (
                  <span key={g.id}>
                    {i > 0 && ', '}
                    <b>{g.name}</b>
                    {g.target_prefix ? <span className={styles.inertTypes}> → {g.target_prefix}</span> : ' (unscoped)'}
                  </span>
                ))}
                .
              </li>
            ))}
          </ul>
          {/* Not an anchor: the grants live in the ledger's Sentences lens,
              which the Table default doesn't render, inside a section the
              human may have collapsed. Nothing to link to — the ledger has to
              be driven there. */}
          <button
            type="button"
            className={styles.inertLink}
            onClick={() => onReviewSuppressed([...new Set(alerting.flatMap((p) => p.suppressed_by.map((g) => g.id)))])}
          >
            Review suppressed patterns <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.posture}>
        {/* Interruptions — the number the whole redesign is about. */}
        <div data-testid="stat-card" className={`${styles.card} ${styles.cardHover} ${styles.stat}`}>
          <span className={styles.metaLabel}>Interruptions, last 7 days</span>
          <div className={`${styles.statBig} ${styles.tnum}`}>{interrupts.toLocaleString()}</div>
          <div className={styles.statSub}>
            {interrupts > 0 && seconds > 0
              ? `about ${estAttention(seconds)} of your time`
              : 'nothing has interrupted your agents'}
          </div>
          {overBudget > 0 && (
            <div className={styles.statSub}>
              {overBudget} {overBudget === 1 ? 'rule' : 'rules'} crossed {budget.budget} interruptions in{' '}
              {budget.window_hours} hours and are warning instead of asking. They are in the list below.
            </div>
          )}
        </div>

        {/* Pending approvals — the one attention card */}
        <div data-testid="stat-card" className={`${styles.card} ${styles.stat} ${styles.statAttn}`}>
          <span className={styles.metaLabel}>Pending approvals</span>
          <div className={`${styles.statBig} ${styles.tnum}`}>{summary.pendingApprovals.toLocaleString()}</div>
          <div className={styles.statSub}>
            {summary.pendingApprovals === 0 ? 'nothing waiting on you' : 'waiting on your one-click call'}
          </div>
          <Link href="/approvals" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} style={{ marginTop: 14 }}>
            Open Approvals inbox
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Directly under the cards: the interruption count is where the operator
          reads what this policy set has cost them in attention, so the relief
          valve belongs against it rather than buried in settings. */}
      <ApprovalPausePanel />
    </>
  );
}

// Task B5 re-wires PolicyWorkbench to the named export; until then the old
// default import keeps compiling.
export default PostureCards;
