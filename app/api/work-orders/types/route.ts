export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { validateSchemaDefinition } from '../../../lib/work-orders/schema-validate';
import { ensureSeedTypes, listWorkOrderTypes, createWorkOrderType, getWorkOrderType } from '../../../lib/repositories/work-orders.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    await ensureSeedTypes(sql, orgId);
    const { searchParams } = new URL(request.url);
    const types = await listWorkOrderTypes(sql, orgId, searchParams.get('include_disabled') === 'true');
    return NextResponse.json({ types, total: types.length });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPES_LIST');
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
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(type)) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'type', message: 'must be a snake_case slug (3-64 chars)', code: 'format' }] }, { status: 400 });
    }
    const details = [
      ...validateSchemaDefinition(body.input_schema).map((e) => ({ ...e, field: `input_schema.${e.field}` })),
      ...validateSchemaDefinition(body.output_schema).map((e) => ({ ...e, field: `output_schema.${e.field}` })),
    ];
    if (details.length) {
      return NextResponse.json({ error: 'validation_failed', details }, { status: 400 });
    }
    const existing = await getWorkOrderType(sql, orgId, type);
    if (existing) {
      return NextResponse.json({ error: 'type_exists', code: 'type_exists' }, { status: 409 });
    }
    const row = await createWorkOrderType(sql, orgId, {
      type,
      version: typeof body.version === 'string' ? body.version : '1.0',
      displayName: typeof body.display_name === 'string' ? body.display_name : null,
      description: typeof body.description === 'string' ? body.description : null,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      defaultMaxCostUsd: Number.isFinite(Number(body.default_max_cost_usd)) ? Number(body.default_max_cost_usd) : null,
      defaultTimeoutSeconds: Number.isFinite(Number(body.default_timeout_seconds)) ? Number(body.default_timeout_seconds) : null,
    });
    return NextResponse.json({ type: row }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDER_TYPES_CREATE');
  }
}
