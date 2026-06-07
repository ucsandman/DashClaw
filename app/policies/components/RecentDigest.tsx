'use client';

import Link from 'next/link';

export interface RecentDecision {
  id: string;
  decision: string;
  agentLabel: string;
  actionType: string;
  createdAt: string;
}

interface RecentDigestProps {
  decisions: RecentDecision[];
}

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';
const AFFORDANCE = 'text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none';

/** Decision label → token class. Case-insensitive; unknown falls to tertiary. */
function decisionTone(decision: string): string {
  switch (decision.toLowerCase()) {
    case 'block':
      return 'text-error';
    case 'require_approval':
    case 'approval':
    case 'warn':
      return 'text-warning';
    case 'allow':
      return 'text-tertiary';
    default:
      return 'text-tertiary';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * A compact tail of the most recent governed decisions (up to 5), each a
 * single row: time, decision outcome, agent, action type. Links out to the
 * full ledger on /decisions. No nested cards.
 */
export default function RecentDigest({ decisions }: RecentDigestProps) {
  const rows = decisions.slice(0, 5);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={SECTION_LABEL}>Recent</span>
        <Link href="/decisions" className={AFFORDANCE}>
          All decisions on /decisions &rsaquo;
        </Link>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((d) => (
            <li key={d.id} className="flex items-baseline gap-3 py-1.5 text-sm">
              <span className="shrink-0 tabular-nums text-tertiary">{formatTime(d.createdAt)}</span>
              <span className={`shrink-0 font-mono text-xs uppercase ${decisionTone(d.decision)}`}>
                {d.decision.toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-secondary">{d.agentLabel}</span>
              <span className="min-w-0 truncate text-tertiary">{d.actionType}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-tertiary">No decisions yet.</p>
      )}
    </div>
  );
}
