export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import {
  listCapabilities,
  createCapability,
} from '../../lib/repositories/capabilities.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') || undefined;
    const risk_level = searchParams.get('risk_level') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.get('limit') || 100;
    const offset = searchParams.get('offset') || 0;

    const capabilities = await listCapabilities(sql, orgId, {
      category,
      risk_level,
      search,
      limit,
      offset,
    });
    return NextResponse.json({ capabilities });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITIES GET');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body?.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    try {
      const capability = await createCapability(sql, orgId, body);
      return NextResponse.json({ capability }, { status: 201 });
    } catch (validationError) {
      const message = (validationError as Error).message;
      if (
        message?.startsWith('risk_level') ||
        message?.startsWith('source_type')
      ) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    const message = (error as Error).message;
    if (message?.includes('unique') || message?.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A capability with this slug already exists' },
        { status: 409 }
      );
    }
    return apiErrorResponse(error, 'CAPABILITIES POST');
  }
}
