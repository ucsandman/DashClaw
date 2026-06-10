export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { scoreAndStoreActionEpisode } from '../../../lib/learningLoop.service';
import {
  listOrganizations,
  listUnscoredActionIds,
} from '../../../lib/repositories/learningLoop.repository';
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
    const perOrgLimit = parseBoundedInt(searchParams.get('per_org_limit'), 100, 20000, 5000);

    const sql = getSql();
    const orgs = await listOrganizations(sql, { includeDefault: true });
    const summary = {
      orgs_processed: 0,
      actions_considered: 0,
      episodes_scored: 0,
    };

    for (const orgRow of orgs) {
      const org = orgRow as Record<string, any>;
      try {
        const candidates = await listUnscoredActionIds(sql, org.id, {
          lookbackDays,
          limit: perOrgLimit,
        });
        summary.actions_considered += candidates.length;

        for (const row of candidates) {
          const scored = await scoreAndStoreActionEpisode(sql, org.id, row.action_id as string | null | undefined);
          if (scored) summary.episodes_scored++;
        }
      } catch (orgError) {
        console.error(`[CRON] learning-episodes-backfill org ${org.id} failed:`, (orgError as Error).message);
      } finally {
        summary.orgs_processed++;
      }
    }

    return NextResponse.json({
      success: true,
      summary,
      options: { lookback_days: lookbackDays, per_org_limit: perOrgLimit },
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron learning-episodes-backfill error:', error);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
