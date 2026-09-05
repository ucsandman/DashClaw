import { computeActContentHash } from '../act-content-hash';
import { claimActionExecution, getExecutionCandidate } from '../repositories/actions.repository.execution';
import type { SqlTag } from '../types/db';
import { evaluateGuard } from './evaluate';
import { invalidateGuardPolicyCache, invalidateGuardSettingsCache, invalidateGuardRiskTemplateCache } from './caches';
import type { GuardEvalContext } from './types';

/** Current-policy authority for a recorded attempt. The database claim is the
 * only execution permission; the preceding reads never consume approval. */
export async function authorizeActionExecution(sql: SqlTag, input: {
  orgId: string; actionId: string; principalId: string; attemptId: string; act: unknown;
  identity: { agent_id: string | null; verified: boolean; verification_status: string };
}) {
  if (!input.principalId || !input.identity.agent_id) return null;
  const binding = { orgId: input.orgId, actionId: input.actionId, principalId: input.principalId,
    agentId: input.identity.agent_id, actHash: computeActContentHash(input.act) };
  const candidate = await getExecutionCandidate(sql, binding);
  if (!candidate || (candidate.identity_verified === true && !input.identity.verified)) return null;
  let context: Record<string, unknown>;
  try {
    const parsed = typeof candidate.guard_context === 'string' ? JSON.parse(candidate.guard_context) : candidate.guard_context;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    context = { ...parsed };
  } catch { return null; }
  Object.assign(context, { action_id: input.actionId, agent_id: input.identity.agent_id,
    _execution_principal_id: input.principalId,
    action_type: candidate.action_type, declared_goal: candidate.declared_goal,
    act: input.act, verification_status: input.identity.verification_status,
    client_capabilities: Array.from(new Set([...(Array.isArray(context.client_capabilities) ? context.client_capabilities : []), 'execution_claims'])) });
  // Avoid replay-counting this internal evaluation as another client request.
  delete context.idempotency_key;
  // The claim is a new policy checkpoint, not a cached pre-approval receipt.
  invalidateGuardPolicyCache(input.orgId);
  invalidateGuardSettingsCache(input.orgId);
  invalidateGuardRiskTemplateCache(input.orgId);
  const decision = await evaluateGuard(input.orgId, context as GuardEvalContext, sql);
  if (decision.degraded || !['allow', 'warn', 'allow_contained'].includes(decision.decision)) return null;
  if (decision.decision === 'allow_contained' && (candidate.containment_status !== 'contained'
    || !decision.containment?.ref || candidate.containment_ref !== decision.containment.ref)) return null;
  return claimActionExecution(sql, { ...binding, attemptId: input.attemptId, decisionId: decision.decision_id,
    identityVerified: input.identity.verified });
}
