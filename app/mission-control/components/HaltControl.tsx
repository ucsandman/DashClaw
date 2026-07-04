'use client';

import { useCallback, useEffect, useState } from 'react';
import { OctagonPause, Play } from 'lucide-react';
import { formatRelativeTime } from '../lib/missionHelpers';

interface HaltState {
  halted: boolean;
  actor: string | null;
  reason: string | null;
  at: string | null;
}

/**
 * Org kill switch — the operable surface for /api/halt (admin only; the
 * control hides itself on 403). Two-step confirm in both directions: halting
 * blocks EVERY guard evaluation for the org, resuming restores autonomy.
 * Renders as a compact control inside the CommandStrip when running, and as
 * a full-width banner (basis-full wraps to its own row) while halted.
 */
export default function HaltControl() {
  const [halt, setHalt] = useState<HaltState | null>(null);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState<'halt' | 'resume' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/halt');
        if (!res.ok) return; // non-admin (403) or unavailable — no control
        const body = await res.json();
        if (cancelled) return;
        setHalt(body.halt ?? null);
        setVisible(true);
      } catch {
        /* control stays hidden; guard-side enforcement is unaffected */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = useCallback(
    async (halted: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const trimmed = reason.trim();
        const res = await fetch('/api/halt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(halted ? (trimmed ? { halted: true, reason: trimmed } : { halted: true }) : { halted: false }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as { error?: string }));
          setError(body.error || `Request failed (${res.status})`);
          return;
        }
        const body = await res.json();
        setHalt(body.halt ?? { halted, actor: null, reason: null, at: null });
        setConfirming(null);
        setReason('');
      } catch {
        setError('Request failed');
      } finally {
        setBusy(false);
      }
    },
    [reason],
  );

  if (!visible || halt === null) return null;

  if (halt.halted) {
    return (
      <div
        role="status"
        aria-label="Organization halted"
        className="flex w-full basis-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-status-error bg-status-error-subtle px-3 py-2"
      >
        <OctagonPause size={16} className="text-error" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-error">Halted</span>
        <span className="text-sm text-secondary">
          Every guard evaluation returns block. Set by{' '}
          <span className="font-medium text-primary">{halt.actor || 'admin'}</span>
          {halt.at ? <span className="tabular-nums"> · {formatRelativeTime(halt.at)}</span> : null}
          {halt.reason ? <span> — {halt.reason}</span> : null}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-sm text-error">{error}</span>}
          {confirming === 'resume' ? (
            <>
              <button
                onClick={() => submit(false)}
                disabled={busy}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-status-success px-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Play size={14} aria-hidden="true" /> Confirm resume
              </button>
              <button
                onClick={() => { setConfirming(null); setError(null); }}
                disabled={busy}
                className="h-7 rounded-md border border-border px-2.5 text-sm text-secondary hover:border-border-hover disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming('resume')}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-secondary hover:border-border-hover hover:text-primary"
            >
              <Play size={14} aria-hidden="true" /> Resume
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:ml-auto">
      {error && <span className="text-sm text-error">{error}</span>}
      {confirming === 'halt' ? (
        <>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            aria-label="Halt reason"
            className="h-7 w-44 rounded-md border border-border bg-transparent px-2 text-sm text-primary placeholder:text-disabled focus:border-status-error focus:outline-none"
          />
          <button
            onClick={() => submit(true)}
            disabled={busy}
            className="h-7 rounded-md bg-status-error px-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Confirm halt
          </button>
          <button
            onClick={() => { setConfirming(null); setReason(''); setError(null); }}
            disabled={busy}
            className="h-7 rounded-md border border-border px-2.5 text-sm text-secondary hover:border-border-hover disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirming('halt')}
          title="Immediately block every guard evaluation for this org"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-secondary hover:border-status-error hover:text-error"
        >
          <OctagonPause size={14} aria-hidden="true" /> Halt org
        </button>
      )}
    </div>
  );
}
