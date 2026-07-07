import Link from 'next/link';
import { ArrowRight, ShieldCheck, KeyRound, ScrollText } from 'lucide-react';
import ExportWorkspaceButton from './ExportWorkspaceButton';

interface TrialWorkspaceCardProps {
  orgId: string;
  trialEndsAt: string | null;
  trialActionCap: number | null;
  trialActionsUsed: number | null;
}

/*
 * v5.1 "a way back in": rendered on /connect when the visitor's browser
 * carries a live trial session. This is the returning trial user's home
 * card — their workspace is real, reachable, and one click away.
 */
export default function TrialWorkspaceCard({
  orgId,
  trialEndsAt,
  trialActionCap,
  trialActionsUsed,
}: TrialWorkspaceCardProps) {
  return (
    <section className="mb-10 rounded-3xl border border-brand/30 bg-surface-secondary p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
          Your trial workspace
        </p>
        <span className="rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">
          Signed in
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-text-primary">{orgId}</p>
          <p className="mt-1 text-xs text-text-tertiary tabular-nums">
            {trialEndsAt ? (
              <>
                Trial ends{' '}
                {/* Deterministic UTC date (YYYY-MM-DD): this is a server
                    component, so toLocaleDateString() would format in the
                    server's timezone (UTC on Vercel), not the viewer's, and
                    read off-by-one for anyone west of UTC. */}
                <time dateTime={trialEndsAt}>
                  {new Date(trialEndsAt).toISOString().slice(0, 10)}
                </time>{' '}
                (UTC)
              </>
            ) : (
              'Trial active'
            )}
            {trialActionCap != null ? (
              <>
                {' '}
                · {(trialActionsUsed ?? 0).toLocaleString()} of{' '}
                {trialActionCap.toLocaleString()} governed actions used
              </>
            ) : null}
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-sm text-text-secondary leading-relaxed">
        Your browser holds the session for this workspace until the trial
        ends. Lost your API key? Mint a new one from API keys — the value is
        shown once at creation. The record is yours: export it any time and
        import it into a self-hosted instance with{' '}
        <code className="font-mono text-xs">dashclaw import</code> — the trial
        cap is a door, not a wall.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/approvals"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover"
        >
          <ShieldCheck size={14} aria-hidden="true" />
          Open Approvals <ArrowRight size={14} aria-hidden="true" />
        </Link>
        <Link
          href="/decisions"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
        >
          <ScrollText size={14} aria-hidden="true" />
          Decisions ledger
        </Link>
        <Link
          href="/api-keys"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
        >
          <KeyRound size={14} aria-hidden="true" />
          Manage API keys
        </Link>
        <ExportWorkspaceButton />
      </div>
    </section>
  );
}
