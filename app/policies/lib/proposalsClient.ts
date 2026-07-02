// app/policies/lib/proposalsClient.ts
// Browser client for the policy-tuning proposals endpoint (/api/policies/proposals).
// Imports only *types* from the engine (erased at build) — never the engine's
// runtime, which is server-only computation over repository rows.
import type {
  TuningProposal,
  PolicyFiredCounts,
  PolicyApprovalCounts,
  ApprovedRiskScores,
} from '../../lib/policy-tuning/engine';

export type { TuningProposal, PolicyFiredCounts, PolicyApprovalCounts, ApprovedRiskScores };

/** Per-policy interruption stats — the `policies[]` entries of the GET response. */
export interface ProposalPolicyStat {
  policy_id: string;
  name: string;
  policy_type: string;
  active: boolean;
  updated_at: string | null;
  window_started_at: string;
  fired: PolicyFiredCounts;
  approvals: PolicyApprovalCounts;
  override_rate: number | null;
  approved_risk_scores: ApprovedRiskScores | null;
  last_fired_at: string | null;
}

/** Org-wide deadline-degradation summary — the `degradation` block of the GET response. */
export interface DegradationSummary {
  window_days: number;
  total: number;
  degraded: number;
  rate: number;
  last_degraded_at: string | null;
  by_day: Array<{ day: string; total: number; degraded: number }>;
}

export interface ProposalsPayload {
  window_days: number;
  policies: ProposalPolicyStat[];
  proposals: TuningProposal[];
  dismissed_count: number;
  degradation?: DegradationSummary;
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export async function fetchProposals(days?: number): Promise<ProposalsPayload> {
  const url = days != null ? `/api/policies/proposals?days=${days}` : '/api/policies/proposals';
  const res = await fetch(url);
  if (!res.ok) throw await errorFrom(res, `Failed to load tuning proposals (${res.status})`);
  return res.json();
}

export async function dismissProposal(proposalId: string, reason: string): Promise<void> {
  const res = await fetch('/api/policies/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dismiss', proposal_id: proposalId, reason }),
  });
  if (!res.ok) throw await errorFrom(res, `Dismiss failed (${res.status})`);
}

export async function undismissProposal(proposalId: string): Promise<void> {
  const res = await fetch('/api/policies/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'undismiss', proposal_id: proposalId }),
  });
  if (!res.ok) throw await errorFrom(res, `Undismiss failed (${res.status})`);
}

/** PATCH the policy through the existing /api/policies route — a human ratifies; nothing auto-applies. */
export async function acceptProposal(policyId: string, rules: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: policyId, rules }),
  });
  if (!res.ok) throw await errorFrom(res, `Failed to apply proposal (${res.status})`);
}
