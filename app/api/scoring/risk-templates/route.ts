export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { createRiskTemplate, listRiskTemplates } from '../../../lib/scoringProfiles';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const action_type = url.searchParams.get('action_type');

    // null↔undefined harmless: callee treats both as "no filter" (if (action_type)).
    const templates = await listRiskTemplates(sql, orgId, { action_type: action_type ?? undefined });
    return Response.json({ templates });
  } catch (err) {
    console.error('[scoring/risk-templates] GET error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    console.error('[scoring/risk-templates] POST error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}
