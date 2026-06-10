/**
 * Agent registry orchestration (SPEC-mega.md Group C). A registry invocation is
 * NOT a new invocation system: it routes through the EXISTING capability
 * runtime (prepare + execute, which already do auth, timeout, retry, request and
 * response mapping, and SSRF defense), the EXISTING guard, and the EXISTING
 * action ledger. Risk derives from risk_class + budget + capability metadata via
 * RISK_SCORE_MAP and predictive-risk; no new risk scale.
 */

import crypto from 'node:crypto';
import { RISK_SCORE_MAP } from './capability-invoke';
import { getPredictiveRisk } from './predictive-risk';
import { evaluateGuard } from './guard';
import { prepareCapabilityInvocation, executeCapabilityInvocation } from './capability-runtime';
import { createActionRecord, createBlockedActionRecord, updateActionOutcome } from './repositories/actions.repository';
import { getRegisteredAgent, isCapabilityGrouped, recordInvocation } from './repositories/registered-agents.repository';
import type { SqlTag } from './types/db';

// RISK_SCORE_MAP is sourced from an untyped JS module; index access by a
// dynamic risk-level string.
const RISK_MAP = RISK_SCORE_MAP as Record<string, number | undefined>;

/** Capability metadata as resolved by the existing capability runtime. */
interface CapabilityLike {
  risk_level?: string;
  name?: string;
  slug?: string;
  requires_approval?: boolean;
  pricing?: { estimated_cost_usd?: number } | null;
  [key: string]: unknown;
}

interface DeriveRegistryRiskArgs {
  riskClass?: string;
  capability?: CapabilityLike;
  agentId?: string | null;
  actionType?: string;
  budgetUsd?: number | string | null;
}

/**
 * Derive an integer 0-100 risk score from the registered agent's risk_class,
 * the target capability's risk_level, its default budget, and the agent's
 * recent history (predictive-risk). Wraps the existing risk numbers; no new map.
 */
export async function deriveRegistryRisk(
  sql: SqlTag,
  orgId: string,
  { riskClass, capability, agentId, actionType = 'agent_invoke', budgetUsd }: DeriveRegistryRiskArgs = {},
): Promise<number> {
  const fromClass = (riskClass != null ? RISK_MAP[riskClass] : undefined) || 50;
  const fromCapability = capability?.risk_level ? (RISK_MAP[capability.risk_level] || 0) : 0;
  let base = Math.max(fromClass, fromCapability);
  const budget = Number(budgetUsd) || 0;
  if (budget >= 10) base += 10; else if (budget >= 1) base += 5; // higher spend authority => higher risk
  base = Math.max(0, Math.min(100, base));

  let adjustment = 0;
  try {
    const predictive: any = await getPredictiveRisk(sql, orgId, agentId ?? '', actionType, base, {});
    adjustment = predictive?.total_adjustment ?? 0;
  } catch {
    adjustment = 0;
  }
  return Math.max(0, Math.min(100, base + adjustment));
}

interface InvokeRegisteredAgentArgs {
  entryId?: string | null;
  capabilityId?: string | null;
  callerAgentId?: string | null;
  body?: unknown;
  declaredGoal?: string | null;
}

interface InvokeResult {
  status: number;
  payload: Record<string, unknown>;
}

/**
 * Invoke a capability through a registered agent, governed end to end by the
 * existing runtime. Returns { status, payload } for the route to relay.
 */
export async function invokeRegisteredAgent(
  sql: SqlTag,
  orgId: string,
  { entryId, capabilityId, callerAgentId = null, body = {}, declaredGoal }: InvokeRegisteredAgentArgs = {},
): Promise<InvokeResult> {
  if (!entryId || !capabilityId) {
    return { status: 400, payload: { error: 'registered_agent_id and capability_id are required' } };
  }

  const agent = await getRegisteredAgent(sql, orgId, entryId) as Record<string, any> | null;
  if (!agent) {
    return { status: 404, payload: { error: 'Registered agent not found' } };
  }
  if (agent.status !== 'active') {
    return { status: 409, payload: { error: `Registered agent is ${agent.status}, not active` } };
  }

  if (!(await isCapabilityGrouped(sql, orgId, entryId, capabilityId))) {
    return { status: 400, payload: { error: 'Capability is not registered to this agent' } };
  }

  // Delegate to the existing capability runtime for resolution (auth, endpoint,
  // schema). This is the only place the HTTP target is prepared; we never build
  // our own request.
  let prepared: any;
  try {
    prepared = await prepareCapabilityInvocation(sql, orgId, capabilityId);
  } catch (err: any) {
    const code = err?.code;
    const status = code === 'auth_not_configured' || code === 'endpoint_not_configured' || code === 'capability_contract_invalid' ? 400 : 400;
    return { status, payload: { error: code || 'capability_not_invocable', message: err?.message } };
  }

  const { capability, schema, authHeaders, endpoint } = prepared as {
    capability: CapabilityLike;
    schema: any;
    authHeaders: Record<string, string>;
    endpoint: string;
  };

  const riskScore = await deriveRegistryRisk(sql, orgId, {
    riskClass: agent.risk_class,
    capability,
    agentId: callerAgentId,
    actionType: 'agent_invoke',
    budgetUsd: agent.default_budget_usd,
  });

  const goal = declaredGoal || `Invoke registered agent ${agent.name} capability ${capability.name}`;
  const actionId = `act_${crypto.randomUUID()}`;
  const timestampStart = new Date().toISOString();
  const actionData = {
    agent_id: callerAgentId || 'anonymous',
    action_type: 'agent_invoke',
    declared_goal: goal,
    systems_touched: [`registered_agent:${agent.slug}`, `capability:${capability.slug}`],
    reversible: true,
    risk_score: riskScore,
    confidence: 50,
    input_summary: `registered_agent:${agent.slug} capability:${capability.slug}`,
  };

  const guardContext = {
    action_type: 'agent_invoke',
    risk_score: riskScore,
    agent_id: callerAgentId || null,
    systems_touched: actionData.systems_touched,
    reversible: true,
    declared_goal: goal,
  };
  const guardDecision: any = await evaluateGuard(orgId, guardContext as any, sql as any);

  if (guardDecision.decision === 'block') {
    await createBlockedActionRecord(sql, { orgId, action_id: actionId, data: actionData, guardDecision, signature: null, verified: false, timestamp_start: timestampStart });
    await recordInvocation(sql, orgId, { registeredAgentId: entryId, capabilityId, actionId, callerAgentId });
    return {
      status: 403,
      payload: { success: false, error: 'blocked_by_policy', action_id: actionId, guard_decision: { decision: guardDecision.decision, reasons: guardDecision.reasons, matched_policies: guardDecision.matched_policies } },
    };
  }

  if (guardDecision.decision === 'require_approval' || capability.requires_approval) {
    await createActionRecord(sql, { orgId, action_id: actionId, data: actionData, actionStatus: 'pending_approval', costEstimate: 0, signature: null, verified: false, timestamp_start: timestampStart });
    await recordInvocation(sql, orgId, { registeredAgentId: entryId, capabilityId, actionId, callerAgentId });
    return { status: 202, payload: { success: false, error: 'pending_approval', action_id: actionId } };
  }

  await createActionRecord(sql, {
    orgId, action_id: actionId, data: actionData, actionStatus: 'running',
    costEstimate: capability.pricing?.estimated_cost_usd || 0, signature: null, verified: false, timestamp_start: timestampStart,
  });

  const result: any = await executeCapabilityInvocation({ endpoint, authHeaders, schema, body });

  const timestampEnd = new Date().toISOString();
  await updateActionOutcome(sql, orgId, actionId, {
    status: result.success ? 'completed' : 'failed',
    output_summary: result.success ? 'agent invocation completed' : (result.message || result.error || 'failed'),
    error_message: result.success ? null : (result.message || result.error || null),
    timestamp_end: timestampEnd,
    duration_ms: result.elapsed_ms || 0,
  });
  await recordInvocation(sql, orgId, { registeredAgentId: entryId, capabilityId, actionId, callerAgentId });

  return {
    status: result.success ? 200 : 502,
    payload: { success: result.success, action_id: actionId, risk_score: riskScore, result },
  };
}
