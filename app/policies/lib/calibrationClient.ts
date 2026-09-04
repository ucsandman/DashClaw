// app/policies/lib/calibrationClient.ts
// Browser client for the calibration-proposals review endpoint
// (/api/calibration/proposals, owner roadmap v2.6b). Proposals are computed
// on read server-side; POSTs record the human's judgment.

import { errorFrom } from './errorFrom';

export interface CalibrationRepresentative {
  id?: string;
  origin?: string;
  action_id?: string | null;
  action_type?: string | null;
  declared_goal?: string | null;
  command_shape?: string | null;
  risk_score?: number | null;
  risk_breakdown?: unknown;
}

export interface CalibrationDecisionSummary {
  decision: 'ratified' | 'dismissed';
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
  forged_at: string | null;
  vector_name: string | null;
}

export interface CalibrationProposal {
  candidate_id: string;
  rule: 'over_scored_benign' | 'under_scored_danger' | 'repeated_approvals';
  suggested_label: 'benign' | 'risky';
  suggested_name: string;
  evidence_tier: string | null;
  count: number | null;
  risk_min: number | null;
  risk_max: number | null;
  event_ids: string[];
  representative: CalibrationRepresentative | null;
  provenance: string | null;
  ratify_command: string | null;
  needs_manual_context: boolean;
  from_snapshot?: boolean;
  status: 'pending' | 'ratified' | 'dismissed' | 'forged';
  decision: CalibrationDecisionSummary | null;
}

/**
 * Plain-English name for the rule that mined a candidate.
 *
 * One shape can mine under more than one rule at once — `rm -rf
 * node_modules/.cache` scored 45 and approved 6x mines both over_scored_benign
 * and repeated_approvals — and those candidates carry the same suggested_name,
 * count, risk band and evidence_tier. `rule` is the only field that separates
 * them, so any surface listing proposals must show it.
 */
export const CALIBRATION_RULE_LABEL: Record<CalibrationProposal['rule'], string> = {
  over_scored_benign: 'scored high for benign evidence',
  under_scored_danger: 'scored low for risky evidence',
  repeated_approvals: 'you keep approving this',
};

export interface CalibrationProposalsPayload {
  window_days: number;
  inputs: {
    decisions: number;
    decisions_truncated_at_limit: boolean;
    uploaded_samples: number;
    synthetic_excluded: number;
  };
  proposals: CalibrationProposal[];
  counts: { pending: number; ratified: number; dismissed: number; forged: number };
}

export async function fetchCalibrationProposals(days?: number): Promise<CalibrationProposalsPayload> {
  const url =
    days != null ? `/api/calibration/proposals?days=${days}` : '/api/calibration/proposals';
  const res = await fetch(url);
  if (!res.ok) throw await errorFrom(res, `Failed to load calibration proposals (${res.status})`);
  return res.json();
}

/** The snapshot the server persists — everything the maintainer forge needs later. */
function snapshotOf(proposal: CalibrationProposal) {
  return {
    rule: proposal.rule,
    suggested_label: proposal.suggested_label,
    suggested_name: proposal.suggested_name,
    evidence_tier: proposal.evidence_tier,
    count: proposal.count,
    risk_min: proposal.risk_min,
    risk_max: proposal.risk_max,
    provenance: proposal.provenance,
    ratify_command: proposal.ratify_command,
    needs_manual_context: proposal.needs_manual_context,
    representative: proposal.representative,
  };
}

export async function ratifyProposal(proposal: CalibrationProposal): Promise<void> {
  const res = await fetch('/api/calibration/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'ratify',
      proposal_id: proposal.candidate_id,
      proposal: snapshotOf(proposal),
    }),
  });
  if (!res.ok) throw await errorFrom(res, `Ratify failed (${res.status})`);
}

export async function dismissCalibrationProposal(
  proposal: CalibrationProposal,
  reason: string,
): Promise<void> {
  const res = await fetch('/api/calibration/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'dismiss',
      proposal_id: proposal.candidate_id,
      proposal: snapshotOf(proposal),
      reason,
    }),
  });
  if (!res.ok) throw await errorFrom(res, `Dismiss failed (${res.status})`);
}

export async function undoCalibrationDecision(proposalId: string): Promise<void> {
  const res = await fetch('/api/calibration/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'undo', proposal_id: proposalId }),
  });
  if (!res.ok) throw await errorFrom(res, `Undo failed (${res.status})`);
}
