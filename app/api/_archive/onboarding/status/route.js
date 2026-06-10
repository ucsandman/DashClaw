export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../../lib/db';
import { getOnboardingStatusForUserId } from '../../../../lib/onboardingState.mjs';

let _sql;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

// GET /api/onboarding/status — derive onboarding state from existing data
export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const sql = getSql();
    const status = await getOnboardingStatusForUserId(userId, { sql, env: process.env });

    return NextResponse.json(status);
  } catch (error) {
    console.error('Onboarding status error:', error);
    return NextResponse.json({ error: 'Failed to check onboarding status' }, { status: 500 });
  }
}
