import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { autoCalibrate } from '../../../lib/scoringProfiles.js';

export async function POST(request) {
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
    console.error('[scoring/calibrate] POST error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
