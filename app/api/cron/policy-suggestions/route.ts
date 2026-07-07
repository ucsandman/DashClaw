export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { generatePolicySuggestions } from '../../../lib/policy-suggestions';
import { listOrganizations } from '../../../lib/repositories/orgs.repository';
import { timingSafeCompare } from '../../../lib/timing-safe';

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const orgs = await listOrganizations(sql, { includeDefault: true });
    const results = [];

    for (const org of orgs) {
      try {
        const suggestions = await generatePolicySuggestions(sql, org.id as string);
        results.push({ org_id: org.id, suggestion_count: suggestions.length });
      } catch (orgError) {
        console.error(`[CRON] policy-suggestions org ${org.id} failed:`, (orgError as Error).message);
        results.push({ org_id: org.id, suggestion_count: 0, error: (orgError as Error).message });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron policy-suggestions error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
