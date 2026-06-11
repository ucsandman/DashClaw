export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { listArtifacts } from '../../../../lib/repositories/artifacts.repository';
import { getWorkOrder } from '../../../../lib/repositories/work-orders.repository';

export async function GET(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    // Artifacts are tagged with work_order_id in metadata at completion. listArtifacts
    // has no metadata filter, so narrow by type then by the metadata field (shapeArtifact
    // parses metadata_json into `metadata`).
    const result = await listArtifacts(sql, orgId, { artifact_type: 'work_order_output', limit: 100 });
    const artifacts = (result.artifacts || []).filter((a) => {
      const meta = (a as Record<string, unknown> | null)?.metadata as Record<string, unknown> | null;
      return meta && meta.work_order_id === workOrderId;
    });
    return NextResponse.json({ artifacts, total: artifacts.length });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_ARTIFACTS');
  }
}
