'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { ArrowUpRight, AlertTriangle, AlertCircle } from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import { PosturePill, type PosturePillStatus } from './components/PosturePill';
import { WidgetMetrics } from './components/WidgetMetrics';
import { WidgetLog } from './components/WidgetLog';
import { WidgetFooter } from './components/WidgetFooter';
import { InstallButton } from './components/InstallButton';
import { useWidgetSummary } from './useWidgetSummary';

const EMPTY_METRICS = { activeAgents: 0, pendingApprovals: 0, elevated: 0, spend: null };

export default function WidgetPage() {
  const { data, loading, error, connection, lastUpdated } = useWidgetSummary();

  // Register the shared service worker so /widget is installable as a PWA
  // (standalone desktop app). Best-effort — the widget works without it.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal.
    });
  }, []);

  // Connection state (offline) overrides the server's operational posture.
  const status: PosturePillStatus = connection === 'offline' ? 'offline' : data?.status ?? 'calm';
  const metrics = data?.metrics ?? EMPTY_METRICS;
  const topSignal = data?.topSignals?.[0] ?? null;
  const totalSignals = data?.signals?.total ?? 0;
  const firstLoad = loading && !data;

  return (
    <main className="mx-auto flex h-screen w-full max-w-[340px] flex-col overflow-hidden bg-surface-primary text-primary">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <DashClawLogo size={16} />
          <span className="truncate text-xs font-semibold text-white">DashClaw</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <InstallButton />
          <PosturePill status={status} />
          <Link
            href="/mission-control"
            aria-label="Open Mission Control dashboard"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-tertiary transition-colors hover:border-border-hover hover:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <WidgetMetrics metrics={metrics} />

      {topSignal ? (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[11px]">
          {topSignal.severity === 'red' ? (
            <AlertTriangle size={12} className="shrink-0 text-error" aria-hidden="true" />
          ) : (
            <AlertCircle size={12} className="shrink-0 text-warning" aria-hidden="true" />
          )}
          <span className={`truncate ${topSignal.severity === 'red' ? 'text-error' : 'text-warning'}`}>
            {topSignal.label}
          </span>
          {totalSignals > 1 ? (
            <span className="ml-auto shrink-0 tabular-nums text-tertiary">+{totalSignals - 1}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Recent</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WidgetLog
            actions={data?.recentActions ?? []}
            loading={firstLoad}
            error={!data && error ? error : null}
          />
        </div>
      </div>

      <WidgetFooter connection={connection} lastUpdated={lastUpdated} />
    </main>
  );
}
