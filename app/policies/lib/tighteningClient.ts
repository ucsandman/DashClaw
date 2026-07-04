// app/policies/lib/tighteningClient.ts
// Browser client for the tightening-proposals review endpoint
// (/api/policies/tightening, owner roadmap v3.2). Proposals are computed on
// read server-side from the org's ungoverned-allow evidence; POST ratify
// creates the governing policy in the same request, dismiss records why.

export interface TighteningDecisionSummary {
  decision: 'ratified' | 'dismissed';
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
  policy_id: string | null;
}

export interface TighteningProposal {
  id: string;
  rule: 'govern_ungoverned_allow';
  action_type: string;
  risk_level: 'high' | 'critical';
  finding_key: string;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    observed_count: number;
    risk_min: number;
    risk_max: number;
    example_decision_ids: string[];
  };
  patch: {
    name: string;
    policy_type: 'require_approval';
    rules: { action_types: string[]; _tightened: true };
  };
  status: 'pending' | 'ratified' | 'dismissed';
  decision: TighteningDecisionSummary | null;
}

export interface TighteningProposalsPayload {
  window_days: number;
  min_observed: number;
  synthetic_included: boolean;
  inputs: { decisions: number };
  proposals: TighteningProposal[];
  counts: { pending: number; ratified: number; dismissed: number };
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export async function fetchTighteningProposals(days?: number): Promise<TighteningProposalsPayload> {
  const url = days != null ? `/api/policies/tightening?days=${days}` : '/api/policies/tightening';
  const res = await fetch(url);
  if (!res.ok) throw await errorFrom(res, `Failed to load tightening proposals (${res.status})`);
  return res.json();
}

/** The snapshot the server validates — the id doubles as an integrity check. */
function snapshotOf(proposal: TighteningProposal) {
  return {
    rule: proposal.rule,
    action_type: proposal.action_type,
    risk_level: proposal.risk_level,
  };
}

/** Ratify = the server creates the governing policy and records the judgment. */
export async function ratifyTighteningProposal(
  proposal: TighteningProposal,
): Promise<{ policy_id: string | null }> {
  const res = await fetch('/api/policies/tightening', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'ratify',
      proposal_id: proposal.id,
      proposal: snapshotOf(proposal),
    }),
  });
  if (!res.ok) throw await errorFrom(res, `Ratify failed (${res.status})`);
  const body = await res.json().catch(() => ({}));
  return { policy_id: body?.policy?.id ? String(body.policy.id) : null };
}

export async function dismissTighteningProposal(
  proposal: TighteningProposal,
  reason: string,
): Promise<void> {
  const res = await fetch('/api/policies/tightening', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'dismiss',
      proposal_id: proposal.id,
      proposal: snapshotOf(proposal),
      reason,
    }),
  });
  if (!res.ok) throw await errorFrom(res, `Dismiss failed (${res.status})`);
}

export async function undoTighteningDecision(proposalId: string): Promise<void> {
  const res = await fetch('/api/policies/tightening', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'undo', proposal_id: proposalId }),
  });
  if (!res.ok) throw await errorFrom(res, `Undo failed (${res.status})`);
}
