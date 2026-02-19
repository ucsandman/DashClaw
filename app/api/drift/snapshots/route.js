import { NextResponse } from 'next/server';
import { getSnapshots } from '../../../lib/drift.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const snapshots = await getSnapshots(request, {
      agent_id: searchParams.get('agent_id') || undefined,
      metric: searchParams.get('metric') || undefined,
      limit: searchParams.get('limit'),
    });
    return NextResponse.json({ snapshots });
  } catch (err) {
    console.error('[drift/snapshots] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 });
  }
}
