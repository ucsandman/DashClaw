export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { listSchedules, createSchedule } from '../../../lib/repositories/agentSchedules.repository';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || null;

    const schedules = await listSchedules(sql, orgId, agentId);

    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('Agent Schedules GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching schedules', schedules: [] }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, {
      name: 500, description: 2000, cron_expression: 200, agent_id: 128
    });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { agent_id, name, cron_expression } = body;
    if (!agent_id || !name || !cron_expression) {
      return NextResponse.json({ error: 'agent_id, name, and cron_expression are required' }, { status: 400 });
    }

    const schedule = await createSchedule(sql, orgId, body);

    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    console.error('Agent Schedules POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating the schedule' }, { status: 500 });
  }
}
