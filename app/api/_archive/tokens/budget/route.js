export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { getTokenBudget, upsertTokenBudget } from '../../../../lib/repositories/tokens.repository';

const DEFAULT_BUDGET = { daily_limit: 18000, weekly_limit: 126000, monthly_limit: 540000 };

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || null;

    const budget = await getTokenBudget(sql, orgId, agentId);
    return NextResponse.json({ budget: budget || { ...DEFAULT_BUDGET, org_id: orgId, agent_id: agentId } });
  } catch (error) {
    console.error('Token budget GET error:', error);
    return NextResponse.json({ budget: DEFAULT_BUDGET });
  }
}

export async function PUT(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();
    const { agent_id, daily_limit, weekly_limit, monthly_limit } = body;

    if (!daily_limit || !weekly_limit || !monthly_limit) {
      return NextResponse.json({ error: 'daily_limit, weekly_limit, and monthly_limit are required' }, { status: 400 });
    }
    if (daily_limit < 0 || weekly_limit < 0 || monthly_limit < 0) {
      return NextResponse.json({ error: 'Limits must be non-negative' }, { status: 400 });
    }

    const budget = await upsertTokenBudget(sql, orgId, agent_id || null, {
      daily_limit: parseInt(daily_limit, 10),
      weekly_limit: parseInt(weekly_limit, 10),
      monthly_limit: parseInt(monthly_limit, 10),
    });

    return NextResponse.json({ budget });
  } catch (error) {
    console.error('Token budget PUT error:', error);
    return NextResponse.json({ error: 'Failed to update budget' }, { status: 500 });
  }
}
