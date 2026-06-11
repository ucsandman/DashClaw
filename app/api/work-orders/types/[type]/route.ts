export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { validateSchemaDefinition } from '../../../../lib/work-orders/schema-validate';
import { getWorkOrderType, updateWorkOrderType, disableWorkOrderType } from '../../../../lib/repositories/work-orders.repository';

function bumpVersion(version: string): string {
  const [major = 0, minor = 0] = String(version).split('.').map((n) => parseInt(n, 10) || 0);
  return `${major}.${minor + 1}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const row = await getWorkOrderType(sql, orgId, type);
    if (!row) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_GET');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const existing = await getWorkOrderType(sql, orgId, type);
    if (!existing) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });

    const schemaChanged = body.input_schema !== undefined || body.output_schema !== undefined;
    const details = [
      ...(body.input_schema !== undefined ? validateSchemaDefinition(body.input_schema).map((e) => ({ ...e, field: `input_schema.${e.field}` })) : []),
      ...(body.output_schema !== undefined ? validateSchemaDefinition(body.output_schema).map((e) => ({ ...e, field: `output_schema.${e.field}` })) : []),
    ];
    if (details.length) return NextResponse.json({ error: 'validation_failed', details }, { status: 400 });

    const version = typeof body.version === 'string' ? body.version
      : schemaChanged ? bumpVersion(String(existing.version)) : String(existing.version);

    const row = await updateWorkOrderType(sql, orgId, type, {
      version,
      displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      defaultMaxCostUsd: Number.isFinite(Number(body.default_max_cost_usd)) ? Number(body.default_max_cost_usd) : undefined,
      defaultTimeoutSeconds: Number.isFinite(Number(body.default_timeout_seconds)) ? Number(body.default_timeout_seconds) : undefined,
    });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_UPDATE');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const row = await disableWorkOrderType(sql, orgId, type); // soft-disable, history preserved
    if (!row) return NextResponse.json({ error: 'unknown_work_order_type', code: 'unknown_work_order_type' }, { status: 404 });
    return NextResponse.json({ type: row });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPE_DISABLE');
  }
}
