export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getUserId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { evaluateGuard } from '../../lib/guard';
import { digestJson } from '../../lib/integrity/canonicalize';
import { validateAgainstSchema } from '../../lib/work-orders/schema-validate';
import { runWorkOrderSweeps } from '../../lib/work-orders/sweeps';
import { createActionRecord } from '../../lib/repositories/actions.repository';
import {
  ensureSeedTypes, getWorkOrderType, createWorkOrder, listWorkOrders,
} from '../../lib/repositories/work-orders.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    await runWorkOrderSweeps(sql, orgId);
    const { searchParams } = new URL(request.url);
    const result = await listWorkOrders(sql, orgId, {
      status: searchParams.get('status') || undefined,
      type: searchParams.get('type') || undefined,
      agent: searchParams.get('agent') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_LIST');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const type = typeof body.type === 'string' ? body.type : '';
    if (!type) {
      return NextResponse.json(
        { error: 'validation_failed', details: [{ field: 'type', message: 'required field missing', code: 'required' }] },
        { status: 400 },
      );
    }

    await ensureSeedTypes(sql, orgId);
    const typeRow = await getWorkOrderType(sql, orgId, type);
    if (!typeRow || typeRow.status !== 'active') {
      return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type', type }, { status: 404 });
    }

    const input = body.input && typeof body.input === 'object' ? body.input : {};
    const inputErrors = validateAgainstSchema(typeRow.input_schema as Record<string, unknown>, input);
    if (inputErrors.length) {
      return NextResponse.json({ error: 'validation_failed', details: inputErrors }, { status: 400 });
    }

    const budget = (body.budget && typeof body.budget === 'object' ? body.budget : {}) as Record<string, unknown>;
    const maxCostUsd = Number(budget.max_cost_usd ?? typeRow.default_max_cost_usd);
    const timeoutSeconds = parseInt(String(budget.timeout_seconds ?? typeRow.default_timeout_seconds), 10);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      return NextResponse.json({ error: 'budget_invalid', code: 'budget_invalid', message: 'budget.max_cost_usd must be a positive number (or the type must define a default)' }, { status: 422 });
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      return NextResponse.json({ error: 'budget_invalid', code: 'timeout_invalid', message: 'budget.timeout_seconds must be a positive integer' }, { status: 422 });
    }

    const requestedBy = typeof body.requested_by === 'string' ? body.requested_by
      : typeof body.agent_id === 'string' ? body.agent_id : null;
    const inputHash = digestJson(input);
    const declaredGoal = `Work order ${type}: ${JSON.stringify(input).slice(0, 200)}`;

    const guard = await evaluateGuard(orgId, {
      action_type: 'work_order.submit',
      agent_id: requestedBy,
      declared_goal: declaredGoal,
      cost_estimate: maxCostUsd,
      reversible: true,
      systems_touched: ['work_orders'],
    }, sql);

    const guardDecision = {
      decision: guard.decision,
      decision_id: guard.decision_id,
      risk_score: guard.risk_score,
      matched_policies: guard.matched_policies,
      reason: guard.reason,
    };

    let status: 'queued' | 'pending_approval' | 'blocked' = 'queued';
    let approvalActionId: string | null = null;
    let errorCode: string | null = null;

    if (guard.decision === 'block') {
      status = 'blocked';
      errorCode = 'blocked_by_policy';
    } else if (guard.decision === 'require_approval') {
      status = 'pending_approval';
      approvalActionId = `act_${crypto.randomUUID()}`;
      await createActionRecord(sql, {
        orgId,
        action_id: approvalActionId,
        data: {
          agent_id: requestedBy,
          action_type: 'work_order.submit',
          declared_goal: declaredGoal,
          input_summary: `work order ${type} awaiting approval (max $${maxCostUsd})`,
          risk_score: guard.risk_score,
          reversible: true,
          systems_touched: ['work_orders'],
        },
        actionStatus: 'pending_approval',
        costEstimate: maxCostUsd,
        signature: null,
        verified: null,
        timestamp_start: new Date().toISOString(),
        riskScore: guard.risk_score,
        // Separation of duties (drizzle/0055): trusted middleware principal.
        createdBy: getUserId(request) || null,
      });
    }

    const order = await createWorkOrder(sql, orgId, {
      type,
      typeVersion: String(typeRow.version),
      input,
      inputHash,
      maxCostUsd,
      timeoutSeconds,
      status,
      requestedBy,
      guardDecision,
      approvalActionId,
      errorCode,
    });

    return NextResponse.json(
      { work_order_id: order?.id, status, guard: guardDecision },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_SUBMIT');
  }
}
