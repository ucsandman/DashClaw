'use client';

import { Fragment, useState } from 'react';
import { ListChecks, GitCompareArrows } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

const STATUS_VARIANT: Record<string, string> = {
  approved: 'success', partially_approved: 'warning', denied: 'error',
};
// 'previewing' falls through to the Badge default (muted zinc) — it isn't
// a verdict yet, so it doesn't earn success/warning/error color.

// Severity chips reuse the SessionRetroCard low/medium/high mapping; info
// joins low in muted zinc (calm under pressure — info is never a cue).
const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-error-subtle text-error',
  medium: 'bg-warning-subtle text-warning',
  low: 'bg-zinc-500/20 text-secondary',
  info: 'bg-zinc-500/20 text-secondary',
};

interface PlanStep { grant_used_at: string | null; }
interface Plan {
  plan_id: string; agent_id: string; declared_goal: string; status: string; expires_at: string | null;
}
export interface PlanDeviation {
  deviation_id: string; kind: string; severity: string; status: string; detector: string;
  step_id: string | null;
  declared: Record<string, unknown> | null;
  observed: Record<string, unknown> | null;
  agent_note?: string | null;
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

// Declared vs observed, side by side (RFC 2026-08-11 §12: the whole story on
// one card, no client-side reshaping). Rows render only keys either side has.
function DeclaredObservedPair({ declared, observed }: {
  declared: Record<string, unknown> | null; observed: Record<string, unknown> | null;
}) {
  const keys = [...new Set([...Object.keys(declared ?? {}), ...Object.keys(observed ?? {})])];
  const show = (v: unknown) =>
    v == null ? '—' : typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v);
  if (keys.length === 0) return null;
  return (
    <table className="mt-2 w-full text-xs tabular-nums">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-tertiary">
          <th className="py-1 pr-2 font-medium">Field</th>
          <th className="py-1 pr-2 font-medium">Declared (plan)</th>
          <th className="py-1 font-medium">Observed (live)</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const d = show(declared?.[k]);
          const o = show(observed?.[k]);
          const differs = d !== o;
          return (
            <tr key={k} className="border-t border-white/5 align-top">
              <td className="py-1 pr-2 text-tertiary">{k}</td>
              <td className="py-1 pr-2 text-secondary break-all">{d}</td>
              <td className={`py-1 break-all ${differs ? 'text-warning' : 'text-secondary'}`}>{o}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function LivePlansSection({ plans, canDecide, onResolved }: {
  plans: Array<{ plan: Plan; steps: PlanStep[]; deviations?: PlanDeviation[] }>;
  canDecide: boolean; onResolved: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ planId: string; message: string } | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  if (plans.length === 0) return null;

  // Confirm-free per FIX 6: revoke is the universal kill switch and the row
  // clears from this list on success, so a mis-click is low-cost to spot.
  const revoke = async (planId: string) => {
    try {
      setBusyId(planId);
      setErrorId(null);
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: 'revoke' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Revoke failed (${res.status})`);
      }
      onResolved();
    } catch (err) {
      setErrorId({ planId, message: err instanceof Error ? err.message : 'Revoke failed' });
    } finally {
      setBusyId(null);
    }
  };

  // Operator resolution (RFC 2026-08-11 §12.3: every human step a click).
  // Confirm-free like revoke: the row's status chip flips on success.
  const resolve = async (planId: string, deviationId: string, resolution: string, amend = false) => {
    try {
      setBusyId(deviationId);
      setErrorId(null);
      const res = await fetch(`/api/plans/${planId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verdict: 'resolve_deviation', deviation_id: deviationId, resolution,
          ...(amend ? { amend_plan: true } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Resolve failed (${res.status})`);
      }
      onResolved();
    } catch (err) {
      setErrorId({ planId, message: err instanceof Error ? err.message : 'Resolve failed' });
    } finally {
      setBusyId(null);
    }
  };

  const resolveBtnClass = 'inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:bg-white/10 disabled:opacity-50';

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        <ListChecks size={12} /> Live plans
      </div>
      <div className="space-y-2">
        {plans.map(({ plan, steps, deviations = [] }) => {
          const consumed = steps.filter((s) => s.grant_used_at).length;
          const isDenied = plan.status === 'denied';
          const isPreviewing = plan.status === 'previewing';
          const busy = busyId === plan.plan_id;
          const error = errorId?.planId === plan.plan_id ? errorId.message : null;
          const openDeviations = deviations.filter((d) => d.status === 'open');
          // Brand orange is the "needs you" cue — only an OPEN high-severity
          // deviation earns it; everything else stays warning/muted.
          const needsOperator = openDeviations.some((d) => d.severity === 'high');
          const expanded = expandedPlan === plan.plan_id;
          return (
            <Card
              key={plan.plan_id}
              data-entity-type="plan"
              data-entity-id={plan.plan_id}
              data-entity-status={plan.status}
              hover={false}
            >
              <CardContent className="pt-3">
                <div className="flex items-center gap-3">
                  <Badge variant={STATUS_VARIANT[plan.status] ?? 'default'} size="xs">{plan.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{plan.declared_goal}</div>
                    <div className="text-xs text-tertiary">
                      {plan.agent_id} ·{' '}
                      {isPreviewing ? (
                        <span className="italic">previews running…</span>
                      ) : (
                        <>{consumed}/{steps.length} steps consumed</>
                      )}
                      {isDenied && <> · denials active until {relativeUntil(plan.expires_at)}</>}
                    </div>
                  </div>
                  {deviations.length > 0 && (
                    <button
                      onClick={() => setExpandedPlan(expanded ? null : plan.plan_id)}
                      className="shrink-0"
                      aria-expanded={expanded}
                      aria-label={`Toggle deviations for plan ${plan.plan_id}`}
                    >
                      <Badge variant={needsOperator ? 'brand' : openDeviations.length > 0 ? 'warning' : 'default'} size="xs">
                        <GitCompareArrows size={10} className="mr-1 inline" aria-hidden="true" />
                        {deviations.length} deviation{deviations.length === 1 ? '' : 's'}
                        {openDeviations.length > 0 ? ` · ${openDeviations.length} open` : ''}
                      </Badge>
                    </button>
                  )}
                  {canDecide && (
                    <button
                      onClick={() => revoke(plan.plan_id)}
                      disabled={busy}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      {isDenied ? 'Lift & revoke' : 'Revoke'}
                    </button>
                  )}
                </div>
                {expanded && deviations.length > 0 && (
                  <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
                    {deviations.map((dv) => (
                      <Fragment key={dv.deviation_id}>
                        <div data-entity-type="plan-deviation" data-entity-id={dv.deviation_id} data-entity-status={dv.status}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLE[dv.severity] ?? SEVERITY_STYLE.low}`}>
                              {dv.severity}
                            </span>
                            <span className="text-xs font-medium text-white">{dv.kind.replace(/_/g, ' ')}</span>
                            {dv.detector === 'agent_reported' && (
                              <Badge size="xs">self-reported</Badge>
                            )}
                            {dv.status !== 'open' && (
                              <Badge variant={dv.status === 'rejected' ? 'error' : 'success'} size="xs">{dv.status}</Badge>
                            )}
                            {canDecide && dv.status === 'open' && (
                              <span className="ml-auto flex items-center gap-1.5">
                                <button className={resolveBtnClass} disabled={busyId === dv.deviation_id}
                                  onClick={() => resolve(plan.plan_id, dv.deviation_id, 'acknowledged')}>
                                  Acknowledge
                                </button>
                                <button className={resolveBtnClass} disabled={busyId === dv.deviation_id}
                                  onClick={() => resolve(plan.plan_id, dv.deviation_id, 'accepted')}>
                                  Accept
                                </button>
                                <button className={resolveBtnClass} disabled={busyId === dv.deviation_id}
                                  title="Accept and append the observed action to the plan as an approved step (future matches only)"
                                  onClick={() => resolve(plan.plan_id, dv.deviation_id, 'accepted', true)}>
                                  Accept &amp; amend plan
                                </button>
                                <button
                                  className="inline-flex items-center rounded-md border border-error/20 bg-error-subtle px-2 py-1 text-[11px] font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                                  disabled={busyId === dv.deviation_id}
                                  onClick={() => resolve(plan.plan_id, dv.deviation_id, 'rejected')}>
                                  Reject
                                </button>
                              </span>
                            )}
                          </div>
                          {dv.agent_note && (
                            <p className="mt-1 text-xs text-secondary">Agent note: {dv.agent_note}</p>
                          )}
                          <DeclaredObservedPair declared={dv.declared} observed={dv.observed} />
                        </div>
                      </Fragment>
                    ))}
                  </div>
                )}
                {error && <p className="mt-2 text-xs text-error">{error}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
