export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import {
  listLearningEpisodes,
  listLearningRecommendations,
} from '../../../../lib/repositories/learningLoop.repository';
import { getLearningRecommendationMetrics } from '../../../../lib/learningLoop.service';

function parseBoundedIntSafe(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || undefined;
    const actionType = searchParams.get('action_type') || undefined;
    const lookbackDays = parseBoundedIntSafe(searchParams.get('lookback_days'), 1, 365, 30);
    const limit = parseBoundedIntSafe(searchParams.get('limit'), 1, 200, 100);
    const includeInactive = searchParams.get('include_inactive') === 'true' && (role === 'admin' || role === 'service');

    const recommendations = await listLearningRecommendations(sql, orgId, {
      agentId,
      actionType,
      includeInactive,
      limit,
    });
    const episodes = await listLearningEpisodes(sql, orgId, {
      agentId,
      actionType,
      lookbackDays,
      limit: 10000,
    });
    const metrics = await getLearningRecommendationMetrics(sql, orgId, {
      recommendations,
      episodes,
      agentId,
      actionType,
      lookbackDays,
    });

    return NextResponse.json({
      ...metrics,
      lookback_days: lookbackDays,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Learning recommendation metrics GET error:', error);
    if (String((error as { code?: string })?.code || '').includes('42P01') || String((error as Error)?.message || '').includes('does not exist')) {
      return NextResponse.json({
        metrics: [],
        summary: {},
        lookback_days: 30,
        schema_missing: true,
        lastUpdated: new Date().toISOString(),
      });
    }
    return NextResponse.json(
      { error: 'An error occurred while fetching learning recommendation metrics' },
      { status: 500 }
    );
  }
}
