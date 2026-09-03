export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getActionStats, getConfidenceCalibration } from '../../../lib/repositories/actions.repository';
import { buildConfidenceCalibration } from '../../../lib/confidence-calibration';

/** Rolling window the calibration block is computed over. */
const CALIBRATION_WINDOW_DAYS = 30;

/**
 * GET /api/actions/stats
 *
 * Returns decision throughput statistics for the last 24 hours, plus a
 * `confidence` block scoring each agent's stated confidence against what
 * actually completed over the last 30 days.
 *
 * The calibration rides this endpoint rather than getting its own route: the
 * surface budget (contracts/surface-budget.json) is a ceiling, and the caller
 * that wants the numbers — the /decisions instrument strip — already fetches
 * this one. It is wrapped in its own try/catch and degrades to `confidence:
 * null` so a calibration failure can never take the throughput stats down with
 * it.
 *
 * DashClaw adheres to a strict governance boundary; metrics related to
 * agent actions live within the actions namespace.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const agentId = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('agent_id') || null;

    const { current, previousTotal } = await getActionStats(sql, orgId, agentId);
    const previousTotalNum = Number(previousTotal);
    const currentTotalNum = Number((current as Record<string, unknown>).total);

    // Calculate change percent
    let change_percent = 0;
    if (previousTotalNum > 0) {
      change_percent = Math.round(((currentTotalNum - previousTotalNum) / previousTotalNum) * 100);
    } else if (currentTotalNum > 0) {
      change_percent = 100;
    }

    let confidence = null;
    try {
      const { buckets, coverage } = await getConfidenceCalibration(sql, orgId, agentId, CALIBRATION_WINDOW_DAYS);
      confidence = buildConfidenceCalibration(buckets, coverage, CALIBRATION_WINDOW_DAYS);
    } catch (error) {
      console.error('Actions Stats API confidence calibration error:', error);
    }

    return NextResponse.json({
      ...current,
      change_percent,
      confidence,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Actions Stats API GET error:', error);
    return NextResponse.json(
      {
        error: 'An error occurred while fetching action statistics',
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        approval: 0,
        change_percent: 0,
        confidence: null
      },
      { status: 500 }
    );
  }
}
