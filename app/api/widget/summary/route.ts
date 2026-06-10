export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { listActions, getCostAggregation } from '../../../lib/repositories/actions.repository';
import { listAgentsForOrg } from '../../../lib/repositories/agents.repository';
import { computeSignals } from '../../../lib/signals';
import { buildWidgetSummary } from '../../../lib/widget/summary';
import { apiErrorResponse } from '../../../lib/apiErrors';

/**
 * GET /api/widget/summary — one composed, safe, partial-failure-tolerant
 * payload for the desktop status widget. Composed entirely from existing
 * repositories/libs (no direct SQL — route-sql guardrail). Each source is
 * individually resilient: one failing source degrades to a safe default and
 * sets `degraded: true` rather than 500-ing the whole widget.
 */
export async function GET(request: Request) {
  // Defensive auth: middleware injects x-org-id for authenticated requests.
  // Unlike getOrgId() (which falls back to 'org_default'), the widget refuses
  // to serve a fallback org — no header means no authenticated context.
  const orgId = request.headers.get('x-org-id');
  if (!orgId) {
    return NextResponse.json({ error: 'Missing organization context' }, { status: 401 });
  }

  try {
    const sql = getSql();
    let degraded = false;
    const mark = () => {
      degraded = true;
    };

    const [recent, pending, signals, cost, agents] = await Promise.all([
      listActions(sql, orgId, { limit: 10 }).catch(() => {
        mark();
        return { actions: [], total: 0, stats: {} };
      }),
      listActions(sql, orgId, { status: 'pending_approval', limit: 8 }).catch(() => {
        mark();
        return { actions: [], total: 0, stats: {} };
      }),
      computeSignals(orgId, null, sql).catch(() => {
        mark();
        return [];
      }),
      getCostAggregation(sql, orgId, { period: '1d' }).catch(() => {
        mark();
        return null;
      }),
      listAgentsForOrg(sql, orgId).catch(() => {
        mark();
        return [];
      }),
    ]);

    const summary = buildWidgetSummary({
      recent,
      pendingApprovals: pending?.total ?? 0,
      pendingActions: pending?.actions ?? [],
      signals,
      spendUsd: cost ? Number(cost.total_cost_usd) : null,
      agents,
      now: Date.now(),
    });

    return NextResponse.json({ ...summary, degraded });
  } catch (error) {
    return apiErrorResponse(error, 'WIDGET_SUMMARY');
  }
}
