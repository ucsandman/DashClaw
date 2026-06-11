export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  getWarnDecisionsSince,
  getRecentInterrupts,
  groupWarnDecisions,
} from '../../../lib/repositories/policy-review.repository';
import { getSettings } from '../../../lib/repositories/settings.repository';

const DEFAULT_WINDOW_DAYS = 7;

/** GET /api/policies/review — warn groups since the review cursor + recent interrupts. */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    // Fetch cursor and dismissed settings with targeted queries (avoid loading secrets)
    const [cursorRows, dismissedRows] = await Promise.all([
      getSettings(sql, orgId, { key: 'policy_review_cursor' }),
      getSettings(sql, orgId, { key: 'policy_review_dismissed' }),
    ]);

    const cursorValue = cursorRows[0]?.value as string | null | undefined;
    const cursor =
      cursorValue ||
      new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();

    let dismissed: Record<string, string> = {};
    try {
      const rawDismissed = dismissedRows[0]?.value as string | null | undefined;
      dismissed = JSON.parse(rawDismissed || '{}') as Record<string, string>;
    } catch {
      // Corrupt setting — treat as none dismissed
    }

    const [warnRows, interrupts] = await Promise.all([
      getWarnDecisionsSince(sql, orgId, cursor),
      getRecentInterrupts(sql, orgId, 20),
    ]);

    return NextResponse.json({
      groups: groupWarnDecisions(warnRows, dismissed),
      interrupts,
      cursor,
    });
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_REVIEW GET');
  }
}
