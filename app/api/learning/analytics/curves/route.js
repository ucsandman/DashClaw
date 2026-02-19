import { NextResponse } from 'next/server';
import { computeLearningCurves, getCurveData } from '../../../../lib/learningAnalytics.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const data = await getCurveData(request, {
      agent_id: searchParams.get('agent_id') || undefined,
      action_type: searchParams.get('action_type') || undefined,
      limit: searchParams.get('limit'),
    });
    return NextResponse.json({ curves: data });
  } catch (err) {
    console.error('[learning/analytics/curves] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch curve data' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await computeLearningCurves(request, {
      agent_id: body.agent_id,
      lookback_days: body.lookback_days,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[learning/analytics/curves] POST error:', err);
    return NextResponse.json({ error: 'Failed to compute curves' }, { status: 500 });
  }
}
