export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getCurrentPeriod } from '../../../lib/usage';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || getCurrentPeriod();

    // Reject malformed periods before they reach the date math / SQL. An
    // unvalidated `?period` (e.g. "garbage") produces NaN year/month and a
    // bogus timestamp literal that Postgres rejects with an opaque 500; a
    // YYYY-MM check turns that into a clear 400.
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return NextResponse.json(
        { error: 'Invalid period. Expected YYYY-MM (e.g. 2026-06).', code: 'INVALID_PERIOD' },
        { status: 400 },
      );
    }

    const periodStart = `${period}-01T00:00:00Z`;
    const [year, month] = period.split('-').map(Number) as [number, number];
    const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    const periodEnd = `${nextMonth}-01T00:00:00Z`;

    const breakdown = await sql`
      SELECT action_type, COUNT(*)::int AS count,
        COALESCE(SUM(cost_estimate), 0)::real AS cost_usd
      FROM action_records
      WHERE org_id = ${orgId}
        AND timestamp_start >= ${periodStart}
        AND timestamp_start < ${periodEnd}
        AND cost_estimate > 0
      GROUP BY action_type ORDER BY cost_usd DESC
    `;

    const daily = await sql`
      SELECT DATE(timestamp_start) AS date, COUNT(*)::int AS actions,
        COALESCE(SUM(cost_estimate), 0)::real AS cost_usd
      FROM action_records
      WHERE org_id = ${orgId}
        AND timestamp_start >= ${periodStart}
        AND timestamp_start < ${periodEnd}
      GROUP BY DATE(timestamp_start) ORDER BY date
    `;

    const totals = await sql`
      SELECT COUNT(*)::int AS total_actions,
        COALESCE(SUM(cost_estimate), 0)::real AS total_cost_usd
      FROM action_records
      WHERE org_id = ${orgId}
        AND timestamp_start >= ${periodStart}
        AND timestamp_start < ${periodEnd}
    `;

    const breakdownMap: Record<string, { count: number; cost_usd: number }> = {};
    for (const row of breakdown) {
      breakdownMap[row.action_type as string] = {
        count: row.count as number,
        cost_usd: Math.round(Number(row.cost_usd) * 1000) / 1000,
      };
    }

    return NextResponse.json({
      period,
      total_cost_usd: Math.round(Number(totals[0]?.total_cost_usd || 0) * 1000) / 1000,
      total_actions: totals[0]?.total_actions || 0,
      breakdown: breakdownMap,
      daily: daily.map((d) => ({
        date: d.date as string,
        actions: d.actions as number,
        cost_usd: Math.round(Number(d.cost_usd) * 1000) / 1000,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error, 'USAGE_COSTS');
  }
}
