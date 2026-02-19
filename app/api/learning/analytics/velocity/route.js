import { NextResponse } from 'next/server';
import { computeVelocity, getVelocityData } from '../../../../lib/learningAnalytics.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const data = await getVelocityData(request, {
      agent_id: searchParams.get('agent_id') || undefined,
      limit: searchParams.get('limit'),
    });
    return NextResponse.json({ velocity: data });
  } catch (err) {
    console.error('[learning/analytics/velocity] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch velocity data' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await computeVelocity(request, {
      agent_id: body.agent_id,
      lookback_days: body.lookback_days,
      period: body.period,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[learning/analytics/velocity] POST error:', err);
    return NextResponse.json({ error: 'Failed to compute velocity' }, { status: 500 });
  }
}
