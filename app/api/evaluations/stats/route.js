export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';

/**
 * GET /api/evaluations/stats   Aggregate evaluation statistics
 * Query: ?agent_id, ?scorer_name, ?days (default 30)
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const agentId = searchParams.get('agent_id');
    const scorerName = searchParams.get('scorer_name');
    const days = parseInt(searchParams.get('days') || '30', 10);

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Avg score by scorer
    const byScorer = await sql`
      SELECT scorer_name, AVG(score) as avg_score, COUNT(*) as total_scores
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY scorer_name
      ORDER BY avg_score DESC
    `;

    // Score trends (daily buckets)
    const trends = await sql`
      SELECT
        LEFT(created_at, 10) as date,
        AVG(score) as avg_score,
        COUNT(*) as count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY LEFT(created_at, 10)
      ORDER BY date ASC
    `;

    // Distribution
    const distribution = await sql`
      SELECT
        CASE
          WHEN score >= 0.8 THEN 'excellent'
          WHEN score >= 0.5 THEN 'acceptable'
          ELSE 'poor'
        END as bucket,
        COUNT(*) as count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY bucket
    `;

    // Overall
    const [overall] = await sql`
      SELECT
        COUNT(*) as total_scores,
        AVG(score) as avg_score,
        COUNT(DISTINCT scorer_name) as unique_scorers,
        COUNT(CASE WHEN LEFT(created_at, 10) = LEFT(${new Date().toISOString()}, 10) THEN 1 END) as today_count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
    `;

    return NextResponse.json({
      overall: overall || {},
      by_scorer: byScorer,
      trends,
      distribution,
    });
  } catch (error) {
    console.error('Eval stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch eval stats' }, { status: 500 });
  }
}
