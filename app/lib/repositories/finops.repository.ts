import { getCostAggregation } from './actions.repository';
import { getX402SpendAggregation } from './x402.repository';
import { getCodeSessionSpendAggregation } from './code-sessions.repository';
import type { FleetSpend, ClaudeCodeSpend, SpendPeriod } from '../types/pricing-finops';
import type { SqlTag } from '../types/db';

/**
 * Read-only Fleet-lens rollup: Agent Spend (LLM token cost, x402 excluded) +
 * x402 Purchases (capability micropayments). Composes the owning repositories;
 * owns no tables of its own.
 *
 * Invariant: Fleet Spend = Agent LLM Spend (x402_purchase EXCLUDED upstream in
 * getCostAggregation) + x402 Purchase Spend.
 */
export async function getFleetSpend(
  sql: SqlTag,
  orgId: string,
  { period = '30d' }: { period?: SpendPeriod } = {},
): Promise<FleetSpend> {
  const [agent, x402] = await Promise.all([
    getCostAggregation(sql, orgId, { period }),
    getX402SpendAggregation(sql, orgId, { period }),
  ]);
  // Number() guards are defense-in-depth: the component repos already coerce,
  // but this is the invariant site (Fleet = Agent LLM + x402) — never let a
  // string-typed driver value concatenate here.
  const fleet_total_usd = Number(agent?.total_cost_usd ?? 0) + Number(x402?.total_spend_usd ?? 0);
  return { lens: 'fleet', period, agent, x402, fleet_total_usd };
}

/**
 * Read-only Claude-Code-lens rollup: the operator's own Claude Code token
 * cost (advisory — `governed: false`). Composes the code-sessions repository;
 * owns no tables of its own. Cost is already billed via billing.ts at ingest,
 * so this is a pure aggregation of stored `code_sessions.cost_usd`.
 *
 * Note: the response lens label is 'claude_code' (underscore), distinct from
 * the 'claude-code' request lens param.
 */
export async function getClaudeCodeSpend(
  sql: SqlTag,
  orgId: string,
  { period = '30d' }: { period?: SpendPeriod } = {},
): Promise<ClaudeCodeSpend> {
  const code_sessions = await getCodeSessionSpendAggregation(sql, orgId, { period });
  const code_total_usd = Number(code_sessions?.total_cost_usd ?? 0);
  return { lens: 'claude_code', period, code_sessions, code_total_usd };
}
