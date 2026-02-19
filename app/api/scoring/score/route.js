import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { scoreAction, batchScoreActions, listProfileScores, getProfileScoreStats } from '../../../lib/scoringProfiles.js';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const url = new URL(request.url);
    const profile_id = url.searchParams.get('profile_id');
    const agent_id = url.searchParams.get('agent_id');
    const action_id = url.searchParams.get('action_id');
    const view = url.searchParams.get('view'); // 'stats'
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (view === 'stats' && profile_id) {
      const stats = await getProfileScoreStats(sql, orgId, profile_id);
      return Response.json(stats);
    }

    const scores = await listProfileScores(sql, orgId, { profile_id, agent_id, action_id, limit, offset });
    return Response.json({ scores });
  } catch (err) {
    console.error('[scoring/score] GET error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
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
    console.error('[scoring/score] POST error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: err.message?.includes('not found') ? 404 : 500 });
  }
}
