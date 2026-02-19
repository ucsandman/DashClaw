export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';

/**
 * GET /api/evaluations/runs/[runId]   Run details with score stats
 */
export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { runId } = params;

    const [run] = await sql`
      SELECT er.*, es.name as scorer_name, es.scorer_type
      FROM eval_runs er
      LEFT JOIN eval_scorers es ON er.scorer_id = es.id
      WHERE er.id = ${runId} AND er.org_id = ${orgId}
    `;

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Get score distribution for this run
    const distribution = await sql`
      SELECT
        CASE
          WHEN score >= 0.8 THEN 'excellent'
          WHEN score >= 0.5 THEN 'acceptable'
          ELSE 'poor'
        END as bucket,
        COUNT(*) as count,
        AVG(score) as avg_score
      FROM eval_scores
      WHERE scorer_id = ${run.scorer_id}
        AND org_id = ${orgId}
        AND created_at >= ${run.started_at || run.created_at}
      GROUP BY bucket
    `;

    return NextResponse.json({ run, distribution });
  } catch (error) {
    console.error('Eval run detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch eval run' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { runId } = params;
    const body = await request.json();

    if (body.status) {
      await sql`
        UPDATE eval_runs SET status = ${body.status}, completed_at = ${new Date().toISOString()}
        WHERE id = ${runId} AND org_id = ${orgId}
      `;
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Eval run PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update eval run' }, { status: 500 });
  }
}
