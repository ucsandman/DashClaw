'use client';

import React from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import type { WidgetAction } from '../../lib/widget/summary.js';

/**
 * Pending-approval cards with inline Approve/Deny. Operator action (the human
 * resolving an agent's request) — not an agent capability, so it respects the
 * governance boundary. Buttons are admin-gated; resolving here clears the
 * approval in every channel via the same /api/approvals path.
 */
export function WidgetApprovals({
  approvals,
  canDecide,
  processingId,
  onDecide,
}: {
  approvals: WidgetAction[];
  canDecide: boolean;
  processingId: string | null;
  onDecide: (actionId: string, decision: 'allow' | 'deny') => void;
}) {
  if (!approvals || approvals.length === 0) return null;

  return (
    <section aria-label="Pending approvals" className="border-b border-brand/25 bg-brand/[0.04]">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
        Waiting for approval
        <span className="tabular-nums text-tertiary">{approvals.length}</span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {approvals.map((a) => {
          const id = a.actionId ?? '';
          const busy = processingId === id;
          const risk = a.riskScore ?? 0;
          return (
            <li key={id} className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs text-primary">{a.summary || a.actionType || 'action'}</div>
                <div className="truncate text-[10px] text-tertiary">
                  {a.agentName || 'agent'} · {a.actionType || 'action'}
                  {risk >= 70 ? <span className="text-warning"> · risk {risk}</span> : null}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={!canDecide || busy || !id}
                  onClick={() => onDecide(id, 'allow')}
                  aria-label={`Approve: ${a.summary || a.actionType || 'action'}`}
                  className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-md border border-success/30 bg-success-subtle px-2 text-xs font-semibold text-success transition-colors hover:border-success/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={!canDecide || busy || !id}
                  onClick={() => onDecide(id, 'deny')}
                  aria-label={`Deny: ${a.summary || a.actionType || 'action'}`}
                  className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-md border border-error/30 bg-error-subtle px-2 text-xs font-semibold text-error transition-colors hover:border-error/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                  Deny
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!canDecide ? (
        <div className="px-3 pb-2 text-[10px] text-tertiary">Sign in as an admin to approve or deny.</div>
      ) : null}
    </section>
  );
}
