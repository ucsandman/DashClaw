// Folded execution claim for POST /api/guard?record=true.
//
// The governed hook used to make two round trips per tool call: the guard
// evaluation (which also records the running action) and then a PATCH
// /api/actions/<id> carrying { claim_execution, attempt_id } to claim the one
// execution attempt. Measured from a Windows workstation on 2026-09-06 the two
// HTTPS calls were 610 of the hook's 694 ms. When the guard body itself carries
// { claim_execution: true, attempt_id }, this module performs the identical
// claim (same authority, authorizeActionExecution, same eligibility rules,
// same one-attempt guarantee) inside the guard request and echoes
// { claimed, attempt_id, action_id, claimed_at } in the response, so the hook
// skips the PATCH. A server without this module ignores the two body fields
// and answers with no `claimed` key; the hook then falls back to the PATCH.
//
// Only an immediately permissive decision (allow, warn) is claimed here. A
// require_approval decision is claimed by the hook after the approval, a block
// is never claimed, and allow_contained keeps the PATCH because the hook sets
// up the containment worktree between the guard verdict and the claim.
import { authorizeActionExecution } from './execution';
import type { GuardData, GuardSql } from './route-record';

// Same shape PATCH /api/actions/[actionId] enforces for a claim.
export const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const FOLDABLE_DECISIONS = new Set(['allow', 'warn']);

/** The attempt_id when the guard body asks for a folded claim, else null. */
export function requestedAttemptId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.claim_execution !== true) return null;
  return typeof b.attempt_id === 'string' && ATTEMPT_ID_RE.test(b.attempt_id) ? b.attempt_id : null;
}

/**
 * Claim the just-recorded action and stamp the outcome on `result`.
 * Leaves `result` untouched (no `claimed` key) when the claim cannot be
 * attempted here, so the hook's PATCH fallback keeps today's behaviour.
 */
export async function attachExecutionClaim(
  sql: GuardSql,
  orgId: string,
  input: { attemptId: string; principalId: string; act: unknown },
  data: GuardData,
  result: Record<string, unknown>,
): Promise<void> {
  if (result.recorded !== true || typeof result.action_id !== 'string' || !result.action_id) return;
  if (!FOLDABLE_DECISIONS.has(String(result.decision))) return;
  const agentId = typeof data.agent_id === 'string' && data.agent_id ? data.agent_id : null;
  if (!agentId || !input.principalId) return;
  const verificationStatus = typeof data.verification_status === 'string' ? data.verification_status : 'unverified';
  try {
    const claimed = await authorizeActionExecution(sql, {
      orgId,
      actionId: result.action_id,
      principalId: input.principalId,
      attemptId: input.attemptId,
      act: input.act,
      identity: { agent_id: agentId, verified: verificationStatus === 'verified', verification_status: verificationStatus },
    });
    result.attempt_id = input.attemptId;
    if (claimed) {
      result.claimed = true;
      result.claimed_at = (claimed as { execution_claimed_at?: unknown }).execution_claimed_at ?? null;
    } else {
      // Same verdict PATCH answers with 409 EXECUTION_CLAIM_CONFLICT; the hook
      // treats it as a failed claim and does not retry.
      result.claimed = false;
      result.claim_error = 'EXECUTION_CLAIM_CONFLICT';
    }
  } catch (err) {
    console.error('[Guard] folded execution claim failed:', (err as Error).message);
    delete result.claimed;
    delete result.attempt_id;
  }
}
