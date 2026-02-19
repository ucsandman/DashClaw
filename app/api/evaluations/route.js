export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';
import { listEvalScores, createEvalScore } from '../../lib/repositories/evaluations.repository.js';

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

    const filters = {
      actionId: searchParams.get('action_id'),
      scorerName: searchParams.get('scorer_name'),
      evaluatedBy: searchParams.get('evaluated_by'),
      minScore: searchParams.get('min_score'),
      maxScore: searchParams.get('max_score'),
      agentId: searchParams.get('agent_id'),
      limit: parseInt(searchParams.get('limit') || '50', 10),
      offset: parseInt(searchParams.get('offset') || '0', 10),
    };

    const result = await listEvalScores(sql, orgId, filters);

    return NextResponse.json(result);
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

    const result = await createEvalScore(sql, orgId, {
      id,
      action_id,
      scorer_name,
      score,
      label,
      reasoning,
      evaluated_by,
      metadata,
      created_at: now,
    });

    return NextResponse.json({ ...result, label, created_at: now }, { status: 201 });
  } catch (error) {
    console.error('Evaluations POST error:', error);
    return NextResponse.json({ error: 'Failed to create evaluation score' }, { status: 500 });
  }
}
