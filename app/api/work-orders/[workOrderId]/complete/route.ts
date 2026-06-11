export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { digestJson } from '../../../../lib/integrity/canonicalize';
import { validateAgainstSchema } from '../../../../lib/work-orders/schema-validate';
import { buildReceiptBody, computeReceiptHash } from '../../../../lib/work-orders/receipt';
import { createActionRecord } from '../../../../lib/repositories/actions.repository';
import { createArtifact } from '../../../../lib/repositories/artifacts.repository';
import { upsertSignalSnapshots } from '../../../../lib/repositories/signals.repository';
import {
  getWorkOrder, getWorkOrderType, transitionWorkOrder, createWorkOrderReceipt,
} from '../../../../lib/repositories/work-orders.repository';

export async function POST(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    const { workOrderId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const reportedStatus = body.status === 'failed' ? 'failed' : body.status === 'completed' ? 'completed' : null;
    if (!reportedStatus) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'status', message: "must be 'completed' or 'failed'", code: 'enum' }] }, { status: 400 });
    }

    const order = await getWorkOrder(sql, orgId, workOrderId);
    if (!order) {
      return NextResponse.json({ error: 'work_order_not_found', code: 'work_order_not_found' }, { status: 404 });
    }
    if (order.status !== 'claimed') {
      return NextResponse.json({ error: 'not_claimed', code: 'not_claimed', status: order.status }, { status: 409 });
    }
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId || agentId !== order.claimed_by) {
      return NextResponse.json({ error: 'not_claim_holder', code: 'not_claim_holder' }, { status: 403 });
    }

    // Audit record via the existing record path; its id lands in the receipt and
    // in the artifact's source_action_id so artifacts are queryable by audit id.
    const auditId = `act_${crypto.randomUUID()}`;

    // Output contract enforcement (completed only). Rejection leaves the order
    // claimed so the worker can fix and re-report before the lease expires.
    let outputHash: string | null = null;
    if (reportedStatus === 'completed') {
      const typeRow = await getWorkOrderType(sql, orgId, String(order.type));
      const output = body.output && typeof body.output === 'object' ? body.output : null;
      if (!output) {
        return NextResponse.json({ error: 'output_contract_violation', details: [{ field: 'output', message: 'required field missing', code: 'required' }] }, { status: 422 });
      }
      const outputErrors = validateAgainstSchema((typeRow?.output_schema ?? {}) as Record<string, unknown>, output);
      if (outputErrors.length) {
        return NextResponse.json({ error: 'output_contract_violation', details: outputErrors }, { status: 422 });
      }
      outputHash = digestJson(output);
      await createArtifact(sql, orgId, {
        artifact_type: 'work_order_output',
        name: `${order.type} output for ${workOrderId}`,
        source_agent_id: agentId,
        source_action_id: auditId,
        content_json: output,
        metadata: { work_order_id: workOrderId, content_hash: outputHash },
      });
    }

    const error = (body.error && typeof body.error === 'object' ? body.error : null) as { code?: string; message?: string } | null;
    const updated = await transitionWorkOrder(sql, orgId, workOrderId, reportedStatus, {
      errorCode: reportedStatus === 'failed' ? (error?.code || 'worker_failed') : null,
      errorDetails: reportedStatus === 'failed' ? (error?.message || null) : null,
    });

    if (!updated) {
      return NextResponse.json({ error: 'not_claimed', code: 'not_claimed', message: 'work order changed state before completion was recorded' }, { status: 409 });
    }
    const cost = (body.cost && typeof body.cost === 'object' ? body.cost : null) as { input_tokens?: number; output_tokens?: number; total_usd?: number } | null;
    await createActionRecord(sql, {
      orgId,
      action_id: auditId,
      data: {
        agent_id: agentId,
        action_type: 'work_order.complete',
        declared_goal: `Complete work order ${workOrderId} (${order.type})`,
        input_summary: `work order ${order.type}, budget $${Number(order.max_cost_usd)}`,
        output_summary: reportedStatus === 'completed' ? `output ${outputHash}` : `failed: ${error?.code || 'worker_failed'}`,
        systems_touched: ['work_orders'],
        reversible: true,
        timestamp_end: new Date().toISOString(),
      },
      actionStatus: reportedStatus,
      costEstimate: cost?.total_usd ?? null,
      signature: null,
      verified: null,
      timestamp_start: String(order.claimed_at ?? order.created_at ?? new Date().toISOString()),
      riskScore: null,
    });

    const guardDecision = (order.guard_decision ?? {}) as Record<string, unknown>;
    const receiptBody = buildReceiptBody({
      order: { ...updated, claimed_by: agentId } as never,
      cost,
      outputHash,
      governance: {
        mode: 'governed',
        guard_decision_id: (guardDecision.decision_id as string) ?? null,
        audit_record_id: auditId,
        matched_policies: (guardDecision.matched_policies as string[]) ?? [],
      },
    });
    const receiptHash = computeReceiptHash(receiptBody);
    await createWorkOrderReceipt(sql, orgId, workOrderId, receiptBody, receiptHash);

    if (receiptBody.over_budget) {
      // Signals are a dedup fingerprint store — only org/hash/type/severity/agent_id are
      // persisted; work_order_id contributes to the hash, it is not a queryable column.
      const now = new Date().toISOString();
      await upsertSignalSnapshots(sql, orgId, [{
        _hash: digestJson({ kind: 'work_order_over_budget', workOrderId }),
        type: 'work_order_over_budget',
        severity: 'warning',
        agent_id: agentId,
        work_order_id: workOrderId,
      }], now);
    }

    return NextResponse.json({
      work_order: updated,
      receipt: { receipt: receiptBody, receipt_hash: receiptHash },
    });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_COMPLETE');
  }
}
