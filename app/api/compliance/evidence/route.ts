export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getGuardDecisionEvidence, getActionRecordEvidence } from '../../../lib/repositories/compliance.repository';

interface EvidenceRow { decision?: string; count: number | string }

/**
 * GET /api/compliance/evidence?framework=soc2&window=30d — Pull live enforcement evidence
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || '30d';
    const windowDays = parseInt(window) || 30;

    const guardEvidence = await getGuardDecisionEvidence(sql, orgId, windowDays) as unknown as EvidenceRow[];
    const actionEvidence = await getActionRecordEvidence(sql, orgId, windowDays) as unknown as EvidenceRow[];

    // Aggregate evidence by decision type
    const blocked = guardEvidence.filter((e: EvidenceRow) => e.decision === 'block');
    const totalDecisions = guardEvidence.reduce((sum: number, e: EvidenceRow) => sum + Number(e.count), 0);
    const totalBlocked = blocked.reduce((sum: number, e: EvidenceRow) => sum + Number(e.count), 0);
    const approvals = guardEvidence.filter((e: EvidenceRow) => e.decision === 'require_approval' || e.decision === 'warn');
    const totalApprovals = approvals.reduce((sum: number, e: EvidenceRow) => sum + Number(e.count), 0);

    return NextResponse.json({
      window,
      window_days: windowDays,
      evidence: {
        guard_decisions_total: totalDecisions,
        guard_decisions_blocked: totalBlocked,
        approval_requests: totalApprovals,
        action_records_total: actionEvidence.reduce((sum: number, e: EvidenceRow) => sum + Number(e.count), 0),
        breakdown: guardEvidence,
        action_breakdown: actionEvidence,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[COMPLIANCE/EVIDENCE] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
