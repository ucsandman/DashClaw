// app/policies/lib/contractClient.ts
// Browser client for the contract + review endpoints.
import type { ContractView } from '../../lib/policy-modes/contract';
import type { WarnGroup } from '../../lib/repositories/policy-review.repository';

export type { ContractView, WarnGroup };

export interface ReviewPayload {
  groups: WarnGroup[];
  interrupts: Array<Record<string, unknown>>;
  cursor: string;
}

export type ReviewVerdict = 'fine' | 'always_allow' | 'tighten' | 'mark_all_reviewed';

export async function fetchContract(): Promise<ContractView> {
  const res = await fetch('/api/policies/contract');
  if (!res.ok) throw new Error(`Failed to load contract (${res.status})`);
  return res.json();
}

export async function fetchReview(): Promise<ReviewPayload> {
  const res = await fetch('/api/policies/review');
  if (!res.ok) throw new Error(`Failed to load review feed (${res.status})`);
  return res.json();
}

export async function postVerdict(
  verdict: ReviewVerdict,
  shape?: { action_type: string; target_prefix: string | null },
): Promise<void> {
  const res = await fetch('/api/policies/review/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict, ...(shape ? { shape } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Verdict failed (${res.status})`);
  }
}

/** Update a single editable threshold on a policy (spend approve/block). */
export async function patchPolicyParam(
  policyId: string,
  currentRules: Record<string, unknown>,
  param: 'approval_threshold' | 'max_spend_usd',
  value: number,
): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: policyId, rules: { ...currentRules, [param]: value } }),
  });
  if (!res.ok) throw new Error(`Failed to update threshold (${res.status})`);
}
