import { NextResponse } from 'next/server';
import { executeScorer } from '../../../../lib/eval';

// Mirrors the create-scorer route's allowed set (app/api/evaluations/scorers/route.js).
const VALID_SCORER_TYPES = ['regex', 'contains', 'numeric_range', 'custom_function', 'llm_judge'];

/**
 * POST /api/evaluations/scorers/preview — Dry-run a scorer config against a
 * sample action WITHOUT persisting an eval_scores row.
 *
 * Pure and side-effect-free: it runs the exact same `executeScorer()` engine the
 * real evaluation runs use, so an operator (or the branch-finish loop) can
 * validate a scorer — e.g. a branch-finish quality gate — before creating it or
 * launching a run that writes scores. The code scorers
 * (regex/contains/numeric_range/custom_function) need no AI key; `llm_judge`
 * degrades to a structured error when no provider is configured.
 *
 * Body: { scorer_type, config?, sample? }
 *   sample = a partial action_records row; executeScorer reads
 *   { outcome, action_type, risk_score, declared_goal, status } plus any
 *   numeric field referenced by a numeric_range scorer's `config.field`.
 *
 * Response 200: { preview: true, scorer_type, result: { score, label, reasoning, error } }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { scorer_type, config, sample } = body || {};

    if (!scorer_type) {
      return NextResponse.json({ error: 'scorer_type is required' }, { status: 400 });
    }
    if (!VALID_SCORER_TYPES.includes(scorer_type)) {
      return NextResponse.json(
        { error: `scorer_type must be one of: ${VALID_SCORER_TYPES.join(', ')}` },
        { status: 400 }
      );
    }
    if (sample != null && (typeof sample !== 'object' || Array.isArray(sample))) {
      return NextResponse.json({ error: 'sample must be an object' }, { status: 400 });
    }

    // `await` is a no-op for the synchronous code scorers and resolves the
    // promise that llm_judge returns — one code path handles both.
    const result = await executeScorer({ scorer_type, config }, sample || {});

    return NextResponse.json({ preview: true, scorer_type, result });
  } catch (err) {
    console.error('[evaluations/scorers/preview] POST error:', err);
    return NextResponse.json({ error: 'Failed to preview scorer' }, { status: 500 });
  }
}
