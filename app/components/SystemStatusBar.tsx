'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { SEVERITY_ROUTE } from '../lib/security-filter';

// POSTURE LOGIC: Standardized across the platform.
// Per .impeccable.md "calm under pressure": the bar does not pulse. A live
// status bar that breathes in the peripheral vision every second crosses from
// "quiet confidence" into "vigilant alertness". Attention-grabbing motion is
// reserved for incoming decisions and approval arrivals elsewhere in the UI.
export function computePosture(redCount: number, amberCount: number) {
  if (redCount >= 1) return { label: 'Critical', color: 'text-error', bg: 'bg-error-subtle', border: 'border-error/30', dot: 'bg-status-error' };
  if (amberCount >= 1) return { label: 'Elevated', color: 'text-warning', bg: 'bg-warning-subtle', border: 'border-warning/30', dot: 'bg-status-warning' };
  return { label: 'Nominal', color: 'text-success', bg: 'bg-success-subtle', border: 'border-success/30', dot: 'bg-status-success' };
}

export default function SystemStatusBar() {
  const { agentId } = useAgentFilter();
  const [signals, setSignals] = useState<any[] | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(`/api/signals${agentId ? `?agent_id=${agentId}` : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setSignals(data.signals || []);
    } catch {
      // Silently fail — bar just won't render
    }
  }, [agentId]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  // One-time migration: dismissals used to live ONLY in this browser's
  // localStorage, which made the bar disagree with every server-computed
  // surface (widget pulse, other browsers). Push any legacy local set to the
  // server (idempotent), then drop the local copy. On failure the local key
  // stays and the next page load retries.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dashclaw_dismissed_signals');
      const keys = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(keys) || keys.length === 0) return;
      fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss_keys: keys.slice(0, 1000) }),
      }).then((res) => {
        if (res.ok) {
          localStorage.removeItem('dashclaw_dismissed_signals');
          fetchSignals();
        }
      }).catch((err) => {
        console.warn('Failed to migrate dismissed signals to server:', err);
      });
    } catch { /* corrupt local state — leave it alone */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime(useCallback((event: any) => {
    if (event === 'signal.detected') {
      fetchSignals();
    }
  }, [fetchSignals]));

  // Dismissals are subtracted server-side in computeSignals since the
  // signal_dismissals table landed — what arrives here is already the
  // active set every other surface sees.
  const activeSignals = signals || [];

  if (!signals) return null;

  const redCount = activeSignals.filter(s => s.severity === 'red').length;
  const amberCount = activeSignals.filter(s => s.severity === 'amber').length;
  const totalCount = activeSignals.length;

  const state = computePosture(redCount, amberCount);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-surface-primary px-6 py-1.5">
      <div className="flex items-center gap-4">
        {/* System Posture Badge */}
        <div
          role="status"
          aria-label={`System posture ${state.label}`}
          className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${state.bg} ${state.border}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
          <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${state.color}`}>{state.label}</span>
        </div>

        {/* Signal Counts */}
        <div className="flex items-center gap-3">
          {redCount > 0 && (
            <Link
              href={SEVERITY_ROUTE.red}
              title="View critical signals"
              className="flex items-center gap-1.5 rounded-sm text-[11px] font-medium tabular-nums text-error underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-error" />
              {redCount} Critical
            </Link>
          )}
          {amberCount > 0 && (
            <Link
              href={SEVERITY_ROUTE.amber}
              title="View elevated signals"
              className="flex items-center gap-1.5 rounded-sm text-[11px] font-medium tabular-nums text-warning underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-warning" />
              {amberCount} Elevated
            </Link>
          )}
          {redCount === 0 && amberCount === 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
              <ShieldCheck size={11} aria-hidden="true" />
              All clear
            </span>
          )}
        </div>
      </div>

      {/* Total count — links to the per-signal breakdown (type, severity, agent,
          related action) on the decisions ledger. Stays tertiary/calm per .impeccable.md;
          brand orange appears only as the focus ring (a "needs you" signal). */}
      <Link
        href="/decisions"
        title="View the governance signals breakdown: type, severity, agent, and related action"
        className="rounded-sm text-[11px] font-semibold uppercase tracking-[0.14em] tabular-nums text-tertiary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {totalCount} active governance signal{totalCount !== 1 ? 's' : ''}
      </Link>
    </div>
  );
}
