export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { getAnalytics } from '../../lib/repositories/analytics.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    // parseInt('abc') is NaN, which survives Math.max/Math.min and reaches the
    // repository as `days=NaN` -> Date(NaN) -> 500. Fall back to the 30-day
    // default for any non-numeric value instead.
    const parsedDays = parseInt(searchParams.get('days') || '30', 10);
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : 30;

    const data = await getAnalytics(sql, orgId, days);
    return NextResponse.json(data);
  } catch (error) {
    return apiErrorResponse(error, 'ANALYTICS');
  }
}
