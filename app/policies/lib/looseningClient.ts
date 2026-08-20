// app/policies/lib/looseningClient.ts
// Browser client for the loosening-proposals review endpoint
// (/api/policies/loosening, owner roadmap v4.5). Proposals are computed on
// read server-side from the org's interrupt-approval evidence; POST ratify
// applies the relaxation in the same request, dismiss records why. Undo
// keeps a ratified relaxation (change_kept — the tightening precedent).

import type { Misfire } from '../../lib/posture/loosening';

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

/**
 * A precedent: a shape the operator has personally approved repeatedly, across
 * days, offered as a narrow standing grant. Structurally different from the
 * other two rules — it CREATES an allow_grant rather than editing a policy, so
 * it has no policy_id and its evidence is counted per shape, not per policy.
 */
export interface PrecedentProposal {
  id: string;
  rule: 'precedent_grant';
  policy_id: null;
  policy_name: null;
  policy_type: 'allow_grant';
  action_type: string;
  precedent_flags: string[];
  precedent_key: string;
  ttl_days: number;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    approved: number;
    denied: number;
    distinct_days: number;
    example_decision_ids: string[];
  };
  status: 'pending' | 'ratified' | 'dismissed';
  decision: LooseningDecisionSummary | null;
}

/**
 * An interruption-budget defect report: this policy is firing faster than any
 * human can answer. Unlike every other rule in this queue it needs NO
 * adjudication evidence — the operator drowning in interruptions is exactly
 * the operator who stops resolving them, so the other rules go silent right
 * when they are needed (2026-08-16 incident). Volume alone is the signal.
 *
 * The guard has usually already downgraded the rule to `warn` by the time this
 * card appears (`auto_demoted`). That relief is temporary and self-expiring;
 * ratifying is the operator's PERMANENT decision to deactivate the rule. For
 * an `ungrantable` rule nothing was auto-demoted and this button is the only
 * way out.
 */
export interface BudgetProposal {
  id: string;
  rule: 'over_interruption_budget';
  policy_id: string;
  policy_name: string;
  policy_type: string;
  action_type: null;
  auto_demoted: boolean;
  ungrantable: boolean;
  title: string;
  summary: string;
  evidence: {
    window_hours: number;
    budget: number;
    fired: number;
    over_by: number;
    example_decision_ids: string[];
  };
  patch: { active: false };
  status: 'pending' | 'ratified' | 'dismissed';
  decision: LooseningDecisionSummary | null;
}

/** Any shape can appear in the loosen queue. Discriminate on `rule`. */
export type AnyLooseningProposal = LooseningProposal | PrecedentProposal | BudgetProposal;

export function isPrecedent(p: AnyLooseningProposal): p is PrecedentProposal {
  return p.rule === 'precedent_grant';
}

export function isBudget(p: AnyLooseningProposal): p is BudgetProposal {
  return p.rule === 'over_interruption_budget';
}

/**
 * A misfire: one command shape held three times in 24h by ONE Short List line.
 * Reported, never applied — the only exit is the operator's click, which writes
 * a shape-scoped exception on that line (see misfireClient).
 */
export type { Misfire };

/** A command shape the guard stopped interrupting on automatically. */
export interface OverBudgetShape {
  key: string;
  fired: number;
}

export interface LooseningProposalsPayload {
  window_days: number;
  min_fired: number;
  min_resolved: number;
  synthetic_included: boolean;
  interruption_budget?: {
    per_window: number;
    window_hours: number;
    shape_per_window: number;
    shapes_over_budget: OverBudgetShape[];
  };
  /** Present since the misfire report landed; older payloads omit it. */
  misfires?: Misfire[];
  misfire_threshold?: number;
  inputs: { outcome_rows: number };
  proposals: AnyLooseningProposal[];
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
function snapshotOf(proposal: AnyLooseningProposal) {
  if (isPrecedent(proposal)) {
    // No policy_id: a precedent creates a grant. The server re-derives the id
    // from (action_type, precedent_flags) and re-checks eligibility, so this
    // snapshot cannot be used to widen anything.
    return {
      rule: proposal.rule,
      action_type: proposal.action_type,
      precedent_flags: proposal.precedent_flags,
    };
  }
  return {
    rule: proposal.rule,
    policy_id: proposal.policy_id,
    ...(proposal.action_type ? { action_type: proposal.action_type } : {}),
  };
}

/** Ratify = the server applies the relaxation and records the judgment. */
export async function ratifyLooseningProposal(
  proposal: AnyLooseningProposal,
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
  // Relax/deactivate return the edited policy; a precedent returns the id of
  // the grant it created. Both land in the /policies Ledger as normal rows.
  if (body?.policy?.id) return { policy_id: String(body.policy.id) };
  if (body?.grant_id) return { policy_id: String(body.grant_id) };
  return { policy_id: null };
}

export async function dismissLooseningProposal(
  proposal: AnyLooseningProposal,
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
