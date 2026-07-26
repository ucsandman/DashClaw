'use client';

import { useState } from 'react';
import { Check, X, ListChecks } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

const PREVIEW_VARIANT: Record<string, string> = {
  allow: 'success', warn: 'warning', require_approval: 'warning', block: 'error',
};

interface PlanStep {
  step_id: string; seq: number; action_type: string; step_goal: string;
  preview_decision: string | null; preview_risk_score: number | null;
  act_content_hash: string | null; grant_status: string; act?: unknown;
}

// R5: the act hash binds content the operator can't fully see once it's been
// redacted for display (see S2 in plans.repository.ts createPlanWithSteps).
// Surface how many values were scrubbed so the operator knows the hash they're
// approving covers hidden content, not just what's rendered. security.ts's
// redactAny always stamps `[REDACTED:<pattern>]`, never the bare literal.
function countRedactions(act: unknown): number {
  if (act === undefined || act === null) return 0;
  return (JSON.stringify(act).match(/\[REDACTED:/g) ?? []).length;
}
interface Plan {
  plan_id: string; agent_id: string; declared_goal: string; status: string;
  ttl_minutes: number; created_at: string;
}

export default function PlanReviewCard({ plan, steps, canDecide, onResolved }: {
  plan: Plan; steps: PlanStep[]; canDecide: boolean; onResolved: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, 'approve' | 'deny'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleStep = (stepId: string) => {
    setOverrides((prev) => ({ ...prev, [stepId]: prev[stepId] === 'deny' ? 'approve' : 'deny' }));
  };

  const submit = async (verdict: 'approve' | 'deny') => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/plans/${plan.plan_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verdict === 'approve' ? { verdict, step_overrides: overrides } : { verdict }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Plan verdict failed (${res.status})`);
      }
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan verdict failed');
    } finally {
      setBusy(false);
    }
  };

  const deniedCount = Object.values(overrides).filter((v) => v === 'deny').length;

  return (
    <Card data-entity-type="plan" data-entity-id={plan.plan_id} data-entity-status={plan.status} hover={false}>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 mb-1">
          <ListChecks size={16} className="text-brand" />
          <Badge variant="brand">Plan review</Badge>
          <span className="text-xs text-tertiary">{plan.agent_id}</span>
          <span className="text-xs text-tertiary">· TTL {plan.ttl_minutes}m after approval</span>
        </div>
        <h3 className="text-lg font-semibold text-white mb-3">{plan.declared_goal}</h3>

        <div className="rounded-lg border border-border overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tertiary uppercase tracking-wider bg-white/5">
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">Step</th>
                <th className="px-3 py-2 w-36">Type</th>
                <th className="px-3 py-2 w-40">Preview</th>
                <th className="px-3 py-2 w-28 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => {
                const denied = overrides[step.step_id] === 'deny';
                const redactedCount = countRedactions(step.act);
                return (
                  <tr key={step.step_id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums text-tertiary">{step.seq}</td>
                    <td className="px-3 py-2 text-white">
                      {step.step_goal}
                      {step.act_content_hash && (
                        <span className="ml-2 inline-flex items-center gap-1.5">
                          <Badge variant="info" size="xs">Act-bound</Badge>
                          {redactedCount > 0 && (
                            <span
                              className="text-[11px] text-tertiary"
                              title="The act hash binds content the operator can't fully see"
                            >
                              {redactedCount} redacted value{redactedCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-secondary">{step.action_type}</td>
                    <td className="px-3 py-2">
                      {step.preview_decision ? (
                        <span title="Advisory: conditions can change between review and execution">
                          <Badge variant={PREVIEW_VARIANT[step.preview_decision] ?? 'default'} size="xs">
                            {step.preview_decision}
                            {step.preview_risk_score != null ? ` · ${step.preview_risk_score}` : ''}
                          </Badge>
                        </span>
                      ) : (
                        <Badge size="xs">no preview</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleStep(step.step_id)}
                        disabled={busy || !canDecide}
                        className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          denied
                            ? 'border-error/20 bg-error-subtle text-error'
                            : 'border-success/20 bg-success-subtle text-success'
                        }`}
                      >
                        {denied ? 'Denied' : 'Approved'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-tertiary mb-3">
          Previews are advisory — a grant only applies when the live evaluation still requires approval.
          Denied steps are blocked outright for the plan&apos;s TTL.
        </p>
        {error && <p className="text-xs text-error mb-3">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={() => submit('approve')}
            disabled={busy || !canDecide}
            className="inline-flex items-center gap-1.5 rounded-lg border border-success/20 bg-success-subtle px-3 py-1.5 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={16} /> {deniedCount > 0 ? `Approve ${steps.length - deniedCount} of ${steps.length} steps` : 'Approve plan'}
          </button>
          <button
            onClick={() => submit('deny')}
            disabled={busy || !canDecide}
            className="inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-sm font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} /> Deny plan
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
