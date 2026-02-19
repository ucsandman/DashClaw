import { NextResponse } from 'next/server';
import { getAnalyticsSummary } from '../../../../lib/learningAnalytics.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const summary = await getAnalyticsSummary(request, {
      agent_id: searchParams.get('agent_id') || undefined,
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[learning/analytics/summary] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 });
  }
}
