'use client';

import Link from 'next/link';
import { Clock, ArrowRight } from 'lucide-react';
import type { PolicySummary } from '../lib/modesClient';
import styles from '../policies.module.css';

/**
 * Section 1+2 of the workbench: the at-a-glance posture row (four stat cards)
 * plus the weekly-friction sentence. Every number is real — nothing is
 * fabricated. The enforcement split bar and the decisions mini-bars are scaled
 * from the actual counts; there is no invented per-day history.
 */

interface PostureHeroProps {
  summary: PolicySummary;
  friction: { interrupts_7d: number; est_seconds: number } | null;
  inboxCount: number;
}

function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.max(0, (n / total) * 100)}%`;
}

function barHeight(n: number, max: number): string {
  if (!max) return '3px';
  return `${Math.max(6, Math.round((n / max) * 100))}%`;
}

export default function PostureHero({ summary, friction, inboxCount }: PostureHeroProps) {
  const enf = summary.enforcement;
  const d = summary.decisions30d;
  const maxOutcome = Math.max(d.allow, d.warn, d.require_approval, d.block, 1);
  const mins = friction ? Math.max(0, Math.round(friction.est_seconds / 60)) : 0;

  return (
    <>
      <div className={styles.posture}>
        {/* Enforcement — active rules */}
        <div className={`${styles.card} ${styles.cardHover} ${styles.stat}`}>
          <span className={styles.metaLabel}>Enforcement &middot; active rules</span>
          <div className={styles.enfRow}>
            <span className={`${styles.enfTotal} ${styles.tnum}`}>{enf.total.toLocaleString()}</span>
            <span className={styles.statSub} style={{ margin: 0 }}>
              across warn, approve &amp; block &middot; {summary.agents.total} agent{summary.agents.total === 1 ? '' : 's'}
            </span>
          </div>
          <div className={styles.splitBar} aria-hidden="true">
            <span className={styles.segWarn} style={{ width: pct(enf.warn, enf.total) }} />
            <span className={styles.segAppr} style={{ width: pct(enf.require_approval, enf.total) }} />
            <span className={styles.segBlock} style={{ width: pct(enf.block, enf.total) }} />
          </div>
          <div className={styles.splitLegend}>
            <span className={styles.lg}><span className={`${styles.dot} ${styles.segWarn}`} />Warn <b className={`${styles.tnum} ${styles.lgNum}`}>{enf.warn}</b></span>
            <span className={styles.lg}><span className={`${styles.dot} ${styles.segAppr}`} />Approve <b className={`${styles.tnum} ${styles.lgNum}`}>{enf.require_approval}</b></span>
            <span className={styles.lg}><span className={`${styles.dot} ${styles.segBlock}`} />Block <b className={`${styles.tnum} ${styles.lgNum}`}>{enf.block}</b></span>
          </div>
        </div>

        {/* Decisions · last 30d */}
        <div className={`${styles.card} ${styles.cardHover} ${styles.stat}`}>
          <span className={styles.metaLabel}>Decisions &middot; last 30d</span>
          <div className={`${styles.statBig} ${styles.tnum}`}>{d.total.toLocaleString()}</div>
          <div className={styles.miniOutcomes} aria-hidden="true">
            <div className="b" style={{ height: barHeight(d.allow, maxOutcome), background: 'var(--color-success)' }} title="allowed" />
            <div className="b" style={{ height: barHeight(d.warn, maxOutcome), background: 'var(--color-warning)' }} title="warned" />
            <div className="b" style={{ height: barHeight(d.require_approval, maxOutcome), background: 'var(--color-brand)' }} title="approval required" />
            <div className="b" style={{ height: barHeight(d.block, maxOutcome), background: 'var(--color-error)' }} title="blocked" />
          </div>
          <div className={styles.statSub}>
            {d.allow.toLocaleString()} allowed &middot; {d.warn.toLocaleString()} warned &middot; {d.require_approval.toLocaleString()} approved &middot; {d.block.toLocaleString()} blocked
          </div>
        </div>

        {/* Governed agents */}
        <div className={`${styles.card} ${styles.cardHover} ${styles.stat}`}>
          <span className={styles.metaLabel}>Governed agents</span>
          <div className={`${styles.statBig} ${styles.tnum}`}>{summary.agents.total.toLocaleString()}</div>
          <div className={styles.statSub}>
            {summary.scope.allAgents ? 'this policy set applies to all agents' : 'some rules are scoped to specific agents'}
          </div>
        </div>

        {/* Pending approvals — the one attention card */}
        <div className={`${styles.card} ${styles.stat} ${styles.statAttn}`}>
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

      {/* Friction line */}
      <div className={styles.friction}>
        <Clock size={15} className={styles.fico} aria-hidden="true" />
        {friction && friction.interrupts_7d > 0 ? (
          <span>
            This policy set interrupted your agents <b>{friction.interrupts_7d}</b> time{friction.interrupts_7d === 1 ? '' : 's'} in the last 7 days
            {mins > 0 ? <>, roughly <b>{mins} min</b> of human attention</> : null}.
            {inboxCount > 0 ? <> The inbox below has <b>{inboxCount}</b> suggestion{inboxCount === 1 ? '' : 's'} that would cut that.</> : null}
          </span>
        ) : (
          <span>No interruptions in the last 7 days. Your policy set is governing quietly.</span>
        )}
      </div>
    </>
  );
}
