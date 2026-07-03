'use client';

import { useState, useEffect, useCallback } from 'react';
import EntityLink from '../../components/context-menu/EntityLink';
import type { X402BudgetEntry } from '../../lib/types/x402';

const usd = (n: number) => `$${Number(n || 0).toFixed(2)}`;

/**
 * Consumption tone mirrors the gate's tiers: error at/over the hard budget,
 * warning at/over the approval threshold (or 80% of the hard budget when no
 * approval tier exists), neutral otherwise. Color is never the only signal —
 * the numbers carry the same state.
 */
function fillTone(spend: number, approval: number | null, budget: number | null): string {
  if (budget != null && spend >= budget) return 'bg-status-error';
  if (approval != null ? spend >= approval : budget != null && spend >= 0.8 * budget) return 'bg-status-warning';
  return 'bg-white/30';
}

function MeterBar({ label, spend, approval, budget }: { label: string; spend: number; approval: number | null; budget: number | null }) {
  const cap = budget ?? approval ?? 0;
  const pct = cap > 0 ? Math.min(100, (spend / cap) * 100) : 0;
  const tickPct = budget != null && approval != null && approval < budget ? (approval / budget) * 100 : null;
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(spend, cap)}
      aria-label={`${label}: ${usd(spend)} of ${usd(cap)} window budget used`}
    >
      <div className={`h-1.5 rounded-full ${fillTone(spend, approval, budget)} transition-all`} style={{ width: `${pct}%` }} />
      {tickPct != null && (
        <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${tickPct}%` }} title={`Approval threshold ${usd(approval as number)}`} />
      )}
    </div>
  );
}

function SpendLine({ spend, approval, budget }: { spend: number; approval: number | null; budget: number | null }) {
  const over = budget != null && spend >= budget;
  const warm = !over && (approval != null ? spend >= approval : budget != null && spend >= 0.8 * budget);
  return (
    <span className={`tabular-nums ${over ? 'text-error' : warm ? 'text-warning' : 'text-secondary'}`}>
      {usd(spend)}
      <span className="text-tertiary"> of {budget != null ? usd(budget) : `${usd(approval as number)} (approval)`}</span>
    </span>
  );
}

/**
 * Live cumulative-budget meters for /spend/x402 (roadmap v2.6c): renders the
 * window spend the guard's x402 budget gate would evaluate the NEXT purchase
 * against, per budget-bearing policy. Hidden entirely when no active
 * x402_spend_limit policy carries a budget tier.
 */
export default function X402BudgetMeters({ agentId }: { agentId?: string | null }) {
  const [budgets, setBudgets] = useState<X402BudgetEntry[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/x402/budget${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBudgets((await res.json()).budgets || []);
    } catch (err) {
      console.error('Failed to load x402 budget state:', err);
      setError(true);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-xs">
        <span className="text-error">Failed to load budget consumption.</span>
        <button onClick={load} className="rounded-md border border-border px-2 py-1 text-secondary transition-colors hover:border-border-hover">Retry</button>
      </div>
    );
  }
  if (!budgets || budgets.length === 0) return null; // no budget-bearing policies — nothing to meter

  return (
    <section aria-label="x402 window budgets" className="mb-4">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-tertiary">Window budgets</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {budgets.map((b) => {
          const title = b.policy_name || b.policy_id;
          const meta = `${b.budget_window_days}d · ${b.budget_scope === 'agent' ? 'per agent' : 'org'}`;
          return (
            <div key={b.policy_id} className="rounded-xl border border-border bg-surface-secondary p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate text-sm text-primary" title={title}>{title}</div>
                <div className="shrink-0 text-[10px] uppercase tracking-widest text-tertiary">{meta}</div>
              </div>
              {b.budget_scope === 'org' ? (
                <div className="mt-3 space-y-1.5">
                  <div className="text-sm">
                    <SpendLine spend={b.window_spend_usd ?? 0} approval={b.budget_approval_threshold} budget={b.budget_usd} />
                  </div>
                  <MeterBar label={title} spend={b.window_spend_usd ?? 0} approval={b.budget_approval_threshold} budget={b.budget_usd} />
                </div>
              ) : !b.families || b.families.length === 0 ? (
                <div className="mt-3 text-xs text-tertiary">No attributed spend in this window.</div>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {b.families.map((f) => (
                    <div key={f.agent_id} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate font-mono"><EntityLink type="agent" id={f.agent_id} /></span>
                        <SpendLine spend={f.window_spend_usd} approval={b.budget_approval_threshold} budget={b.budget_usd} />
                      </div>
                      <MeterBar label={`${title} — ${f.agent_id}`} spend={f.window_spend_usd} approval={b.budget_approval_threshold} budget={b.budget_usd} />
                    </div>
                  ))}
                </div>
              )}
              {b.budget_approval_threshold != null && b.budget_usd != null && (
                <div className="mt-2 text-[11px] text-tertiary">Approval from {usd(b.budget_approval_threshold)} · blocks over {usd(b.budget_usd)}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
