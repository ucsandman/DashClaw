export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { listGuardrailDecisions, getGuardDecisionStats } from '../../../lib/repositories/guardrails.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const decision = searchParams.get('decision') || undefined;
    const agentId = searchParams.get('agent_id') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const [result, stats] = await Promise.all([
      listGuardrailDecisions(sql, orgId, { decision, agentId, limit, offset }),
      getGuardDecisionStats(sql, orgId),
    ]);

    const parsed = (result.decisions || []).map((d: Record<string, unknown>) => {
      let matchedPolicies = [];
      try { matchedPolicies = JSON.parse((d.matched_policies as string) || '[]'); } catch { /* skip */ }
      let context: Record<string, unknown> = {};
      try { context = JSON.parse((d.context as string) || '{}'); } catch { /* skip */ }
      return {
        ...d,
        matched_policies: matchedPolicies,
        context: undefined,
        declared_goal: context.declared_goal || null,
        agent_name: context.agent_name || null,
      };
    });

    return NextResponse.json({
      decisions: parsed,
      total: result.total,
      stats,
    });
  } catch (error) {
    return apiErrorResponse(error, 'GUARD DECISIONS GET');
  }
}
