export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { runWorkOrderSweeps } from '../../../lib/work-orders/sweeps';
import {
  getWorkOrder, getWorkOrderReceipt, transitionWorkOrder, LEGAL_TRANSITIONS,
} from '../../../lib/repositories/work-orders.repository';

export async function GET(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    await runWorkOrderSweeps(sql, orgId);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    const receipt = await getWorkOrderReceipt(sql, orgId, workOrderId);
    return NextResponse.json({ work_order: order, receipt });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_GET');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    const cancellable = LEGAL_TRANSITIONS[String(order.status)]?.includes('cancelled');
    if (!cancellable) {
      return NextResponse.json({ error: 'not_cancellable', code: 'not_cancellable', status: order.status }, { status: 409 });
    }
    const updated = await transitionWorkOrder(sql, orgId, workOrderId, 'cancelled', { errorCode: 'cancelled_by_caller' });
    return NextResponse.json({ work_order: updated });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_CANCEL');
  }
}
