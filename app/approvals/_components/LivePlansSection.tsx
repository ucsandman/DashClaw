'use client';

import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

const STATUS_VARIANT: Record<string, string> = {
  approved: 'success', partially_approved: 'warning', denied: 'error',
};

interface PlanStep { grant_used_at: string | null; }
interface Plan {
  plan_id: string; agent_id: string; declared_goal: string; status: string; expires_at: string | null;
}

// Denied plans still have a live expires_at (the org TTL clamp — FIX 2): the
// row surfaces how long the denial keeps blocking matching guard calls.
function relativeUntil(iso: string | null): string {
  if (!iso) return 'unknown';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export default function LivePlansSection({ plans, canDecide, onResolved }: {
  plans: Array<{ plan: Plan; steps: PlanStep[] }>; canDecide: boolean; onResolved: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (plans.length === 0) return null;

  // Confirm-free per FIX 6: revoke is the universal kill switch and the row
  // clears from this list on success, so a mis-click is low-cost to spot.
  const revoke = async (planId: string) => {
    try {
      setBusyId(planId);
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: 'revoke' }),
      });
      if (res.ok) onResolved();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        <ListChecks size={12} /> Live plans
      </div>
      <div className="space-y-2">
        {plans.map(({ plan, steps }) => {
          const consumed = steps.filter((s) => s.grant_used_at).length;
          const isDenied = plan.status === 'denied';
          const busy = busyId === plan.plan_id;
          return (
            <Card
              key={plan.plan_id}
              data-entity-type="plan"
              data-entity-id={plan.plan_id}
              data-entity-status={plan.status}
              hover={false}
            >
              <CardContent className="flex items-center gap-3 pt-3">
                <Badge variant={STATUS_VARIANT[plan.status] ?? 'default'} size="xs">{plan.status}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{plan.declared_goal}</div>
                  <div className="text-xs text-tertiary">
                    {plan.agent_id} · {consumed}/{steps.length} steps consumed
                    {isDenied && <> · denials active until {relativeUntil(plan.expires_at)}</>}
                  </div>
                </div>
                {canDecide && (
                  <button
                    onClick={() => revoke(plan.plan_id)}
                    disabled={busy}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                  >
                    {isDenied ? 'Lift & revoke' : 'Revoke'}
                  </button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
