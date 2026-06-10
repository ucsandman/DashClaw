export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { scoreAction, batchScoreActions, listProfileScores, getProfileScoreStats } from '../../../lib/scoringProfiles';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const profile_id = url.searchParams.get('profile_id');
    const agent_id = url.searchParams.get('agent_id');
    const action_id = url.searchParams.get('action_id');
    const view = url.searchParams.get('view'); // 'stats'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    if (view === 'stats' && profile_id) {
      const stats = await getProfileScoreStats(sql, orgId, profile_id);
      return Response.json(stats);
    }

    const scores = await listProfileScores(sql, orgId, {
      profile_id: profile_id ?? undefined,
      agent_id: agent_id ?? undefined,
      action_id: action_id ?? undefined,
      limit,
      offset,
    });
    return Response.json({ scores });
  } catch (err) {
    console.error('[scoring/score] GET error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.profile_id) {
      return Response.json({ error: 'profile_id is required' }, { status: 400 });
    }

    // Batch mode
    if (Array.isArray(body.actions)) {
      const result = await batchScoreActions(sql, orgId, body.profile_id, body.actions);
      return Response.json(result);
    }

    // Single action mode
    if (!body.action) {
      return Response.json({ error: 'action object or actions array is required' }, { status: 400 });
    }

    const result = await scoreAction(sql, orgId, body.profile_id, body.action);
    return Response.json(result);
  } catch (err) {
    console.error('[scoring/score] POST error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: (err as Error).message?.includes('not found') ? 404 : 500 });
  }
}
