export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { computeSignals } from '../../lib/signals';

let _sql: ReturnType<typeof getDbSql> | undefined;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const filterAgentId = searchParams.get('agent_id');

    const filteredSignals = await computeSignals(orgId, filterAgentId, sql);

    return NextResponse.json({
      signals: filteredSignals,
      counts: {
        red: filteredSignals.filter((s: { severity: string }) => s.severity === 'red').length,
        amber: filteredSignals.filter((s: { severity: string }) => s.severity === 'amber').length,
        total: filteredSignals.length
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Risk Signals API error:', error);
    return NextResponse.json(
      { error: 'An error occurred while computing risk signals', signals: [], counts: { red: 0, amber: 0, total: 0 } },
      { status: 500 }
    );
  }
}
