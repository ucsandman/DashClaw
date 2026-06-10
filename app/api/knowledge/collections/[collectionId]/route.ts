export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getCollection,
  updateCollection,
  deleteCollection,
} from '../../../../lib/repositories/knowledge.repository';

export async function GET(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;

    const collection = await getCollection(sql, orgId, collectionId);
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }
    return NextResponse.json({ collection });
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION GET');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;

    const deleted = await deleteCollection(sql, orgId, collectionId);
    if (!deleted) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, collection_id: collectionId });
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION DELETE');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;
    const body = await request.json();

    try {
      const updated = await updateCollection(sql, orgId, collectionId, body);
      if (!updated) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
      }
      return NextResponse.json({ collection: updated });
    } catch (validationError) {
      if ((validationError as Error).message?.startsWith('source_type')) {
        return NextResponse.json({ error: (validationError as Error).message }, { status: 400 });
      }
      throw validationError;
    }
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION PATCH');
  }
}
