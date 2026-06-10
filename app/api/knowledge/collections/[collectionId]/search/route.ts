export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { getCollection } from '../../../../../lib/repositories/knowledge.repository';
import { searchCollection } from '../../../../../lib/knowledge-ingest';

/**
 * POST /api/knowledge/collections/:collectionId/search
 *
 * Semantic search over a knowledge collection's chunked + embedded content.
 * Embeds the query via BYOK OpenAI key, then uses pgvector cosine distance
 * to find the most relevant chunks. Returns top-k results with similarity
 * scores, chunk content, and source item metadata.
 *
 * Body:
 *   query: string (required)
 *   limit: number (default 5, max 20)
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

    const body = await request.json();
    if (!body?.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    try {
      const results = await searchCollection(sql, orgId, collectionId, body.query.trim(), {
        limit: body.limit,
      });
      return NextResponse.json({
        query: body.query.trim(),
        collection_id: collectionId,
        results,
        count: results.length,
      });
    } catch (err) {
      if ((err as Error).message?.includes('API key')) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    return apiErrorResponse(error, 'KNOWLEDGE COLLECTION SEARCH');
  }
}
