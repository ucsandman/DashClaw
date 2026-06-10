export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { getPlanLimits, getUsage } from '../../lib/usage';
import { isSelfHostModeEnabled } from '../../lib/selfHost';

// GET /api/usage - Returns limits and usage info
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);

    const sql = getSql();

    let rows: Record<string, unknown>[];
    try {
      rows = await sql`
        SELECT plan, stripe_customer_id, stripe_subscription_id,
               subscription_status, current_period_end, trial_ends_at
        FROM organizations WHERE id = ${orgId} LIMIT 1
      `;
    } catch (dbErr) {
      // 42P01 = table not found — fresh self-host install before migration has run.
      if ((dbErr as { code?: string }).code === '42P01' && isSelfHostModeEnabled()) {
        rows = [];
      } else {
        throw dbErr;
      }
    }

    if (rows.length === 0) {
      // Self-host bypass: return sensible defaults when org doesn't exist yet.
      if (isSelfHostModeEnabled()) {
        const limits = getPlanLimits('free');
        return NextResponse.json({ plan: 'free', limits, usage: {}, subscription: { status: 'active', current_period_end: null, trial_ends_at: null, has_stripe: false }, stripe_configured: false });
      }
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const org = rows[0] as Record<string, unknown>;
    const plan = (org.plan as string | null | undefined) || 'free';
    const limits = getPlanLimits(plan);
    const usage = await getUsage(orgId, sql);

    return NextResponse.json({
      plan,
      limits,
      usage,
      subscription: {
        status: org.subscription_status || 'active',
        current_period_end: org.current_period_end || null,
        trial_ends_at: org.trial_ends_at || null,
        has_stripe: !!org.stripe_customer_id,
      },
      stripe_configured: !!process.env.STRIPE_SECRET_KEY,
    });
  } catch (error) {
    console.error('Usage API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage info' }, { status: 500 });
  }
}
