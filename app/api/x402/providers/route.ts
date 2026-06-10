export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { createProvider, listProviders } from '../../../lib/repositories/x402.repository';
import { apiErrorResponse } from '../../../lib/apiErrors';

/** GET /api/x402/providers — list providers (org-scoped). */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const status = new URL(request.url).searchParams.get('status') || undefined;
    const providers = await listProviders(sql, orgId, { status });
    return NextResponse.json({ providers });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PROVIDERS GET');
  }
}

/** POST /api/x402/providers — register a paid x402 provider. */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const provider = await createProvider(sql, orgId, body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PROVIDERS POST');
  }
}
