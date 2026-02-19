import { NextResponse } from 'next/server';
import { getDriftStats } from '../../../lib/drift.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || undefined;
    const stats = await getDriftStats(request, { agent_id: agentId });
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[drift/stats] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch drift stats' }, { status: 500 });
  }
}
