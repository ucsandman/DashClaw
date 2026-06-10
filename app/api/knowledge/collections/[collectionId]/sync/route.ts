export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { getCollection } from '../../../../../lib/repositories/knowledge.repository';
import { syncCollection } from '../../../../../lib/knowledge-ingest';

/**
 * POST /api/knowledge/collections/:collectionId/sync
 *
 * Trigger ingestion of all pending items in the collection. Caller-invoked —
 * runs inline (no background worker). Fetches each item's source_uri, chunks
 * the content, generates embeddings via BYOK OpenAI key, and stores in
 * knowledge_chunks. Updates item status and collection metadata.
 *
 * Designed for Vercel free tier: bounded to 50 items per call, no cron required.
 */
export async function POST(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { collectionId } = await params;

    const collection = await getCollection(sql, orgId, collectionId);
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    try {
      const result = await syncCollection(sql, orgId, collectionId);
      return NextResponse.json({ sync: result });
    } catch (err) {
      if ((err as Error).message?.includes('API key')) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION SYNC');
  }
}
