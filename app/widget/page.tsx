'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, AlertTriangle, AlertCircle } from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import { PosturePill } from './components/PosturePill';
import { WidgetMetrics } from './components/WidgetMetrics';
import { WidgetLog } from './components/WidgetLog';
import { WidgetFooter } from './components/WidgetFooter';
import type { WidgetSummary } from '../lib/widget/summary.js';

// Phase 2: static fixture so the surface renders and every component state is
// exercisable. Phase 3 replaces this with the live useWidgetSummary hook
// (poll + realtime) and a real connection state.
const FIXTURE: WidgetSummary = {
  status: 'approval',
  generatedAt: '2026-06-06T12:00:00.000Z',
  metrics: { activeAgents: 3, pendingApprovals: 1, elevated: 1, spend: 4.25 },
  signals: { red: 0, amber: 1, total: 1 },
  recentActions: [
    {
      actionId: 'a1',
      agentName: 'support-bot',
      actionType: 'email_send',
      summary: 'Awaiting approval to email the customer refund confirmation',
      status: 'pending_approval',
      riskScore: 55,
      outcomeStatus: null,
      ts: '2026-06-06T11:58:00.000Z',
    },
    {
      actionId: 'a2',
      agentName: 'data-agent',
      actionType: 'db_query',
      summary: 'Read 1,204 rows from analytics.events',
      status: 'completed',
      riskScore: 8,
      outcomeStatus: 'completed',
      ts: '2026-06-06T11:55:00.000Z',
    },
    {
      actionId: 'a3',
      agentName: 'deploy-agent',
      actionType: 'shell_exec',
      summary: 'Blocked: attempted write outside the authorized scope',
      status: 'blocked',
      riskScore: 82,
      outcomeStatus: null,
      ts: '2026-06-06T11:50:00.000Z',
    },
    {
      actionId: 'a4',
      agentName: 'research-agent',
      actionType: 'http_fetch',
      summary: 'Fetching pricing pages for competitor analysis',
      status: 'running',
      riskScore: 12,
      outcomeStatus: null,
      ts: '2026-06-06T11:49:00.000Z',
    },
  ],
  topSignals: [
    {
      severity: 'amber',
      label: 'Approval pending longer than 5m',
      detail: 'support-bot email_send awaiting a human decision',
      agentId: 'support-bot',
      ts: '2026-06-06T11:58:00.000Z',
    },
  ],
};

export default function WidgetPage() {
  const data = FIXTURE;
  const topSignal = data.topSignals[0];

  return (
    <main className="mx-auto flex h-screen w-full max-w-[340px] flex-col overflow-hidden bg-surface-primary text-primary">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <DashClawLogo size={16} />
          <span className="truncate text-xs font-semibold text-white">DashClaw</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <PosturePill status={data.status} />
          <Link
            href="/mission-control"
            aria-label="Open Mission Control dashboard"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-tertiary transition-colors hover:border-border-hover hover:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <WidgetMetrics metrics={data.metrics} />

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
          {data.signals.total > 1 ? (
            <span className="ml-auto shrink-0 tabular-nums text-tertiary">+{data.signals.total - 1}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Recent</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WidgetLog actions={data.recentActions} />
        </div>
      </div>

      <WidgetFooter connection="live" lastUpdated={Date.parse(data.generatedAt)} />
    </main>
  );
}
