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
    const actionType = searchParams.get('action_type') || undefined;
    const rawSince = searchParams.get('since') || undefined;
    // An unparseable `since` is a 400, never a silent full-history response —
    // the MCP retrospection tool advertises this filter and trusts the bound.
    let since: string | undefined;
    if (rawSince) {
      const parsed = new Date(rawSince);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid since — must be an ISO-8601 timestamp' },
          { status: 400 }
        );
      }
      since = parsed.toISOString();
    }
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const [result, stats] = await Promise.all([
      listGuardrailDecisions(sql, orgId, { decision, agentId, actionType, since, limit, offset }),
      getGuardDecisionStats(sql, orgId),
    ]);

    const parsed = (result.decisions || []).map((d: Record<string, unknown>) => {
      let matchedPolicies = [];
      try { matchedPolicies = JSON.parse((d.matched_policies as string) || '[]'); } catch { /* best-effort: malformed stored JSON — empty list applies */ }
      let context: Record<string, unknown> = {};
      try { context = JSON.parse((d.context as string) || '{}'); } catch { /* best-effort: malformed stored JSON — empty context applies */ }
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
