import { getSql } from '../../../../../lib/db.js';
import { getOrgId } from '../../../../../lib/org.js';
import { addDimension } from '../../../../../lib/scoringProfiles.js';

export async function POST(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { profileId } = await params;
    const body = await request.json();

    if (!body.name || !body.data_source) {
      return Response.json({ error: 'name and data_source are required' }, { status: 400 });
    }

    const dimension = await addDimension(sql, orgId, profileId, body);
    return Response.json(dimension, { status: 201 });
  } catch (err) {
    console.error('[scoring/dimensions] POST error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
