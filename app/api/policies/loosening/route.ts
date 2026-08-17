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
  PRECEDENT_RULE,
  BUDGET_RULE,
  deriveLooseningProposals,
  derivePrecedentProposals,
  deriveBudgetProposals,
  deriveOverBudgetShapes,
  looseningProposalId,
  precedentProposalId,
  budgetProposalId,
  policyEnvelope,
  LOOSENING_DEFAULTS,
  INTERRUPTION_BUDGET_DEFAULTS,
  type LooseningRule,
} from '../../../lib/posture/loosening';
import { normalizeFlags, precedentEligible, PRECEDENT_TTL_DAYS, commandShapeKey } from '../../../lib/policy-shapes';
import { getInterruptionBudget } from '../../../lib/guard/caches';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import {
  getInterruptOutcomesByPolicyAction,
  getInterruptVolumeByPolicy,
  getRecentInterruptGoals,
  getPrecedentOutcomes,
  createPrecedentGrant,
  getLooseningDecisions,
  upsertLooseningDecision,
  deleteLooseningDecision,
  getPolicyForLoosening,
  applyLooseningRelaxation,
  type LooseningDecisionRow,
} from '../../../lib/repositories/loosening.repository';
import { randomUUID } from 'crypto';

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

    const [rows, precedentRows, volumeRows, goalRows, budget, policies, decisions] = await Promise.all([
      getInterruptOutcomesByPolicyAction(sql, orgId, days, { includeSynthetic }),
      getPrecedentOutcomes(sql, orgId, days, { includeSynthetic }),
      // Interruption budget rides its OWN fixed window, not ?days: it answers
      // "is this rule unlivable right now", not "what did the last month show".
      getInterruptVolumeByPolicy(sql, orgId, INTERRUPTION_BUDGET_DEFAULTS.windowHours, { includeSynthetic }),
      getRecentInterruptGoals(sql, orgId, INTERRUPTION_BUDGET_DEFAULTS.windowHours, { includeSynthetic }),
      getInterruptionBudget(sql, orgId),
      getActivePolicies(sql, orgId),
      getLooseningDecisions(sql, orgId),
    ]);

    // A precedent already granted must stop being re-proposed: the evidence
    // that earned it does not disappear, so without this the same card would
    // reappear every page load until the grant expires.
    const grantedKeys = new Set(
      policies
        .filter((p) => p.policy_type === 'allow_grant')
        .map((p) => {
          try {
            const r = typeof p.rules === 'string' ? JSON.parse(p.rules) : p.rules;
            const flags = normalizeFlags(r?.precedent_flags);
            return flags && typeof r?.action_type === 'string'
              ? precedentProposalId(r.action_type, flags)
              : null;
          } catch {
            return null;
          }
        })
        .filter((k): k is string => k !== null),
    );

    // Budget proposals lead the list: an over-budget rule is a live defect
    // report, and it is the only rule here that fires without the operator
    // having adjudicated anything (see deriveBudgetProposals for why).
    const budgetProposals = deriveBudgetProposals(volumeRows, policies, {
      windowHours: INTERRUPTION_BUDGET_DEFAULTS.windowHours,
      budget,
    });
    // A policy already reported over budget must not ALSO be queued for
    // deactivation by the rate-based rule — same policy, same button, two cards.
    const budgetPolicyIds = new Set(budgetProposals.map((p) => p.policy_id));
    const derived = [
      ...budgetProposals,
      ...deriveLooseningProposals(rows, policies, { windowDays: days, minFired, minResolved }).filter(
        (p) => !budgetPolicyIds.has(p.policy_id),
      ),
      ...derivePrecedentProposals(precedentRows, { windowDays: days }).filter(
        (p) => !grantedKeys.has(p.id),
      ),
    ];
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
      interruption_budget: {
        per_window: budget,
        window_hours: INTERRUPTION_BUDGET_DEFAULTS.windowHours,
        // Shape-grain relief is automatic and self-expiring — there is no
        // ratify button, so it is reported rather than proposed. Reported with
        // the SAME function the guard enforces with (deriveOverBudgetShapes).
        shape_per_window: budget > 0 ? INTERRUPTION_BUDGET_DEFAULTS.shapePerWindow : 0,
        shapes_over_budget: budget > 0 ? deriveOverBudgetShapes(goalRows, commandShapeKey) : [],
      },
      inputs: { outcome_rows: rows.length, volume_rows: volumeRows.length, goal_rows: goalRows.length },
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
):
  | { error: string }
  | { rule: LooseningRule; policyId: string; actionType: string | null; flags?: string[] } {
  if (!p || typeof p !== 'object') return { error: 'proposal snapshot is required' };
  const rule = p.rule;

  // Precedent: no policy_id (it CREATES a grant), and the scope is the flag
  // set. Two independent checks stop a crafted body from minting authority:
  // the id must re-derive from (action_type, flags), and the pair must still
  // be eligible NOW — so a body replayed after the allowlist narrowed fails.
  if (rule === PRECEDENT_RULE) {
    const actionType = p.action_type;
    if (typeof actionType !== 'string' || !actionType || actionType.length > MAX_ACTION_TYPE_LENGTH) {
      return { error: `proposal.action_type is required (1-${MAX_ACTION_TYPE_LENGTH} chars)` };
    }
    const flags = normalizeFlags(p.precedent_flags);
    if (!flags) return { error: 'proposal.precedent_flags must be a non-empty string array' };
    if (precedentProposalId(actionType, flags) !== proposalId) {
      return { error: 'proposal_id does not match the snapshot (action_type, precedent_flags)' };
    }
    if (!precedentEligible(actionType, flags)) {
      return { error: 'this shape is not eligible to become a precedent' };
    }
    return { rule, policyId: '', actionType, flags };
  }

  // Interruption budget: the only ratify action is deactivation, and its id is
  // keyed on the policy alone. Ratifying is the operator agreeing the rule is
  // not worth keeping — the guard's own demotion is temporary and needs no
  // click, so this button exists for the permanent decision (and is the ONLY
  // route out for an `ungrantable` rule, which the guard never auto-demotes).
  if (rule === BUDGET_RULE) {
    const policyId = p.policy_id;
    if (typeof policyId !== 'string' || !policyId || policyId.length > MAX_POLICY_ID_LENGTH) {
      return { error: `proposal.policy_id is required (1-${MAX_POLICY_ID_LENGTH} chars)` };
    }
    if (budgetProposalId(policyId) !== proposalId) {
      return { error: 'proposal_id does not match the snapshot (policy_id)' };
    }
    return { rule, policyId, actionType: null };
  }

  if (rule !== RELAX_RULE && rule !== DEACTIVATE_RULE) {
    return { error: `proposal.rule must be ${RELAX_RULE}, ${DEACTIVATE_RULE}, ${PRECEDENT_RULE} or ${BUDGET_RULE}` };
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
    const precedentFlags = 'flags' in validated ? validated.flags : undefined;

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
    // Precedent ratify creates a NEW narrow grant rather than editing a policy,
    // so it does not go through the getPolicyForLoosening path below.
    if (action === 'ratify' && rule === PRECEDENT_RULE && actionType && precedentFlags) {
      const grantId = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await createPrecedentGrant(sql, orgId, {
        policyId: grantId,
        name: `[Precedent] ${actionType} — ${precedentFlags.join(', ')}`,
        actionType,
        flags: precedentFlags,
        ttlDays: PRECEDENT_TTL_DAYS,
      });
      await upsertLooseningDecision(sql, orgId, {
        proposalId,
        rule,
        decision: 'ratified',
        actionType,
        policyId: grantId,
        snapshot: { rule, action_type: actionType, precedent_flags: precedentFlags },
        reason: null,
        decidedBy: userId || null,
      });
      logActivity(
        {
          orgId,
          actorId: userId,
          action: 'loosening_proposal.ratified',
          resourceType: 'loosening_proposal',
          resourceId: proposalId,
          details: {
            rule,
            action_type: actionType,
            precedent_flags: precedentFlags,
            grant_id: grantId,
            expires_in_days: PRECEDENT_TTL_DAYS,
          },
          request,
        },
        sql,
      );
      void publishOrgEvent(EVENTS.POLICY_UPDATED, {
        orgId,
        policy: { id: grantId, policy_type: 'allow_grant' },
        change_type: 'created',
      });
      return NextResponse.json({
        ok: true,
        proposal_id: proposalId,
        action,
        rule,
        grant_id: grantId,
        expires_in_days: PRECEDENT_TTL_DAYS,
      });
    }

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
