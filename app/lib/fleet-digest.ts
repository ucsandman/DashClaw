// W3 fleet digest: one compact, evidence-first message a day. Sections are
// skipped when zero/unchanged; a fully quiet fleet is one line.
import { getGuardDecisionMix, getPolicyNamesByIds } from './repositories/guardrails.repository';
import { getPendingApprovalSummary, getCostAggregation } from './repositories/actions.repository';
import { getFloodState, FLEET_KEY } from './approval-flood';
import { computeSignals } from './signals';
import type { SqlTag } from './types/db';

export interface FleetDigest {
  quiet: boolean;
  text: string;
  pending_approvals: number;
  oldest_pending_minutes: number | null;
  floods: Array<{ policy_id: string; name: string; count: number }>;
  coverage_pct: number | null;
}

function delta(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? ' (new)' : '';
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (Math.abs(pct) < 10) return '';
  return ` (${pct > 0 ? '+' : ''}${pct}% vs prior 24h)`;
}

export async function composeFleetDigest(sql: SqlTag, orgId: string): Promise<FleetDigest> {
  const [mix, pendingSummary, cost, floodState] = await Promise.all([
    getGuardDecisionMix(sql as never, orgId, 24),
    getPendingApprovalSummary(sql as never, orgId),
    getCostAggregation(sql as never, orgId, { period: '1d' }),
    getFloodState(sql, orgId),
  ]);

  const floodIds = Object.keys(floodState).filter((k) => k !== FLEET_KEY);
  const names = await getPolicyNamesByIds(sql as never, orgId, floodIds);
  const floods = floodIds.map((id) => ({ policy_id: id, name: names[id] ?? id, count: floodState[id]?.count ?? 0 }));

  let signals: Array<{ severity: string; label: string }> = [];
  try {
    const all = await computeSignals(orgId, null, sql as never);
    signals = [...all]
      .sort((a, b) => (a.severity === 'red' ? -1 : 1) - (b.severity === 'red' ? -1 : 1))
      .slice(0, 3);
  } catch { /* signals are garnish — digest still ships */ }

  const total = Object.values(mix.current).reduce((a, b) => a + b, 0);
  const totalPrior = Object.values(mix.prior).reduce((a, b) => a + b, 0);
  const interrupts = (mix.current.require_approval ?? 0) + (mix.current.block ?? 0);
  const cov = cost.attribution?.coverage_pct ?? null;
  const oldestMin = pendingSummary.oldest_at
    ? Math.max(0, Math.round((Date.now() - new Date(pendingSummary.oldest_at).getTime()) / 60000))
    : null;

  const quiet =
    pendingSummary.pending === 0 &&
    floods.length === 0 &&
    !signals.some((s) => s.severity === 'red') &&
    interrupts === 0;

  const lines: string[] = [];
  if (quiet) {
    lines.push(
      `Fleet quiet: ${total} decisions${delta(total, totalPrior)}, 0 interrupts, $${(Number(cost.total_cost_usd) || 0).toFixed(2)} (24h)`,
    );
  } else {
    lines.push(
      `Fleet digest (24h): ${total} decisions${delta(total, totalPrior)} · ${interrupts} interrupt${interrupts === 1 ? '' : 's'} · $${(Number(cost.total_cost_usd) || 0).toFixed(2)}`,
    );
    if (pendingSummary.pending > 0) {
      lines.push(
        `${pendingSummary.pending} pending approval${pendingSummary.pending === 1 ? '' : 's'}${oldestMin !== null ? ` (oldest ${oldestMin}m)` : ''}`,
      );
    }
    for (const f of floods) lines.push(`Approval flood active: ${f.name} (${f.count} in window)`);
    if (cov !== null && cov < 90) lines.push(`Attribution coverage ${cov}% — cost is undercounting`);
    for (const s of signals) lines.push(`${s.severity === 'red' ? '[red]' : '[amber]'} ${s.label}`);
  }

  return {
    quiet,
    text: lines.join('\n'),
    pending_approvals: pendingSummary.pending,
    oldest_pending_minutes: oldestMin,
    floods,
    coverage_pct: cov,
  };
}
