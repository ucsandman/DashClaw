export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../lib/org.js';
import { isLLMAvailable } from '../../../lib/llm.js';
import { listEvalScorers, createEvalScorer } from '../../../lib/repositories/evaluations.repository.js';

function generateId(prefix) {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

const VALID_SCORER_TYPES = ['regex', 'contains', 'numeric_range', 'custom_function', 'llm_judge'];

/**
 * GET /api/evaluations/scorers   List scorers for this org
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const scorers = await listEvalScorers(sql, orgId);

    return NextResponse.json({
      scorers,
      llm_available: isLLMAvailable(),
    });
  } catch (error) {
    console.error('Scorers GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch scorers' }, { status: 500 });
  }
}

/**
 * POST /api/evaluations/scorers   Create a scorer (admin only)
 * Body: { name, scorer_type, config, description? }
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
    const { name, scorer_type, config, description } = body;

    if (!name || !scorer_type) {
      return NextResponse.json({ error: 'name and scorer_type are required' }, { status: 400 });
    }

    if (!VALID_SCORER_TYPES.includes(scorer_type)) {
      return NextResponse.json(
        { error: `Invalid scorer_type. Must be one of: ${VALID_SCORER_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const id = generateId('es_');
    const now = new Date().toISOString();

    const response = await createEvalScorer(sql, orgId, {
      id,
      name,
      scorer_type,
      config,
      description,
      created_at: now,
    });

    if (scorer_type === 'llm_judge' && !isLLMAvailable()) {
      response.warning = 'AI provider not configured. This scorer won\'t execute until an AI API key is set (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY).';
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'A scorer with this name already exists' }, { status: 409 });
    }
    console.error('Scorers POST error:', error);
    return NextResponse.json({ error: 'Failed to create scorer' }, { status: 500 });
  }
}
