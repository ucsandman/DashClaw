'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellOff } from 'lucide-react';

interface PauseState {
  active: boolean;
  until: string | null;
  actor: string | null;
  remaining_seconds: number;
}

/**
 * Approval-pause banner — the loud half of the pause feature.
 *
 * While a pause is live, the approvals inbox is NOT the whole picture: actions
 * that would have queued here proceeded on their own. An empty inbox during a
 * pause would otherwise read as "nothing needed you", which is the same
 * false-confidence failure the observe-mode banner next door exists to stop.
 *
 * Warning tone rather than the observe banner's error tone: this posture is
 * operator-chosen, bounded, and counted down on screen. Red is reserved for
 * the product misrepresenting itself.
 *
 * Renders nothing when no pause is active.
 */
export default function ApprovalPauseBanner({ onResumed }: { onResumed?: () => void }) {
  const [pause, setPause] = useState<PauseState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approval-pause', { cache: 'no-store' });
      if (!res.ok) return; // best-effort surface — stay hidden on failure
      const json = await res.json();
      setPause(json.pause ?? null);
    } catch { /* best-effort surface — stay hidden on fetch failure */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const resume = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/approval-pause', { method: 'DELETE' });
      if (res.ok) {
        setPause((await res.json()).pause ?? null);
        onResumed?.();
      }
    } catch { /* leave the banner up; the operator can retry */ } finally {
      setBusy(false);
    }
  }, [onResumed]);

  if (!pause?.active) return null;

  const mins = Math.max(1, Math.round(pause.remaining_seconds / 60));
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-warning bg-status-warning-subtle px-4 py-3">
      <BellOff size={16} className="shrink-0 text-status-warning" aria-hidden="true" />
      <span className="text-sm font-medium text-primary">
        Approvals paused — this inbox is not the whole picture
      </span>
      <span className="text-xs text-secondary">
        Actions that would wait here are proceeding without review for the next {label}
        {pause.actor ? <> (paused by {pause.actor})</> : null}. They are recorded on{' '}
        <Link href="/decisions" className="font-medium text-status-warning underline decoration-dotted underline-offset-2 hover:decoration-solid">
          the decisions ledger
        </Link>{' '}
        as proceeded-under-pause, never as approved. Blocks still block.
      </span>
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        className="ml-auto rounded-md border border-status-warning px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:bg-status-warning/10 disabled:opacity-60"
      >
        {busy ? 'Resuming…' : 'Resume now'}
      </button>
    </div>
  );
}
