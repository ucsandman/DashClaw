// app/policies/lib/looseningClient.ts
// Browser client for the loosening-proposals review endpoint
// (/api/policies/loosening, owner roadmap v4.5). Proposals are computed on
// read server-side from the org's interrupt-approval evidence; POST ratify
// applies the relaxation in the same request, dismiss records why. Undo
// keeps a ratified relaxation (change_kept — the tightening precedent).

export interface LooseningDecisionSummary {
  decision: 'ratified' | 'dismissed';
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
  policy_id: string | null;
}

export interface LooseningProposal {
  id: string;
  rule: 'relax_policy_scope' | 'deactivate_policy';
  policy_id: string;
  policy_name: string;
  policy_type: string;
  action_type: string | null;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    window_started_at: string;
    fired: number;
    approvals: { approved: number; denied: number; pending: number };
    override_rate: number;
    example_decision_ids: string[];
  };
  patch: { rules: Record<string, unknown> } | { active: false };
  status: 'pending' | 'ratified' | 'dismissed';
  decision: LooseningDecisionSummary | null;
}

export interface LooseningProposalsPayload {
  window_days: number;
  min_fired: number;
  min_resolved: number;
  synthetic_included: boolean;
  inputs: { outcome_rows: number };
  proposals: LooseningProposal[];
  counts: { pending: number; ratified: number; dismissed: number };
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export async function fetchLooseningProposals(days?: number): Promise<LooseningProposalsPayload> {
  const url = days != null ? `/api/policies/loosening?days=${days}` : '/api/policies/loosening';
  const res = await fetch(url);
  if (!res.ok) throw await errorFrom(res, `Failed to load loosening proposals (${res.status})`);
  return res.json();
}

/** The snapshot the server validates — the id doubles as an integrity check. */
function snapshotOf(proposal: LooseningProposal) {
  return {
    rule: proposal.rule,
    policy_id: proposal.policy_id,
    ...(proposal.action_type ? { action_type: proposal.action_type } : {}),
  };
}

/** Ratify = the server applies the relaxation and records the judgment. */
export async function ratifyLooseningProposal(
  proposal: LooseningProposal,
): Promise<{ policy_id: string | null }> {
  const res = await fetch('/api/policies/loosening', {
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

export async function dismissLooseningProposal(
  proposal: LooseningProposal,
  reason: string,
): Promise<void> {
  const res = await fetch('/api/policies/loosening', {
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

export async function undoLooseningDecision(proposalId: string): Promise<void> {
  const res = await fetch('/api/policies/loosening', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'undo', proposal_id: proposalId }),
  });
  if (!res.ok) throw await errorFrom(res, `Undo failed (${res.status})`);
}
