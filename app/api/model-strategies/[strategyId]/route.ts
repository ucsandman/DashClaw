export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  getModelStrategy,
  updateModelStrategy,
  deleteModelStrategy,
} from '../../../lib/repositories/model-strategies.repository';

export async function GET(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { strategyId } = await params;

    const strategy = await getModelStrategy(sql, orgId, strategyId);
    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }
    return NextResponse.json({ strategy });
  } catch (error) {
    return apiErrorResponse(error, 'MODEL STRATEGY GET');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { strategyId } = await params;
    const body = await request.json();

    try {
      const updated = await updateModelStrategy(sql, orgId, strategyId, body);
      if (!updated) {
        return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
      }
      return NextResponse.json({ strategy: updated });
    } catch (validationError) {
      if ((validationError as Error).message?.startsWith('config')) {
        return NextResponse.json({ error: (validationError as Error).message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    return apiErrorResponse(error, 'MODEL STRATEGY PATCH');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { strategyId } = await params;

    const deleted = await deleteModelStrategy(sql, orgId, strategyId);
    if (!deleted) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, 'MODEL STRATEGY DELETE');
  }
}
