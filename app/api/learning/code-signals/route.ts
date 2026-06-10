export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { aggregateCodeSignalsByKind } from '../../../lib/repositories/code-sessions.repository';

const VALID_PERIODS = new Set(['7d', '30d', '90d']);

function periodToDays(p: string): number {
  if (p === '7d') return 7;
  if (p === '90d') return 90;
  return 30;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const periodRaw = url.searchParams.get('period') || '30d';
  const period = VALID_PERIODS.has(periodRaw) ? periodRaw : '30d';
  const days = periodToDays(period);

  const sql = getSql();
  const orgId = getOrgId(request);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await aggregateCodeSignalsByKind(sql, orgId, since);

  return NextResponse.json({
    period,
    days,
    findings: rows.map((r: any) => ({
      kind: r.kind,
      occurrence_count: r.occurrence_count,
      session_count: r.session_count,
      total_savings_usd: Number(r.total_savings_usd) || 0,
    })),
  });
}
