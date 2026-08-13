export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// GET is the agent-facing poll for a submitted plan's review state. POST is
// the operator verdict (approve/deny/revoke), mirroring the auth pattern in
// app/api/approvals/[actionId]/route.ts (admin + attributable principal).

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { logActivity } from '../../../lib/audit';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { getSettings } from '../../../lib/repositories/settings.repository';
import { getPlanWithSteps, reviewPlan, amendPlanFromDeviation } from '../../../lib/repositories/plans.repository';
import { listDeviationsForPlan, resolveDeviation, DEVIATION_RESOLUTIONS } from '../../../lib/repositories/plan-deviations.repository';
import type { DeviationResolution } from '../../../lib/repositories/plan-deviations.repository';

const DEFAULT_TTL_CLAMP_MINUTES = 480;

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const result = await getPlanWithSteps(sql, orgId, planId);
    if (!result) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    // V7: created_by is a reviewer/creator principal — never leak it to an
    // agent-facing GET. reviewed_by stays (it's displayed as approver
    // attribution in the UI, which is intentional provenance).
    const { created_by: _createdBy, raw_status: _rawStatus, ...plan } = result.plan as Record<string, unknown>;
    // Deviations ride the existing payload (RFC 2026-08-11 §7: no new
    // routes). Best-effort: a deviations read failure must not break the
    // agent's plan poll.
    let deviations: unknown[] = [];
    try {
      deviations = await listDeviationsForPlan(sql, orgId, planId);
    } catch (err) {
      console.warn('[Plans] deviations read failed (continuing):', (err as Error).message);
    }
    return NextResponse.json({ plan, steps: result.steps, deviations });
  } catch (error) {
    return apiErrorResponse(error, 'PLAN GET');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const userId = getUserId(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required for plan review' }, { status: 403 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'Plan review requires an attributable principal', code: 'APPROVER_IDENTITY_REQUIRED' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { verdict, step_overrides: stepOverrides } = body;
    if (!['approve', 'deny', 'revoke', 'resolve_deviation'].includes(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict. Must be approve, deny, revoke, or resolve_deviation.' }, { status: 400 });
    }

    // resolve_deviation (RFC 2026-08-11 §7): the operator verdict on a
    // recorded deviation, folded into this route to reuse its admin +
    // attributable-principal auth instead of standing up a new write path.
    // Resolution and approval stay strictly separate verbs (RFC OQ5):
    // accepting a deviation NEVER releases a pending approval on the action.
    if (verdict === 'resolve_deviation') {
      const deviationId = typeof body.deviation_id === 'string' ? body.deviation_id : '';
      const resolution = typeof body.resolution === 'string' ? body.resolution : '';
      const amendPlan = body.amend_plan === true;
      if (!deviationId || !DEVIATION_RESOLUTIONS.includes(resolution as DeviationResolution)) {
        return NextResponse.json(
          { error: `resolve_deviation requires deviation_id and resolution (${DEVIATION_RESOLUTIONS.join('|')})` },
          { status: 400 },
        );
      }
      if (amendPlan && resolution !== 'accepted') {
        return NextResponse.json({ error: 'amend_plan is only valid with resolution "accepted"' }, { status: 400 });
      }
      const sql = getSql();
      // "Accept & amend" appends an APPROVED step — approval-shaped, so the
      // plan's separation-of-duties self-gate applies to it (mirror of the
      // approve gate below; plain resolutions are bookkeeping and are not
      // gated beyond admin + principal).
      if (amendPlan && userId !== 'operator') {
        const existing = await getPlanWithSteps(sql, orgId, planId);
        const createdBy = (existing?.plan as { created_by?: string | null } | undefined)?.created_by;
        if (createdBy && createdBy === userId) {
          return NextResponse.json(
            { error: 'The credential that submitted this plan cannot amend it via deviation acceptance. Use a different admin credential.', code: 'SELF_APPROVAL_FORBIDDEN' },
            { status: 403 },
          );
        }
        if (existing && !createdBy) {
          return NextResponse.json(
            { error: 'This plan has no attributable submitter, so only the operator credential can amend it.', code: 'PRINCIPAL_LESS_PLAN_REQUIRES_OPERATOR' },
            { status: 403 },
          );
        }
      }
      const resolved = await resolveDeviation(sql, orgId, deviationId, {
        resolution: resolution as DeviationResolution, resolvedBy: userId, planId,
      });
      if (!resolved) {
        return NextResponse.json({ error: 'Deviation not found on this plan, or already resolved' }, { status: 404 });
      }
      let amendedStep: Record<string, unknown> | null = null;
      if (amendPlan) {
        amendedStep = await amendPlanFromDeviation(sql, orgId, planId, resolved);
      }
      after(() => logActivity({
        orgId, actorId: userId, action: 'plan.deviation_resolved',
        resourceType: 'plan', resourceId: planId,
        details: { deviation_id: deviationId, resolution, amend_plan: amendPlan }, request,
      }, sql));
      return NextResponse.json({
        deviation: resolved,
        ...(amendedStep ? { amended_step: amendedStep } : {}),
      });
    }
    // Fail-closed on operator intent: an unrecognized step_overrides value
    // must not silently fall through to 'approve' in reviewPlan.
    if (stepOverrides && typeof stepOverrides === 'object') {
      for (const [stepId, value] of Object.entries(stepOverrides)) {
        if (value !== 'approve' && value !== 'deny') {
          return NextResponse.json(
            { error: `step_overrides.${stepId} must be "approve" or "deny"` }, { status: 400 },
          );
        }
      }
    }

    const sql = getSql();

    // SECURITY: separation of duties (drizzle/0063) — the credential that
    // submitted a plan may not approve it, mirroring the approvals gate
    // (app/api/approvals/[actionId]/route.ts:~108). 'operator' is exempt: in
    // single-admin self-host the root credential legitimately does both, and
    // if an agent holds root the gate was already forfeit.
    //
    // The pre-read runs for EVERY verdict (not just approve) because the gate
    // is asymmetric by plan status, not just by verdict: revoking a LIVE plan
    // (pending/previewing/approved/partially_approved) only closes doors, so
    // the submitter stays free to do that themselves. But revoking a DENIED
    // plan lifts an operator's explicit no — that's the same privilege as
    // approving, just reached via a different verdict, so it needs a
    // different principal (or the operator) too.
    //
    // X2: deny is now gated too. With org-wide denial binding
    // (findDeniedStepMatch matches the ACT for the whole org, not just the
    // submitting agent — see its own comment), a submitter denying its own
    // plan would plant an org-wide block with zero second-party involvement.
    // A denial, like an approval, needs a principal other than the submitter
    // (or the operator).
    const existing = await getPlanWithSteps(sql, orgId, planId);
    const createdBy = (existing?.plan as { created_by?: string | null } | undefined)?.created_by;
    // SoD gates key on RAW status: the derived presentation status reads a
    // lapsed denial as 'expired', which would silently disarm the
    // `=== 'denied'` clauses below (2026-07-29 security review, MEDIUM) —
    // leaving the write-time denyLiftAllowed predicate as the only layer.
    const existingStatus = (existing?.plan as { raw_status?: string } | undefined)?.raw_status;
    if (userId !== 'operator') {
      const selfGateTriggers = verdict === 'approve' || verdict === 'deny' || existingStatus === 'denied';
      if (createdBy && createdBy === userId && selfGateTriggers) {
        const isDenyLift = verdict !== 'approve';
        return NextResponse.json(
          {
            error: isDenyLift
              ? 'The credential that submitted this plan cannot lift its denial. Use a different admin credential, or lift it from the dashboard.'
              : 'The credential that submitted this plan cannot approve it. Approve from the dashboard, or use a different admin credential.',
            code: 'SELF_APPROVAL_FORBIDDEN',
          },
          { status: 403 },
        );
      }
      // X1(b): belt-and-braces — a principal-less legacy row (created_by
      // NULL) cannot prove separation of duties either way, so approving it
      // or lifting its denial fails closed to the break-glass 'operator'
      // principal rather than staying open to any admin. Plain deny is not
      // gated here (unlike the self-submitted case above): a NULL created_by
      // row has no submitter to protect against, so an unrelated admin deny
      // carries none of X2's self-deny risk. Gated on `existing` (the plan
      // actually being found) so a genuinely missing planId still falls
      // through to reviewPlan's 404 instead of this 403 masking it — an
      // absent row is not the same thing as a NULL created_by column.
      const nullPrincipalGateTriggers = existing && !createdBy && (verdict === 'approve' || existingStatus === 'denied');
      if (nullPrincipalGateTriggers) {
        const isDenyLift = verdict !== 'approve';
        return NextResponse.json(
          {
            error: isDenyLift
              ? 'This plan has no attributable submitter, so only the operator credential can lift its denial.'
              : 'This plan has no attributable submitter, so only the operator credential can approve it.',
            code: 'PRINCIPAL_LESS_PLAN_REQUIRES_OPERATOR',
          },
          { status: 403 },
        );
      }
    }

    const settings = await getSettings(sql, orgId, { category: 'general' });
    const configuredTtlClampMinutes = parseInt(String(settings.find((s) => s.key === 'PLAN_GRANT_TTL_MAX_MINUTES')?.value ?? ''), 10) || DEFAULT_TTL_CLAMP_MINUTES;
    // R2: same may-tighten-never-widen guarantee as PLAN_MAX_STEPS (S3 in
    // app/api/plans/route.ts) — a misconfigured/tampered org setting must not
    // raise the grant lifetime above the hard ceiling.
    const ttlClampMinutes = Math.min(configuredTtlClampMinutes, DEFAULT_TTL_CLAMP_MINUTES);

    // Deny-lift as a SQL precondition: the 403s above gate on a pre-read of
    // status, which races a denial landing before reviewPlan's UPDATE. This
    // principal may lift a denial only as the operator or as a principal
    // other than the (attributable) submitter — the same rule the 403s
    // enforce, now also held at write time inside the revoke UPDATE.
    const denyLiftAllowed = userId === 'operator' || (Boolean(createdBy) && createdBy !== userId);
    const result = await reviewPlan(sql, orgId, planId, {
      verdict, stepOverrides: stepOverrides ?? {}, reviewedBy: userId, ttlClampMinutes, denyLiftAllowed,
    });
    if (!result) {
      return NextResponse.json({ error: 'Plan not found or not reviewable in its current status' }, { status: 404 });
    }

    after(() => logActivity({
      orgId, actorId: userId, action: `plan.${verdict}d`,
      resourceType: 'plan', resourceId: planId,
      details: { verdict, step_overrides: stepOverrides ?? {} }, request,
    }, sql));

    // W3/X3: created_by is a reviewer/creator principal — never leak it to
    // the verdict response OR the org event payload (mirrors the GET's V7
    // strip above). Stripped before publishOrgEvent now too — previously
    // only the response was stripped, so the event still carried it.
    const { created_by: _createdBy, raw_status: _rawStatus, ...plan } = result.plan as Record<string, unknown>;
    void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, plan });

    return NextResponse.json({ ...result, plan });
  } catch (error) {
    return apiErrorResponse(error, 'PLAN REVIEW POST');
  }
}
