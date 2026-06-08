'use client';

import { InterventionQueue } from './InterventionQueue';
import { LiveStream } from './LiveStream';
import type { InterventionItem } from '../lib/missionHelpers';

interface LiveLedgerProps {
  interventions: InterventionItem[];
  feedItems: any[];
  agentId: any;
  activeCategory: string | null;
  onClearFilter: () => void;
  livePulse: boolean;
  loading: boolean;
  onDecision: (actionId: string, decision: 'allow' | 'deny') => void | Promise<void>;
  refresh: () => void;
  handlers: {
    onApprove: (id: string) => void;
    onDeny: (id: string) => void;
    onRetry: (m: any) => void;
    onCancel: (m: any) => void;
    onDisable: (m: any) => void;
  };
}

/** The right column: the only moving region. Subsumes the old Operations Feed band. */
export function LiveLedger({
  interventions,
  feedItems,
  agentId,
  activeCategory,
  onClearFilter,
  livePulse,
  loading,
  onDecision,
  refresh,
  handlers,
}: LiveLedgerProps) {
  return (
    <div className="space-y-4 lg:col-span-7">
      <InterventionQueue items={interventions} onDecision={onDecision} refresh={refresh} />
      <LiveStream
        feedItems={feedItems}
        agentId={agentId}
        activeCategory={activeCategory}
        onClearFilter={onClearFilter}
        livePulse={livePulse}
        loading={loading}
        handlers={handlers}
      />
    </div>
  );
}
