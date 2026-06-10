export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getFleetSpend, getClaudeCodeSpend } from '../../../lib/repositories/finops.repository';

const ALLOWED_PERIODS = new Set(['7d', '30d', '90d']);
const ALLOWED_LENSES = new Set(['fleet', 'claude-code']);

/** GET /api/finops/spend — spend rollup. ?lens=fleet (default) or claude-code. */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const params = new URL(request.url).searchParams;
    const rawPeriod = params.get('period') || '30d';
    const period = (ALLOWED_PERIODS.has(rawPeriod) ? rawPeriod : '30d') as '7d' | '30d' | '90d';
    const rawLens = params.get('lens') || 'fleet';
    const lens = ALLOWED_LENSES.has(rawLens) ? rawLens : 'fleet';

    const data = lens === 'claude-code'
      ? await getClaudeCodeSpend(sql, orgId, { period })
      : await getFleetSpend(sql, orgId, { period });

    return NextResponse.json(data);
  } catch (err) {
    console.error('[FINOPS/SPEND] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
