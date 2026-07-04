export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { logActivity } from '../../../lib/audit';
import { redactAny } from '../../../lib/security';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { clampInt } from '../../../lib/policy-tuning/engine';
import {
  TIGHTENING_RULE,
  deriveTighteningProposals,
  tighteningProposalId,
  tighteningFindingKey,
} from '../../../lib/posture/tightening';
import { getActivePolicies, insertPolicy } from '../../../lib/repositories/guardrails.repository';
import { setFindingState } from '../../../lib/repositories/posture.repository';
import {
  getUngovernedAllowDecisions,
  getTighteningDecisions,
  upsertTighteningDecision,
  deleteTighteningDecision,
  type TighteningDecisionRow,
} from '../../../lib/repositories/tightening.repository';

const PROPOSAL_ID_RE = /^tp_[a-f0-9]{16}$/;
const RISK_LEVELS = new Set(['high', 'critical']);
const STATUSES = new Set(['pending', 'ratified', 'dismissed']);
const MAX_REASON_LENGTH = 500;
const MAX_ACTION_TYPE_LENGTH = 256;

type ProposalStatus = 'pending' | 'ratified' | 'dismissed';

const gpId = () => `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

function decisionSummary(row: TighteningDecisionRow) {
  return {
    decision: row.decision,
    reason: row.reason ?? null,
    decided_by: row.decided_by ?? null,
    decided_at: row.decided_at,
    policy_id: row.policy_id ?? null,
  };
}

/**
 * GET /api/policies/tightening — tightening proposals computed on read from
 * the org's ungoverned-allow evidence (owner roadmap v3.2; spec
 * docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md).
 *
 * Same grouping as v3.1's pattern-collapsed review_incident posture findings
 * (action_type × riskLevel bucket), so proposal and finding mirror each other
 * one-to-one via finding_key. Persisted human decisions join by the
 * content-stable tp_ id; an active governing policy suppresses the pattern
 * entirely (ratify retires its own proposal through the policy it created).
 *
 * Query: ?days=7 (1–90) · ?status=pending|ratified|dismissed ·
 * smoke-harness only: ?min_observed= (1–100, default 3) · ?include_synthetic=1.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const days = clampInt(searchParams.get('days'), 1, 90, 7);
    const minObserved = clampInt(searchParams.get('min_observed'), 1, 100, 3);
    const includeSynthetic = searchParams.get('include_synthetic') === '1';
    const statusFilter = searchParams.get('status');
    if (statusFilter !== null && !STATUSES.has(statusFilter)) {
      return NextResponse.json(
        { error: 'status must be pending|ratified|dismissed' },
        { status: 400 },
      );
    }

    const [rows, policies, decisions] = await Promise.all([
      getUngovernedAllowDecisions(sql, orgId, days, { includeSynthetic }),
      getActivePolicies(sql, orgId),
      getTighteningDecisions(sql, orgId),
    ]);

    const derived = deriveTighteningProposals(
      rows,
      policies as { policy_type: unknown; rules: unknown }[],
      { windowDays: days, minObserved },
    );
    const decisionById = new Map(decisions.map((d) => [d.proposal_id, d]));

    const proposals = derived.map((p) => {
      const row = decisionById.get(p.id);
      const status: ProposalStatus = row ? (row.decision === 'dismissed' ? 'dismissed' : 'ratified') : 'pending';
      return { ...p, status, decision: row ? decisionSummary(row) : null };
    });

    const counts = { pending: 0, ratified: 0, dismissed: 0 };
    for (const p of proposals) counts[p.status] += 1;

    return NextResponse.json({
      window_days: days,
      min_observed: minObserved,
      synthetic_included: includeSynthetic,
      inputs: { decisions: rows.length },
      proposals: statusFilter ? proposals.filter((p) => p.status === statusFilter) : proposals,
      counts,
    });
  } catch (err) {
    return apiErrorResponse(err, 'TIGHTENING_PROPOSALS GET');
  }
}

/**
 * Validates the client-sent proposal snapshot for ratify/dismiss. The patch is
 * NOT trusted from the client — the server rebuilds the policy from the
 * validated (action_type, risk_level) pair, and the content-stable id doubles
 * as an integrity check: tp_(action_type, risk_level) must equal proposal_id.
 */
function validateSnapshot(
  proposalId: string,
  p: Record<string, unknown> | null | undefined,
): { error: string } | { actionType: string; riskLevel: 'high' | 'critical' } {
  if (!p || typeof p !== 'object') return { error: 'proposal snapshot is required' };
  if (p.rule !== TIGHTENING_RULE) {
    return { error: `proposal.rule must be ${TIGHTENING_RULE}` };
  }
  const actionType = p.action_type;
  if (typeof actionType !== 'string' || !actionType || actionType.length > MAX_ACTION_TYPE_LENGTH) {
    return { error: `proposal.action_type is required (1-${MAX_ACTION_TYPE_LENGTH} chars)` };
  }
  const riskLevel = p.risk_level;
  if (typeof riskLevel !== 'string' || !RISK_LEVELS.has(riskLevel)) {
    return { error: 'proposal.risk_level must be high|critical' };
  }
  if (tighteningProposalId(actionType, riskLevel) !== proposalId) {
    return { error: 'proposal_id does not match the snapshot (action_type, risk_level)' };
  }
  return { actionType, riskLevel: riskLevel as 'high' | 'critical' };
}

/**
 * POST /api/policies/tightening — record the human's judgment. Admin-only.
 * Body: { action: 'ratify'|'dismiss', proposal_id, proposal, reason? }
 *       { action: 'undo', proposal_id }   (deletes the judgment; audit-logged)
 *
 * Ratify creates the policy server-side in the same request (deliberate
 * deviation from tuning's client-fired PATCH: no partial state where the
 * policy exists but the judgment was never recorded, or vice versa) and
 * resolves the mirrored posture finding. Constitution §3 intact — the policy
 * exists only because a human clicked Ratify; nothing auto-applies.
 * Undo removes the judgment only: a policy created by a prior ratify stays
 * (it is a first-class policy now, managed at /policies).
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
      return NextResponse.json({ error: 'proposal_id must match tp_<16 hex>' }, { status: 400 });
    }

    const sql = getSql();

    if (action === 'undo') {
      const removed = await deleteTighteningDecision(sql, orgId, proposalId);
      if (!removed) {
        return NextResponse.json({ error: 'No decision recorded for this proposal' }, { status: 404 });
      }
      logActivity(
        {
          orgId,
          actorId: userId,
          action: 'tightening_proposal.undone',
          resourceType: 'tightening_proposal',
          resourceId: proposalId,
          // The undo does NOT delete a ratify-created policy; name it so the
          // audit trail says where the policy lives on.
          details: removed.policy_id ? { policy_id: removed.policy_id, policy_kept: true } : {},
          request,
        },
        sql,
      );
      return NextResponse.json({
        ok: true,
        proposal_id: proposalId,
        removed: true,
        policy_kept: removed.policy_id ?? null,
      });
    }

    const validated = validateSnapshot(proposalId, body?.proposal as Record<string, unknown> | undefined);
    if ('error' in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const { actionType, riskLevel } = validated;
    const findingKey = tighteningFindingKey(actionType, riskLevel);

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
      // same convention as the approvals + tuning + calibration routes.
      reason = redactAny(raw, []) as string;
    }

    let policy: Record<string, unknown> | null = null;
    if (action === 'ratify') {
      // The review-verdict "Tighten" shape — already validated/enforced/
      // rendered everywhere guard policies live.
      try {
        policy = await insertPolicy(sql, orgId, {
          id: gpId(),
          name: `[Tightened] ${actionType.slice(0, 200)}`,
          policyType: 'require_approval',
          rules: JSON.stringify({ action_types: [actionType], _tightened: true }),
          agentIds: null,
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === '23505' || e.message?.includes('guard_policies_org_name_unique')) {
          return NextResponse.json(
            { error: `A policy named "[Tightened] ${actionType.slice(0, 200)}" already exists — review it at /policies` },
            { status: 409 },
          );
        }
        throw err;
      }
      if (!policy) {
        return NextResponse.json({ error: 'Policy creation failed' }, { status: 500 });
      }
      void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy, change_type: 'created' });
      // Close the mirrored posture finding: the leak's remediation now exists.
      await setFindingState(
        sql,
        orgId,
        findingKey,
        'resolved',
        userId,
        `Tightening proposal ratified — policy ${String(policy.id)} created`,
      );
    }

    const row = await upsertTighteningDecision(sql, orgId, {
      proposalId,
      rule: TIGHTENING_RULE,
      decision: action === 'ratify' ? 'ratified' : 'dismissed',
      actionType,
      riskLevel,
      findingKey,
      snapshot: { rule: TIGHTENING_RULE, action_type: actionType, risk_level: riskLevel },
      policyId: policy ? String(policy.id) : null,
      reason,
      decidedBy: userId,
    });

    logActivity(
      {
        orgId,
        actorId: userId,
        action: `tightening_proposal.${action === 'ratify' ? 'ratified' : 'dismissed'}`,
        resourceType: 'tightening_proposal',
        resourceId: proposalId,
        details: {
          action_type: actionType,
          risk_level: riskLevel,
          ...(policy ? { policy_id: String(policy.id) } : {}),
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
    return apiErrorResponse(err, 'TIGHTENING_PROPOSALS POST');
  }
}
