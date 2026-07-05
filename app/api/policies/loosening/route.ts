export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { redactAny } from '../../../lib/security';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { validatePolicy } from '../../../lib/validate.js';
import { clampInt } from '../../../lib/policy-tuning/engine';
import {
  RELAX_RULE,
  DEACTIVATE_RULE,
  deriveLooseningProposals,
  looseningProposalId,
  policyEnvelope,
  LOOSENING_DEFAULTS,
  type LooseningRule,
} from '../../../lib/posture/loosening';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import {
  getInterruptOutcomesByPolicyAction,
  getLooseningDecisions,
  upsertLooseningDecision,
  deleteLooseningDecision,
  getPolicyForLoosening,
  applyLooseningRelaxation,
  type LooseningDecisionRow,
} from '../../../lib/repositories/loosening.repository';

const PROPOSAL_ID_RE = /^lp_[a-f0-9]{16}$/;
const STATUSES = new Set(['pending', 'ratified', 'dismissed']);
const MAX_REASON_LENGTH = 500;
const MAX_ACTION_TYPE_LENGTH = 256;
const MAX_POLICY_ID_LENGTH = 64;

type ProposalStatus = 'pending' | 'ratified' | 'dismissed';

function decisionSummary(row: LooseningDecisionRow) {
  return {
    decision: row.decision,
    reason: row.reason ?? null,
    decided_by: row.decided_by ?? null,
    decided_at: row.decided_at,
    policy_id: row.policy_id ?? null,
  };
}

/**
 * GET /api/policies/loosening — loosening proposals computed on read from
 * the org's interrupt-approval evidence (owner roadmap v4.5; spec
 * docs/superpowers/specs/2026-07-05-loosening-direction.md).
 *
 * The v3.2 tightening mirror: patterns humans approve ~100% of the time
 * become proposals to relax the interrupting policy — carve the action type
 * out of its envelope, or deactivate it. Persisted human decisions join by
 * the content-stable lp_ id; ratify self-suppresses through the policy's
 * updated_at evidence-window reset.
 *
 * Query: ?days=30 (7–90) · ?status=pending|ratified|dismissed ·
 * smoke-harness only: ?min_fired= / ?min_resolved= (1–100) ·
 * ?include_synthetic=1.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const days = clampInt(searchParams.get('days'), 7, 90, 30);
    const minFired = clampInt(searchParams.get('min_fired'), 1, 100, LOOSENING_DEFAULTS.minFired);
    const minResolved = clampInt(
      searchParams.get('min_resolved'),
      1,
      100,
      LOOSENING_DEFAULTS.minResolved,
    );
    const includeSynthetic = searchParams.get('include_synthetic') === '1';
    const statusFilter = searchParams.get('status');
    if (statusFilter !== null && !STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { error: 'status must be pending|ratified|dismissed' },
        { status: 400 },
      );
    }

    const [rows, policies, decisions] = await Promise.all([
      getInterruptOutcomesByPolicyAction(sql, orgId, days, { includeSynthetic }),
      getActivePolicies(sql, orgId),
      getLooseningDecisions(sql, orgId),
    ]);

    const derived = deriveLooseningProposals(rows, policies, {
      windowDays: days,
      minFired,
      minResolved,
    });
    const decisionById = new Map(decisions.map((d) => [d.proposal_id, d]));

    const proposals = derived.map((p) => {
      const row = decisionById.get(p.id);
      const status: ProposalStatus = row
        ? row.decision === 'dismissed'
          ? 'dismissed'
          : 'ratified'
        : 'pending';
      return { ...p, status, decision: row ? decisionSummary(row) : null };
    });

    const counts = { pending: 0, ratified: 0, dismissed: 0 };
    for (const p of proposals) counts[p.status] += 1;

    return NextResponse.json({
      window_days: days,
      min_fired: minFired,
      min_resolved: minResolved,
      synthetic_included: includeSynthetic,
      inputs: { outcome_rows: rows.length },
      proposals: statusFilter ? proposals.filter((p) => p.status === statusFilter) : proposals,
      counts,
    });
  } catch (err) {
    return apiErrorResponse(err, 'LOOSENING_PROPOSALS GET');
  }
}

/**
 * Validates the client-sent proposal snapshot for ratify/dismiss. The patch
 * is NOT trusted from the client — the server rebuilds the relaxation from
 * the policy's CURRENT rules, and the content-stable id doubles as an
 * integrity check: lp_(rule, policy_id, action_type) must equal proposal_id.
 */
function validateSnapshot(
  proposalId: string,
  p: Record<string, unknown> | null | undefined,
): { error: string } | { rule: LooseningRule; policyId: string; actionType: string | null } {
  if (!p || typeof p !== 'object') return { error: 'proposal snapshot is required' };
  const rule = p.rule;
  if (rule !== RELAX_RULE && rule !== DEACTIVATE_RULE) {
    return { error: `proposal.rule must be ${RELAX_RULE} or ${DEACTIVATE_RULE}` };
  }
  const policyId = p.policy_id;
  if (typeof policyId !== 'string' || !policyId || policyId.length > MAX_POLICY_ID_LENGTH) {
    return { error: `proposal.policy_id is required (1-${MAX_POLICY_ID_LENGTH} chars)` };
  }
  let actionType: string | null = null;
  if (rule === RELAX_RULE) {
    const raw = p.action_type;
    if (typeof raw !== 'string' || !raw || raw.length > MAX_ACTION_TYPE_LENGTH) {
      return { error: `proposal.action_type is required (1-${MAX_ACTION_TYPE_LENGTH} chars)` };
    }
    actionType = raw;
  }
  if (looseningProposalId(rule, policyId, actionType ?? '') !== proposalId) {
    return { error: 'proposal_id does not match the snapshot (rule, policy_id, action_type)' };
  }
  return { rule, policyId, actionType };
}

/**
 * POST /api/policies/loosening — record the human's judgment. Admin-only.
 * Body: { action: 'ratify'|'dismiss', proposal_id, proposal, reason? }
 *       { action: 'undo', proposal_id }   (deletes the judgment; audit-logged)
 *
 * Ratify applies the relaxation server-side in the same request (the
 * tightening precedent: no partial state where the policy changed but the
 * judgment was never recorded, or vice versa). Constitution §3 intact — the
 * policy relaxes only because a human clicked Ratify; nothing auto-applies.
 * Undo removes the judgment only: a relaxation a prior ratify applied stays
 * (change_kept — the policy is a first-class row, managed at /policies).
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    const proposalId = body?.proposal_id;

    if (action !== 'ratify' && action !== 'dismiss' && action !== 'undo') {
      return NextResponse.json({ error: 'action must be ratify, dismiss, or undo' }, { status: 400 });
    }
    if (typeof proposalId !== 'string' || !PROPOSAL_ID_RE.test(proposalId)) {
      return NextResponse.json({ error: 'proposal_id must match lp_<16 hex>' }, { status: 400 });
    }

    const sql = getSql();

    if (action === 'undo') {
      const removed = await deleteLooseningDecision(sql, orgId, proposalId);
      if (!removed) {
        return NextResponse.json({ error: 'No decision recorded for this proposal' }, { status: 404 });
      }
      const changeKept = removed.decision === 'ratified' ? removed.policy_id : null;
      logActivity(
        {
          orgId,
          actorId: userId,
          action: 'loosening_proposal.undone',
          resourceType: 'loosening_proposal',
          resourceId: proposalId,
          // The undo does NOT revert a ratified relaxation; name it so the
          // audit trail says where the change lives on.
          details: changeKept ? { policy_id: changeKept, change_kept: true } : {},
          request,
        },
        sql,
      );
      return NextResponse.json({
        ok: true,
        proposal_id: proposalId,
        removed: true,
        change_kept: changeKept,
      });
    }

    const validated = validateSnapshot(proposalId, body?.proposal as Record<string, unknown> | undefined);
    if ('error' in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const { rule, policyId, actionType } = validated;

    let reason: string | null = null;
    if (action === 'dismiss') {
      const raw = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (!raw || raw.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
          { error: `reason is required (1-${MAX_REASON_LENGTH} chars)` },
          { status: 400 },
        );
      }
      // SECURITY: redact likely secrets before storing human reasoning —
      // same convention as the approvals + tuning + tightening routes.
      reason = redactAny(raw, []) as string;
    }

    let policy: Record<string, unknown> | null = null;
    if (action === 'ratify') {
      const current = await getPolicyForLoosening(sql, orgId, policyId);
      if (!current) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }
      if (Number(current.active) !== 1 && current.active !== true) {
        return NextResponse.json(
          { error: 'Policy is already inactive — nothing to relax' },
          { status: 409 },
        );
      }

      if (rule === RELAX_RULE) {
        let rules: Record<string, unknown> = {};
        try {
          const parsed = typeof current.rules === 'string' ? JSON.parse(current.rules) : current.rules;
          if (parsed && typeof parsed === 'object') rules = parsed as Record<string, unknown>;
        } catch {
          /* best-effort: malformed stored rules JSON — the envelope check below 409s */
        }
        const envelope = policyEnvelope(rules);
        if (!envelope || actionType == null || !envelope.includes(actionType)) {
          return NextResponse.json(
            { error: 'The action type is no longer in the policy envelope — re-check the proposal queue' },
            { status: 409 },
          );
        }
        if (envelope.length < 2) {
          return NextResponse.json(
            { error: 'Removing the last action type would empty the policy — deactivate it instead' },
            { status: 409 },
          );
        }
        const nextRules = { ...rules, action_types: envelope.filter((t) => t !== actionType) };
        const rulesStr = JSON.stringify(nextRules);
        // Same validation bar as the policies PATCH route: never write rules
        // the guard would refuse to evaluate.
        const { valid, errors } = validatePolicy({
          name: String(current.name || 'policy'),
          policy_type: String(current.policy_type || ''),
          rules: rulesStr,
        });
        if (!valid) {
          return NextResponse.json({ error: 'Relaxed rules failed validation', details: errors }, { status: 400 });
        }
        policy = await applyLooseningRelaxation(sql, orgId, policyId, { rules: rulesStr });
      } else {
        policy = await applyLooseningRelaxation(sql, orgId, policyId, { active: 0 });
      }

      if (!policy) {
        return NextResponse.json({ error: 'Policy update failed' }, { status: 500 });
      }
      void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy, change_type: 'updated' });
    }

    const row = await upsertLooseningDecision(sql, orgId, {
      proposalId,
      rule,
      decision: action === 'ratify' ? 'ratified' : 'dismissed',
      actionType,
      policyId,
      snapshot: { rule, policy_id: policyId, ...(actionType ? { action_type: actionType } : {}) },
      reason,
      decidedBy: userId,
    });

    logActivity(
      {
        orgId,
        actorId: userId,
        action: `loosening_proposal.${action === 'ratify' ? 'ratified' : 'dismissed'}`,
        resourceType: 'loosening_proposal',
        resourceId: proposalId,
        details: {
          rule,
          policy_id: policyId,
          ...(actionType ? { action_type: actionType } : {}),
          ...(reason ? { reason } : {}),
        },
        request,
      },
      sql,
    );

    return NextResponse.json({
      ok: true,
      proposal_id: proposalId,
      decision: row ?? null,
      policy,
    });
  } catch (err) {
    return apiErrorResponse(err, 'LOOSENING_PROPOSALS POST');
  }
}
