'use client';

import { GitMerge } from 'lucide-react';
import ContainmentCard from './ContainmentCard';

interface ContainmentAction {
  action_id: string;
  agent_id: string;
  agent_name?: string | null;
  action_type: string;
  declared_goal: string;
  containment_ref: string | null;
  timestamp_start: string;
  // Batched evidence state from the enriched actions list (see ContainmentCard).
  containment_has_evidence?: boolean;
  containment_evidence_ref?: string | null;
}

// Diff artifacts are cumulative session-branch state, keyed by
// containment_ref, not per-action — every action sharing a ref must
// disclose that to the operator (Task 10 review requirement) before they
// promote/discard based on a diff that isn't exclusively theirs.
function siblingInfoByAction(actions: ContainmentAction[]) {
  const byRef = new Map<string, ContainmentAction[]>();
  for (const a of actions) {
    if (!a.containment_ref) continue;
    const list = byRef.get(a.containment_ref) ?? [];
    list.push(a);
    byRef.set(a.containment_ref, list);
  }
  const info = new Map<string, { count: number; hasLater: boolean }>();
  for (const action of actions) {
    if (!action.containment_ref) {
      info.set(action.action_id, { count: 0, hasLater: false });
      continue;
    }
    const siblings = (byRef.get(action.containment_ref) ?? []).filter((a) => a.action_id !== action.action_id);
    const ownTime = new Date(action.timestamp_start).getTime();
    const hasLater = siblings.some((s) => new Date(s.timestamp_start).getTime() > ownTime);
    info.set(action.action_id, { count: siblings.length, hasLater });
  }
  return info;
}

export default function ContainmentSection({ actions, canDecide, onResolvedAction }: {
  actions: ContainmentAction[]; canDecide: boolean; onResolvedAction: () => void;
}) {
  if (actions.length === 0) return null;

  const siblingInfo = siblingInfoByAction(actions);

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        <GitMerge size={12} /> Contained changes awaiting promotion
        <span className="tabular-nums">· {actions.length}</span>
      </div>
      <div className="space-y-4">
        {actions.map((action) => {
          const info = siblingInfo.get(action.action_id) ?? { count: 0, hasLater: false };
          return (
            <ContainmentCard
              key={action.action_id}
              action={action}
              siblingCount={info.count}
              hasLaterSibling={info.hasLater}
              canDecide={canDecide}
              onResolvedAction={onResolvedAction}
            />
          );
        })}
      </div>
    </div>
  );
}
