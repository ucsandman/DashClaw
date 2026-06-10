export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import {
  updateLearningRecommendationActive,
} from '../../../../lib/repositories/learningLoop.repository';

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ recommendationId: string }> }) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin' && role !== 'service') {
      return NextResponse.json({ error: 'Admin or service role required' }, { status: 403 });
    }

    const sql = getSql();
    const orgId = getOrgId(request);
    const { recommendationId } = await params;
    const body = await request.json().catch(() => ({}));

    const active = parseBoolean(body.active);
    if (active === null) {
      return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 });
    }

    const recommendation = await updateLearningRecommendationActive(sql, orgId, recommendationId, active);
    if (!recommendation) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    return NextResponse.json({ recommendation });
  } catch (error) {
    console.error('Learning recommendation PATCH error:', error);
    return NextResponse.json(
      { error: 'An error occurred while updating learning recommendation state' },
      { status: 500 }
    );
  }
}
