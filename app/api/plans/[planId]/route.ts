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
import { getPlanWithSteps, reviewPlan } from '../../../lib/repositories/plans.repository';

const DEFAULT_TTL_CLAMP_MINUTES = 480;

export async function GET(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const result = await getPlanWithSteps(sql, orgId, planId);
    if (!result) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json(result);
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
    if (!['approve', 'deny', 'revoke'].includes(verdict)) {
      return NextResponse.json({ error: 'Invalid verdict. Must be approve, deny, or revoke.' }, { status: 400 });
    }

    const sql = getSql();
    const settings = await getSettings(sql, orgId, { category: 'general' });
    const ttlClampMinutes = parseInt(String(settings.find((s) => s.key === 'PLAN_GRANT_TTL_MAX_MINUTES')?.value ?? ''), 10) || DEFAULT_TTL_CLAMP_MINUTES;

    const result = await reviewPlan(sql, orgId, planId, {
      verdict, stepOverrides: stepOverrides ?? {}, reviewedBy: userId, ttlClampMinutes,
    });
    if (!result) {
      return NextResponse.json({ error: 'Plan not found or not reviewable in its current status' }, { status: 404 });
    }

    after(() => logActivity({
      orgId, actorId: userId, action: `plan.${verdict}d`,
      resourceType: 'plan', resourceId: planId,
      details: { verdict, step_overrides: stepOverrides ?? {} }, request,
    }, sql));
    void publishOrgEvent(EVENTS.ACTION_UPDATED, { orgId, plan: result.plan });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'PLAN REVIEW POST');
  }
}
