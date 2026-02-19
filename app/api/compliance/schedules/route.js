import { NextResponse } from 'next/server';
import { createSchedule, listSchedules } from '../../../lib/compliance/exporter.js';

export async function GET(request) {
  try {
    const schedules = await listSchedules(request);
    return NextResponse.json({ schedules });
  } catch (err) {
    console.error('[compliance/schedules] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.frameworks || body.frameworks.length === 0) {
      return NextResponse.json({ error: 'frameworks array is required' }, { status: 400 });
    }
    if (!body.cron_expression) {
      return NextResponse.json({ error: 'cron_expression is required' }, { status: 400 });
    }
    const schedule = await createSchedule(request, body);
    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    console.error('[compliance/schedules] POST error:', err);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
