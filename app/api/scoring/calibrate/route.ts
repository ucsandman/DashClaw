export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { autoCalibrate } from '../../../lib/scoringProfiles';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const result = await autoCalibrate(sql, orgId, {
      action_type: body.action_type || null,
      agent_id: body.agent_id || null,
      lookback_days: body.lookback_days || 30,
      metrics: body.metrics || undefined,
    });

    return Response.json(result);
  } catch (err) {
    console.error('[scoring/calibrate] POST error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}
