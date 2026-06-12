export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { composeFleetDigest } from '../../../lib/fleet-digest';

/**
 * GET /api/digest/fleet — the operator fleet digest.
 * ?lite=1 returns only the fields the SessionStart hook needs.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const digest = await composeFleetDigest(getSql(), orgId);
    const lite = new URL(request.url).searchParams.get('lite') === '1';
    if (lite) {
      return NextResponse.json({
        pending_approvals: digest.pending_approvals,
        oldest_pending_minutes: digest.oldest_pending_minutes,
        floods: digest.floods,
      });
    }
    return NextResponse.json(digest);
  } catch (err) {
    return apiErrorResponse(err, 'DIGEST_FLEET GET');
  }
}
