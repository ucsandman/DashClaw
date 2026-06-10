export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getUserId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { randomUUID } from 'node:crypto';

const VALID_TYPES = ['observation', 'preference', 'mood', 'approach'];

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const userId = getUserId(request);
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'summary';
    const agentId = searchParams.get('agent_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    if (type === 'summary') {
      // Aggregate summary across all preference types
      const [observations, preferences, moods, approaches] = await Promise.all([
        agentId
          ? sql`SELECT COUNT(*)::int as count FROM user_observations WHERE org_id = ${orgId} AND agent_id = ${agentId}`
          : sql`SELECT COUNT(*)::int as count FROM user_observations WHERE org_id = ${orgId}`,
        agentId
          ? sql`SELECT * FROM user_preferences WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY confidence DESC LIMIT 20`
          : sql`SELECT * FROM user_preferences WHERE org_id = ${orgId} ORDER BY confidence DESC LIMIT 20`,
        agentId
          ? sql`SELECT * FROM user_moods WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT 5`
          : sql`SELECT * FROM user_moods WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 5`,
        agentId
          ? sql`SELECT * FROM user_approaches WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY success_count DESC LIMIT 10`
          : sql`SELECT * FROM user_approaches WHERE org_id = ${orgId} ORDER BY success_count DESC LIMIT 10`,
      ]);

      return NextResponse.json({
        summary: {
          observations_count: observations[0]?.count || 0,
          preferences: preferences,
          recent_moods: moods,
          top_approaches: approaches,
        }
      });
    }

    if (type === 'observations') {
      const rows = agentId
        ? await sql`SELECT * FROM user_observations WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM user_observations WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${limit}`;
      return NextResponse.json({ observations: rows, total: rows.length });
    }

    if (type === 'preferences') {
      const rows = agentId
        ? await sql`SELECT * FROM user_preferences WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY confidence DESC LIMIT ${limit}`
        : await sql`SELECT * FROM user_preferences WHERE org_id = ${orgId} ORDER BY confidence DESC LIMIT ${limit}`;
      return NextResponse.json({ preferences: rows, total: rows.length });
    }

    if (type === 'moods') {
      const rows = agentId
        ? await sql`SELECT * FROM user_moods WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM user_moods WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${limit}`;
      return NextResponse.json({ moods: rows, total: rows.length });
    }

    if (type === 'approaches') {
      const rows = agentId
        ? await sql`SELECT * FROM user_approaches WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY success_count DESC LIMIT ${limit}`
        : await sql`SELECT * FROM user_approaches WHERE org_id = ${orgId} ORDER BY success_count DESC LIMIT ${limit}`;
      return NextResponse.json({ approaches: rows, total: rows.length });
    }

    return NextResponse.json({ error: `Invalid type: ${type}. Use: summary, observations, preferences, moods, approaches` }, { status: 400 });
  } catch (error) {
    console.error('Preferences GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching preferences' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const userId = getUserId(request);
    const body = await request.json();
    const { type } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { observation: 2000, preference: 2000, mood: 200, approach: 2000, category: 200, context: 2000, notes: 2000, energy: 100 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (type === 'observation') {
      const { observation, category, importance, agent_id } = body;
      if (!observation) return NextResponse.json({ error: 'observation is required' }, { status: 400 });

      const id = `uo_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const result = await sql`
        INSERT INTO user_observations (id, org_id, user_id, agent_id, observation, category, importance, created_at)
        VALUES (${id}, ${orgId}, ${userId || null}, ${agent_id || null}, ${observation}, ${category || null}, ${importance || 5}, ${now})
        RETURNING *
      `;
      return NextResponse.json({ observation: result[0], observation_id: id }, { status: 201 });
    }

    if (type === 'preference') {
      const { preference, category, confidence, agent_id } = body;
      if (!preference) return NextResponse.json({ error: 'preference is required' }, { status: 400 });

      const id = `up_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const result = await sql`
        INSERT INTO user_preferences (id, org_id, user_id, agent_id, preference, category, confidence, created_at)
        VALUES (${id}, ${orgId}, ${userId || null}, ${agent_id || null}, ${preference}, ${category || null}, ${confidence || 50}, ${now})
        RETURNING *
      `;
      return NextResponse.json({ preference: result[0], preference_id: id }, { status: 201 });
    }

    if (type === 'mood') {
      const { mood, energy, notes, agent_id } = body;
      if (!mood) return NextResponse.json({ error: 'mood is required' }, { status: 400 });

      const id = `um_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const result = await sql`
        INSERT INTO user_moods (id, org_id, user_id, agent_id, mood, energy, notes, created_at)
        VALUES (${id}, ${orgId}, ${userId || null}, ${agent_id || null}, ${mood}, ${energy || null}, ${notes || null}, ${now})
        RETURNING *
      `;
      return NextResponse.json({ mood: result[0], mood_id: id }, { status: 201 });
    }

    if (type === 'approach') {
      const { approach, context, success, agent_id } = body;
      if (!approach) return NextResponse.json({ error: 'approach is required' }, { status: 400 });

      const id = `ua_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const successInc = success === true ? 1 : 0;
      const failInc = success === false ? 1 : 0;

      const result = await sql`
        INSERT INTO user_approaches (id, org_id, user_id, agent_id, approach, context, success_count, fail_count, created_at, updated_at)
        VALUES (${id}, ${orgId}, ${userId || null}, ${agent_id || null}, ${approach}, ${context || null}, ${successInc}, ${failInc}, ${now}, ${now})
        ON CONFLICT (org_id, COALESCE(agent_id, ''), approach)
        DO UPDATE SET
          success_count = user_approaches.success_count + ${successInc},
          fail_count = user_approaches.fail_count + ${failInc},
          context = COALESCE(EXCLUDED.context, user_approaches.context),
          updated_at = ${now}
        RETURNING *
      `;
      return NextResponse.json({ approach: result[0], approach_id: result[0].id }, { status: 201 });
    }
  } catch (error) {
    console.error('Preferences POST error:', error);
    return NextResponse.json({ error: 'An error occurred while saving preference data' }, { status: 500 });
  }
}
