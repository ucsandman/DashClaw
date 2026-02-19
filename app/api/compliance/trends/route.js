import { NextResponse } from 'next/server';
import { getComplianceTrends } from '../../../../lib/compliance/exporter.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const framework = searchParams.get('framework') || undefined;
    const limit = searchParams.get('limit') || undefined;
    const trends = await getComplianceTrends(request, { framework, limit });
    return NextResponse.json({ trends });
  } catch (err) {
    console.error('[compliance/trends] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch trends' }, { status: 500 });
  }
}
