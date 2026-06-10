export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { POLICY_MODE_CATALOG } from '../../../lib/policy-modes/catalog';
import { compileMode } from '../../../lib/policy-modes/compile';

/**
 * GET /api/policies/modes — list the built-in Policy Modes catalog.
 * Each entry includes its human-facing posture (allows/warns/requiresApproval/
 * blocks/toolVisibilityNotes) plus the count of guard policies it compiles to.
 * Read-only; open to org members (mirrors /api/policies/templates).
 */
export async function GET() {
  try {
    const modes = Object.values(POLICY_MODE_CATALOG).map((mode) => ({
      ...mode,
      policy_count: compileMode(mode.id).length,
    }));
    return NextResponse.json({ modes });
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_MODES GET');
  }
}
