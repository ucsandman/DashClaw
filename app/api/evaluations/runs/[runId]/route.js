export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { getEvalRun, updateEvalRunStatus } from '../../../../lib/repositories/evaluations.repository.js';

/**
 * GET /api/evaluations/runs/[runId]   Run details with score stats
 */
export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { runId } = params;

    const result = await getEvalRun(sql, orgId, runId);

    if (!result) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Eval run detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch eval run' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { runId } = params;
    const body = await request.json();

    if (body.status) {
      await updateEvalRunStatus(sql, orgId, runId, body.status);
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Eval run PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update eval run' }, { status: 500 });
  }
}
