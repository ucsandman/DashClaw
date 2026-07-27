export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Containment Verdicts (RFC 2026-07-06, drizzle/0064) — operator resolve
// route. Auth pattern mirrors app/api/approvals/[actionId]/route.ts (admin +
// attributable principal + separation-of-duties) applied to the
// contained -> awaiting_promotion -> promoted|discarded lifecycle.

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getActionStatus,
  resolveContainment,
  createActionRecord,
  stampPromotionApproval,
} from '../../../../lib/repositories/actions.repository';
import { buildPromotionGoal, buildPromotionAct } from '../../../../lib/guard/containment';

/**
 * POST /api/actions/[actionId]/containment
 * Operator verdict on a contained action awaiting promotion.
 *
 * Body: { verdict: 'promote' | 'discard' }
 *
 * promote: flips containment_status -> promoted, then raises a synthetic
 * `containment_promote` grant row (born 'running', pre-approved by this
 * verdict) whose act is the canonical `git merge --no-ff <containment_ref>` —
 * the same act shape the agent's retry must present for the act-content-hash
 * grant match to bind it (see docs/rfcs/2026-07-06-containment-verdicts.md).
 * discard: flips containment_status -> discarded. No grant row is created.
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for containment resolution' }, { status: 403 });
    }

    // SECURITY: same attributable-principal requirement as the approvals
    // route — an empty userId would let the promotion grant be stamped to
    // nobody.
    if (!userId) {
      return NextResponse.json(
        { error: 'Containment resolution requires an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { verdict } = body;
    if (!['promote', 'discard'].includes(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict. Must be promote or discard.' }, { status: 400 });
    }

    const sql = getSql();

    const action = await getActionStatus(sql, orgId, actionId);
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    if (action.containment_status !== 'awaiting_promotion') {
      return NextResponse.json({ error: 'CONTAINMENT_NOT_AWAITING' }, { status: 409 });
    }

    // SECURITY: separation of duties (drizzle/0055 precedent) — the
    // credential that created the contained action may not resolve its own
    // verdict. 'operator' is exempt (single-admin self-host root
    // credential); NULL created_by (legacy/system rows) is unenforceable and
    // stays resolvable.
    if (userId !== 'operator' && action.created_by && action.created_by === userId) {
      return NextResponse.json(
        {
          error: 'The credential that created this action cannot resolve its containment verdict. Resolve from the dashboard, or use a different admin credential.',
          code: 'SELF_APPROVAL_FORBIDDEN',
        },
        { status: 403 }
      );
    }

    // SECURITY/CORRECTNESS: promote mints a pre-approved grant row whose act
    // is built from containment_ref — a ref-less awaiting_promotion row (the
    // stop/PATCH-side flip does not require a ref) must not reach
    // resolveContainment for promote, or the row is left 'promoted' with no
    // valid grant ever created (String(null) would silently persist the
    // literal act `git merge --no-ff null`, hashed and running). Checked
    // BEFORE any mutation — same unpromotable-state class as
    // CONTAINMENT_NOT_AWAITING; discard has no such requirement.
    const containmentRef = action.containment_ref;
    if (verdict === 'promote' && (typeof containmentRef !== 'string' || containmentRef.length === 0)) {
      return NextResponse.json({ error: 'CONTAINMENT_REF_MISSING' }, { status: 409 });
    }

    const updated = await resolveContainment(sql, orgId, actionId, { verdict, resolvedBy: userId });
    // Zero-row return — another operator resolved it between our read above
    // and this UPDATE (same race shape as approvals' recordApproval).
    if (!updated) {
      return NextResponse.json({ error: 'CONTAINMENT_NOT_AWAITING' }, { status: 409 });
    }

    if (verdict === 'discard') {
      return NextResponse.json({ action: updated });
    }

    // Promote: raise the synthetic grant row — same insert shape as
    // POST /api/actions / guard's ?record=true, via the shared repository
    // function. Born 'running' (never pending_approval): the operator's
    // promote verdict IS the approval, stamped explicitly below because
    // createActionRecord's insert path never accepts approved fields.
    const promotionActionId = `act_${crypto.randomUUID()}`;
    await createActionRecord(sql, {
      orgId,
      action_id: promotionActionId,
      data: {
        agent_id: action.agent_id as string | null | undefined,
        action_type: 'containment_promote',
        declared_goal: buildPromotionGoal(actionId),
        act: buildPromotionAct(containmentRef as string),
        risk_score: 20,
        reversible: true,
        reasoning: `Operator promoted contained action ${actionId}`,
      },
      actionStatus: 'running',
      signature: null,
      verified: false,
      timestamp_start: new Date().toISOString(),
      createdBy: userId,
    });

    await stampPromotionApproval(sql, orgId, promotionActionId, userId);

    return NextResponse.json({ action: updated, promotion_action_id: promotionActionId });
  } catch (error) {
    return apiErrorResponse(error, 'CONTAINMENT POST');
  }
}
