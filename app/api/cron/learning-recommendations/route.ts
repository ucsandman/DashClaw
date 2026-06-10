export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { rebuildLearningRecommendations } from '../../../lib/learningLoop.service';
import { listOrganizations } from '../../../lib/repositories/learningLoop.repository';
import { timingSafeCompare } from '../../../lib/timing-safe';

function parseBoundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const lookbackDays = parseBoundedInt(searchParams.get('lookback_days'), 1, 365, 30);
    const minSamples = parseBoundedInt(searchParams.get('min_samples'), 2, 100, 5);
    const episodeLimit = parseBoundedInt(searchParams.get('episode_limit'), 100, 10000, 5000);

    const sql = getSql();
    const orgs = await listOrganizations(sql, { includeDefault: true });
    const summary = {
      orgs_processed: 0,
      episodes_scanned: 0,
      recommendations_generated: 0,
    };

    for (const org of orgs) {
      try {
        const rebuilt = await rebuildLearningRecommendations(sql, org.id as string, {
          lookbackDays,
          minSamples,
          episodeLimit,
        });
        summary.episodes_scanned += rebuilt.episodes_scanned;
        summary.recommendations_generated += rebuilt.recommendations.length;
      } catch (orgError) {
        console.error(`[CRON] learning-recommendations org ${org.id} failed:`, (orgError as Error).message);
      } finally {
        summary.orgs_processed++;
      }
    }

    return NextResponse.json({
      success: true,
      summary,
      options: {
        lookback_days: lookbackDays,
        min_samples: minSamples,
        episode_limit: episodeLimit,
      },
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron learning-recommendations error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
