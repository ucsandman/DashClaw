import { computeActContentHash } from '../act-content-hash';
import { claimActionExecution, getExecutionCandidate } from '../repositories/actions.repository.execution';
import type { SqlTag } from '../types/db';
import { evaluateGuard } from './evaluate';
import { invalidateGuardPolicyCache, invalidateGuardSettingsCache, invalidateGuardRiskTemplateCache } from './caches';
import type { GuardEvalContext } from './types';

/** Current-policy authority for a recorded attempt. The database claim is the
 * only execution permission; the preceding reads never consume approval. */
/** A verdict the calling request computed for this same act moments ago
 * (the folded claim in POST /api/guard?record=true). Reused instead of a
 * second evaluation: there is no window for a policy change between an
 * evaluation and a claim made inside the same request. The database claim
 * stays the only execution permission either way. */
export type FreshDecision = { decision: string; decision_id?: string; degraded?: boolean; containment?: { ref?: string } | null };

export async function authorizeActionExecution(sql: SqlTag, input: {
  orgId: string; actionId: string; principalId: string; attemptId: string; act: unknown;
  identity: { agent_id: string | null; verified: boolean; verification_status: string };
  freshDecision?: FreshDecision;
}) {
  if (!input.principalId || !input.identity.agent_id) return null;
  const binding = { orgId: input.orgId, actionId: input.actionId, principalId: input.principalId,
    agentId: input.identity.agent_id, actHash: computeActContentHash(input.act) };
  const candidate = await getExecutionCandidate(sql, binding);
  if (!candidate || (candidate.identity_verified === true && !input.identity.verified)) return null;
  const decision = input.freshDecision ?? await reevaluateForClaim(sql, input, candidate);
  if (!decision) return null;
  if (decision.degraded || !['allow', 'warn', 'allow_contained'].includes(decision.decision)) return null;
  if (decision.decision === 'allow_contained' && (candidate.containment_status !== 'contained'
    || !decision.containment?.ref || candidate.containment_ref !== decision.containment.ref)) return null;
  // A claim is bound to the decision that authorized it; no id, no claim.
  if (typeof decision.decision_id !== 'string' || !decision.decision_id) return null;
  return claimActionExecution(sql, { ...binding, attemptId: input.attemptId, decisionId: decision.decision_id,
    identityVerified: input.identity.verified });
}

/** The PATCH path: a claim may arrive long after the guard verdict, so it is
 * a new policy checkpoint against the current policies, never a cached
 * pre-approval receipt. Returns null when the recorded context is unusable. */
async function reevaluateForClaim(
  sql: SqlTag,
  input: { orgId: string; actionId: string; principalId: string; act: unknown; identity: { agent_id: string | null; verification_status: string } },
  candidate: Record<string, unknown>,
) {
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
  invalidateGuardPolicyCache(input.orgId);
  invalidateGuardSettingsCache(input.orgId);
  invalidateGuardRiskTemplateCache(input.orgId);
  return evaluateGuard(input.orgId, context as GuardEvalContext, sql);
}
