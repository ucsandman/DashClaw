export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { buildActionGraph } from '../../../../lib/repositories/actions.repository';

/**
 * GET /api/actions/:actionId/graph
 *
 * Returns a read-only execution graph (nodes + edges) for an action, reusing
 * existing trace data plus correlated assumptions and open loops. Consumed by
 * the Execution Graph tab on the decision replay page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    const graph = await buildActionGraph(sql, orgId, actionId);
    if (!graph) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json(graph);
  } catch (error) {
    return apiErrorResponse(error, 'ACTION GRAPH GET');
  }
}
