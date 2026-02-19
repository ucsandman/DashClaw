import { NextResponse } from 'next/server';
import { getMaturityLevels } from '../../../../lib/learningAnalytics.js';

export async function GET() {
  try {
    return NextResponse.json({ levels: getMaturityLevels() });
  } catch (err) {
    console.error('[learning/analytics/maturity] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch maturity levels' }, { status: 500 });
  }
}
