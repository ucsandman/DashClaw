export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Plan attestation (docs/rfcs/2026-07-06-preflight-plan-authorization.md,
// "Attest before you act"; drizzle/0075). The run-start seam for unattended
// agents: a runner posts the plan hash it is about to act under and gets a
// yes/no before it spends its first model call. Agent-facing auth — the same
// org-scoped credential the GET poll on ../route.ts uses, NOT the admin +
// attributable-principal auth the operator verdict requires. Attesting is a
// read of one's own authority, not a grant of it.

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getUserId } from '../../../../lib/org';
import { logActivity } from '../../../../lib/audit';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { attestPlan } from '../../../../lib/repositories/plans.repository';

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));
    const expectedHash = typeof body?.plan_hash === 'string' ? body.plan_hash : '';
    if (!expectedHash) {
      return NextResponse.json({ error: 'plan_hash is required' }, { status: 400 });
    }

    const result = await attestPlan(sql, orgId, planId, expectedHash);

    // Journaled on both arms — a runner repeatedly attesting against a revoked
    // or drifted plan is exactly the signal an operator wants in the log. The
    // hash recorded is the one the CALLER presented; the stored hash never
    // leaves the server on a failure (see the response below).
    after(() => logActivity({
      orgId, actorId: getUserId(request) || 'agent', actorType: 'api_key',
      action: 'plan.attested', resourceType: 'plan', resourceId: planId,
      details: { plan_id: planId, plan_hash: expectedHash, result: result.ok ? 'ok' : result.reason },
      request,
    }, sql));

    if (!result.ok) {
      // Reason only. Echoing the stored hash on a mismatch would hand a caller
      // holding a stale/forged plan the exact digest it needs to forge a
      // matching attestation — the pin would authenticate nothing.
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.reason === 'not_found' ? 404 : 403 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'PLAN ATTEST POST');
  }
}
