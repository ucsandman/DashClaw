export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../lib/org.js';
import { executeEvalRun } from '../../../lib/eval.js';
import { isLLMAvailable } from '../../../lib/llm.js';
import { listEvalRuns, createEvalRun, getEvalScorer } from '../../../lib/repositories/evaluations.repository.js';

function generateId(prefix) {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * GET /api/evaluations/runs   List eval runs
 * Query: ?status, ?limit, ?offset
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const runs = await listEvalRuns(sql, orgId, { status, limit, offset });

    return NextResponse.json({ runs });
  } catch (error) {
    console.error('Eval runs GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch eval runs' }, { status: 500 });
  }
}

/**
 * POST /api/evaluations/runs   Create and immediately execute an eval run
 * Body: { name, scorer_id, action_filters?: { agent_id?, action_type?, date_from?, date_to? } }
 */
export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin' && role !== 'owner') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, scorer_id, action_filters } = body;

    if (!name || !scorer_id) {
      return NextResponse.json({ error: 'name and scorer_id are required' }, { status: 400 });
    }

    // Verify scorer exists and check if it's llm_judge
    const scorer = await getEvalScorer(sql, orgId, scorer_id);

    if (!scorer) {
      return NextResponse.json({ error: 'Scorer not found' }, { status: 404 });
    }

    if (scorer.scorer_type === 'llm_judge' && !isLLMAvailable()) {
      return NextResponse.json({
        error: 'Cannot run LLM-as-judge scorer: AI provider not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY.',
      }, { status: 400 });
    }

    const id = generateId('er_');
    const now = new Date().toISOString();

    await createEvalRun(sql, orgId, {
      id,
      name,
      scorer_id,
      status: 'pending',
      filter_criteria: action_filters,
      created_by: role,
      created_at: now,
    });

    // Execute async (don't await - it run in background)
    executeEvalRun(sql, orgId, id).catch((err) => {
      console.error(`Eval run ${id} failed:`, err);
    });

    return NextResponse.json({ id, name, status: 'pending', created_at: now }, { status: 201 });
  } catch (error) {
    console.error('Eval runs POST error:', error);
    return NextResponse.json({ error: 'Failed to create eval run' }, { status: 500 });
  }
}
