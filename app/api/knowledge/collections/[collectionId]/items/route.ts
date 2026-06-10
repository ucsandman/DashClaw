export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import {
  listCollectionItems,
  addCollectionItem,
} from '../../../../../lib/repositories/knowledge.repository';

export async function GET(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;
    const { searchParams } = new URL(request.url);

    const limit = searchParams.get('limit') || 100;
    const offset = searchParams.get('offset') || 0;

    const items = await listCollectionItems(sql, orgId, collectionId, { limit, offset });
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION ITEMS GET');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;
    const body = await request.json();

    if (!body?.source_uri) {
      return NextResponse.json({ error: 'source_uri is required' }, { status: 400 });
    }

    const item = await addCollectionItem(sql, orgId, collectionId, body);
    if (!item) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION ITEMS POST');
  }
}
