'use client';

import Link from 'next/link';
import { ShieldCheck, X, Radio } from 'lucide-react';
import { LedgerRow } from './LedgerRow';
import { matchesAgent } from '../lib/missionHelpers';

const STREAM_CAP = 40;

const CATEGORY_LABEL: Record<string, string> = {
  approval: 'Approvals',
  failure: 'Failures',
  signal: 'Signals',
  health: 'Health',
  stale: 'Stale',
};

interface LiveStreamProps {
  feedItems: any[];
  agentId: any;
  activeCategory: string | null;
  onClearFilter: () => void;
  livePulse: boolean;
  loading: boolean;
  handlers: {
    onApprove: (id: string) => void;
    onDeny: (id: string) => void;
    onRetry: (m: any) => void;
    onCancel: (m: any) => void;
    onDisable: (m: any) => void;
  };
}

/**
 * The calm, SSE-live event log — the ops-feed replacement. Approvals are pinned in
 * the Intervention Queue above, so they're excluded here. Capped at 40 DOM rows
 * with a deep-link footer; new rows enter via the fadeSlideIn keyframe.
 */
export function LiveStream({ feedItems, agentId, activeCategory, onClearFilter, livePulse, loading, handlers }: LiveStreamProps) {
  const visible = feedItems
    .filter((i) => i.category !== 'approval')
    .filter((i) => matchesAgent(i, agentId))
    .filter((i) => !activeCategory || i.category === activeCategory);
  const shown = visible.slice(0, STREAM_CAP);

  return (
    <div className="rounded-xl border border-border bg-surface-secondary">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio size={13} className={livePulse ? 'text-success animate-pulse' : 'text-tertiary'} aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Live · governed events</span>
          <span className="text-[11px] text-tertiary" role="status">{livePulse ? 'Live' : 'Idle'}</span>
        </div>
        {activeCategory && (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-subtle px-2 py-0.5 text-[11px] font-medium text-brand transition-colors hover:border-brand/50"
          >
            {CATEGORY_LABEL[activeCategory] || activeCategory}
            <X size={11} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="max-h-[560px] overflow-y-auto">
        {loading && shown.length === 0 ? (
          <div className="p-6 text-center text-sm text-tertiary">Loading governed events…</div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-success/40" aria-hidden="true" />
            <p className="text-sm text-secondary">
              {activeCategory ? `No ${CATEGORY_LABEL[activeCategory] || activeCategory} right now.` : 'All clear — nothing needs attention.'}
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {shown.map((item) => (
              <LedgerRow
                key={item.id}
                item={item}
                onRetry={item.suggested_action === 'retry' ? handlers.onRetry : undefined}
                onCancel={item.suggested_action === 'cancel' ? handlers.onCancel : undefined}
                onDisable={item.suggested_action === 'disable' ? handlers.onDisable : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {visible.length > STREAM_CAP && (
        <div className="border-t border-border px-4 py-2 text-center">
          <Link href="/decisions" className="text-xs text-brand transition-colors hover:text-brand-hover">
            View all in Decisions →
          </Link>
        </div>
      )}
    </div>
  );
}
