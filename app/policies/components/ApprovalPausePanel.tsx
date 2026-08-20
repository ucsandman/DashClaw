'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellOff, Bell, Loader2 } from 'lucide-react';
import styles from '../policies.module.css';

/**
 * The approval pause control — "stop asking me for a while".
 *
 * Sits directly under the friction sentence, because that sentence is where
 * the operator reads how much attention this policy set has cost them; the
 * relief belongs next to the complaint. Self-fetching so the same component
 * can be dropped on /approvals without threading props through two pages.
 *
 * What it does NOT offer, on purpose: an indefinite pause, and a "turn off all
 * policies" button. MAINTAINER.md records that all org policies were turned
 * off for 18 days in June 2026 because of approval friction — an unbounded
 * switch is that outage with a nicer label. Every window here expires on its
 * own, and blocks keep blocking throughout.
 */

interface PauseState {
  active: boolean;
  until: string | null;
  actor: string | null;
  remaining_seconds: number;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'expiring now';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

export default function ApprovalPausePanel() {
  const [pause, setPause] = useState<PauseState | null>(null);
  const [windows, setWindows] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCancelled?: () => boolean) => {
    try {
      const res = await fetch('/api/approval-pause', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not read the approval pause (HTTP ${res.status})`);
      const data = await res.json();
      if (isCancelled?.()) return;
      setPause(data.pause ?? null);
      setWindows(data.window_hours ?? []);
      setError(null);
    } catch (err) {
      if (isCancelled?.()) return;
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // Same cancellation contract as ObserveModeBanner: never set state after
    // unmount, so a slow response cannot land on a torn-down tree.
    let cancelled = false;
    const isCancelled = () => cancelled;
    load(isCancelled);
    // Coarse on purpose (principle 3, calm under pressure): a pause measured
    // in hours does not need a per-second countdown, and a ticking clock on an
    // operational surface reads as an alarm board.
    const t = setInterval(() => load(isCancelled), 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  const mutate = useCallback(async (method: 'POST' | 'DELETE', hours?: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/approval-pause', {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ hours }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
      setPause(data.pause);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!pause) return null;

  if (pause.active) {
    return (
      <div role="alert" className={`${styles.card} ${styles.pauseBannerOn}`}>
        <div className={styles.pauseHeadOn}>
          <BellOff size={16} aria-hidden="true" />
          <span>
            Approvals paused &middot; {formatRemaining(pause.remaining_seconds)}
          </span>
        </div>
        <p className={styles.pauseBody}>
          Actions that would normally wait for you are proceeding without review, and the ledger
          records them as <b>proceeded under an operator pause</b> — not as approved. Blocks still
          block, and rules marked ungrantable still interrupt. Resumes on its own
          {pause.until ? <> at <b>{new Date(pause.until).toLocaleTimeString()}</b></> : null}.
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
          onClick={() => mutate('DELETE')}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className={styles.spin} /> : <Bell size={14} />}
          Resume approvals now
        </button>
        {error && <p className={styles.pauseError}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={`${styles.card} ${styles.pausePanel}`}>
      <div className={styles.pauseOffHead}>
        <BellOff size={14} aria-hidden="true" />
        <span>Too many approval prompts? Pause them for a while</span>
      </div>
      <div className={styles.pauseActions}>
        {windows.map((h) => (
          <button
            key={h}
            type="button"
            className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
            onClick={() => mutate('POST', h)}
            disabled={busy}
          >
            {h}h
          </button>
        ))}
        <span className={styles.pauseHint}>
          Blocks keep blocking. Your rules are not changed, so the pause just wears off.
        </span>
      </div>
      {/* Spec 4.2: the pause is the relief valve for approval friction, so this
          is where the operator has to learn its ceiling — the Short List is not
          in scope for it. */}
      <p className={styles.pauseHint}>A pause cannot lift a Short List hold.</p>
      {error && <p className={styles.pauseError}>{error}</p>}
    </div>
  );
}
