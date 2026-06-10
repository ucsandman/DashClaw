export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  listCollections,
  createCollection,
} from '../../../lib/repositories/knowledge.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const sourceType = searchParams.get('source_type') || undefined;
    const limit = searchParams.get('limit') || 50;
    const offset = searchParams.get('offset') || 0;

    const collections = await listCollections(sql, orgId, { sourceType, limit, offset });
    return NextResponse.json({ collections });
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTIONS GET');
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
      const collection = await createCollection(sql, orgId, body);
      return NextResponse.json({ collection }, { status: 201 });
    } catch (validationError) {
      if ((validationError as Error).message?.startsWith('source_type')) {
        return NextResponse.json({ error: (validationError as Error).message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTIONS POST');
  }
}
