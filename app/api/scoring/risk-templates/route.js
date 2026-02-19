import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { createRiskTemplate, listRiskTemplates } from '../../../lib/scoringProfiles.js';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const action_type = url.searchParams.get('action_type');

    const templates = await listRiskTemplates(sql, orgId, { action_type });
    return Response.json({ templates });
  } catch (err) {
    console.error('[scoring/risk-templates] GET error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const template = await createRiskTemplate(sql, orgId, body);
    return Response.json(template, { status: 201 });
  } catch (err) {
    console.error('[scoring/risk-templates] POST error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
