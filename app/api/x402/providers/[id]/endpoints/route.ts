export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { createEndpoint, listEndpoints, getProvider } from '../../../../../lib/repositories/x402.repository';
import { apiErrorResponse } from '../../../../../lib/apiErrors';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/x402/providers/:id/endpoints — list a provider's endpoints. */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const endpoints = await listEndpoints(sql, orgId, id);
    return NextResponse.json({ endpoints });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PROVIDERS/:id/ENDPOINTS GET');
  }
}

/** POST /api/x402/providers/:id/endpoints — add an endpoint to a provider. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    // Verify the parent provider exists in THIS org before attaching an endpoint,
    // so an endpoint can't be created under a nonexistent or cross-tenant
    // provider_id (audit X2).
    const provider = await getProvider(sql, orgId, id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    const endpoint = await createEndpoint(sql, orgId, id, body);
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'X402/PROVIDERS/:id/ENDPOINTS POST');
  }
}
