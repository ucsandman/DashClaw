import { NextResponse } from 'next/server';
import { getFeedbackStats } from '../../../lib/feedback.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || undefined;
    const stats = await getFeedbackStats(request, { agent_id: agentId });
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[feedback/stats] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch feedback stats' }, { status: 500 });
  }
}
