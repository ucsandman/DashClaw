export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../lib/db.js';
import { getOrgId, getOrgRole } from '../../lib/org.js';

function generateId(prefix) {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * GET /api/evaluations   List eval scores with filters
 * Query params: ?action_id, ?scorer_name, ?evaluated_by, ?min_score, ?max_score, ?limit, ?offset, ?agent_id
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const actionId = searchParams.get('action_id');
    const scorerName = searchParams.get('scorer_name');
    const evaluatedBy = searchParams.get('evaluated_by');
    const minScore = searchParams.get('min_score');
    const maxScore = searchParams.get('max_score');
    const agentId = searchParams.get('agent_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build dynamic query
    let conditions = [`es.org_id = '${orgId}'`];
    const values = [];

    if (actionId) conditions.push(`es.action_id = '${actionId}'`);
    if (scorerName) conditions.push(`es.scorer_name = '${scorerName}'`);
    if (evaluatedBy) conditions.push(`es.evaluated_by = '${evaluatedBy}'`);
    if (minScore) conditions.push(`es.score >= ${parseFloat(minScore)}`);
    if (maxScore) conditions.push(`es.score <= ${parseFloat(maxScore)}`);

    // If agent_id filter, join to action_records
    let joinClause = '';
    if (agentId) {
      joinClause = 'LEFT JOIN action_records ar ON es.action_id = ar.action_id';
      conditions.push(`ar.agent_id = '${agentId}'`);
    }

    const where = conditions.join(' AND ');
    const query = `
      SELECT es.* FROM eval_scores es ${joinClause}
      WHERE ${where}
      ORDER BY es.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `SELECT COUNT(*) as total FROM eval_scores es ${joinClause} WHERE ${where}`;

    const [scores, countResult] = await Promise.all([
      sql.query(query),
      sql.query(countQuery),
    ]);

    return NextResponse.json({
      scores: scores || [],
      total: parseInt(countResult?.[0]?.total || '0', 10),
    });
  } catch (error) {
    console.error('Evaluations GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch evaluation scores' }, { status: 500 });
  }
}

/**
 * POST /api/evaluations   Create a single evaluation score
 * Body: { action_id, scorer_name, score, label?, reasoning?, evaluated_by?, metadata? }
 */
export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { action_id, scorer_name, score, label, reasoning, evaluated_by, metadata } = body;

    if (!action_id || !scorer_name || score === undefined || score === null) {
      return NextResponse.json(
        { error: 'Missing required fields: action_id, scorer_name, score' },
        { status: 400 }
      );
    }

    if (typeof score !== 'number' || score < 0 || score > 1) {
      return NextResponse.json(
        { error: 'Score must be a number between 0.0 and 1.0' },
        { status: 400 }
      );
    }

    const id = generateId('ev_');
    const now = new Date().toISOString();

    await sql`
      INSERT INTO eval_scores (id, org_id, action_id, scorer_name, score, label, reasoning, evaluated_by, metadata, created_at)
      VALUES (${id}, ${orgId}, ${action_id}, ${scorer_name}, ${score}, ${label || null}, ${reasoning || null}, ${evaluated_by || 'human'}, ${metadata ? JSON.stringify(metadata) : null}, ${now})
    `;

    return NextResponse.json({ id, action_id, scorer_name, score, label, created_at: now }, { status: 201 });
  } catch (error) {
    console.error('Evaluations POST error:', error);
    return NextResponse.json({ error: 'Failed to create evaluation score' }, { status: 500 });
  }
}
