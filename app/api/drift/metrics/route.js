import { NextResponse } from 'next/server';
import { listMetrics } from '../../../lib/drift.js';

export async function GET() {
  try {
    return NextResponse.json({ metrics: listMetrics() });
  } catch (err) {
    console.error('[drift/metrics] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
