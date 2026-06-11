export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { listArtifacts } from '../../../../lib/repositories/artifacts.repository';
import { getWorkOrder, getWorkOrderReceipt } from '../../../../lib/repositories/work-orders.repository';

export async function GET(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    const receiptRow = await getWorkOrderReceipt(sql, orgId, workOrderId);
    // receipt column is jsonb — the Neon driver returns it already parsed, but guard against
    // environments that may return it as a string.
    const receiptData = receiptRow
      ? (typeof receiptRow.receipt === 'string' ? JSON.parse(receiptRow.receipt) : receiptRow.receipt) as Record<string, unknown>
      : null;
    const auditRecordId = (receiptData?.governance as Record<string, unknown> | null | undefined)?.audit_record_id as string | undefined;
    if (!receiptRow || !auditRecordId) {
      return NextResponse.json({ artifacts: [], total: 0 });
    }
    const result = await listArtifacts(sql, orgId, { action_id: auditRecordId, limit: 100 });
    return NextResponse.json({ artifacts: result.artifacts, total: result.total });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_ARTIFACTS');
  }
}
