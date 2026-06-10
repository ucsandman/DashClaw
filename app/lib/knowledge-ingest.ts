/**
 * Knowledge ingestion module — chunking, embedding, sync, and retrieval.
 *
 * Caller-invoked (no background workers) to stay Vercel-free-tier friendly.
 * Uses BYOK OpenAI credentials from org settings for embedding generation.
 * Stores chunks + vectors in the knowledge_chunks table via pgvector.
 */

import crypto from 'crypto';
import { getSettings } from './repositories/settings.repository';
import { decrypt } from './encryption';
import { scanSensitiveData } from './security';
import { safeUrlWithIps, buildPinnedDispatcher } from './webhooks';
import type { SqlTag } from './types/db';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_TARGET_TOKENS = 500;    // ~2000 chars
const CHUNK_OVERLAP_TOKENS = 50;    // ~200 chars overlap
const CHARS_PER_TOKEN = 4;          // rough estimate
const MAX_CHUNKS_PER_ITEM = 200;
const FETCH_TIMEOUT = 15_000;

export interface TextChunk {
  content: string;
  position: number;
  tokenCount: number;
}

/** Float embedding vectors with the OpenAI prompt-token usage attached. */
type EmbeddingsWithUsage = number[][] & { tokens_used?: number };

// ─────────────────────────────────────────────────────────────────────────────
// BYOK credential loading (same pattern as providers.js / integration-health)
// ─────────────────────────────────────────────────────────────────────────────

async function getEmbeddingApiKey(sql: SqlTag, orgId: string): Promise<string | null> {
  // Try org settings first (BYOK)
  try {
    const settings = await getSettings(sql, orgId, { key: 'OPENAI_API_KEY' }) as Array<Record<string, any>>;
    if (settings.length > 0 && settings[0]!.value) {
      let val = settings[0]!.value;
      if (settings[0]!.encrypted) {
        const decrypted = decrypt(val, `${orgId}:OPENAI_API_KEY`);
        if (decrypted) val = decrypted;
      }
      return val;
    }
  } catch { /* fall through */ }

  // Fall back to env var (single-tenant deploys)
  return process.env.OPENAI_API_KEY || process.env.GUARD_LLM_KEY || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split text into chunks of ~CHUNK_TARGET_TOKENS tokens with overlap.
 * Splits on paragraph boundaries first, then sentence boundaries, then
 * hard character limit.
 */
export function chunkText(text: unknown): TextChunk[] {
  if (!text || typeof text !== 'string') return [];

  const targetChars = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN;

  // Split into paragraphs, then accumulate
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: TextChunk[] = [];
  let buffer = '';
  let position = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (buffer.length + trimmed.length + 1 <= targetChars) {
      buffer += (buffer ? '\n\n' : '') + trimmed;
    } else {
      // Flush current buffer as a chunk
      if (buffer.length > 0) {
        chunks.push({
          content: buffer,
          position: position++,
          tokenCount: Math.ceil(buffer.length / CHARS_PER_TOKEN),
        });
        // Keep overlap from end of buffer
        buffer = buffer.slice(-overlapChars).trimStart();
      }
      // If the paragraph itself exceeds target, split by sentences
      if (trimmed.length > targetChars) {
        const sentences = trimmed.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if (buffer.length + sentence.length + 1 <= targetChars) {
            buffer += (buffer ? ' ' : '') + sentence;
          } else {
            if (buffer.length > 0) {
              chunks.push({
                content: buffer,
                position: position++,
                tokenCount: Math.ceil(buffer.length / CHARS_PER_TOKEN),
              });
              buffer = buffer.slice(-overlapChars).trimStart();
            }
            // Hard split on very long sentences
            if (sentence.length > targetChars) {
              for (let i = 0; i < sentence.length; i += targetChars - overlapChars) {
                const slice = sentence.slice(i, i + targetChars);
                chunks.push({
                  content: slice,
                  position: position++,
                  tokenCount: Math.ceil(slice.length / CHARS_PER_TOKEN),
                });
              }
              buffer = '';
            } else {
              buffer = sentence;
            }
          }
        }
      } else {
        buffer += (buffer ? '\n\n' : '') + trimmed;
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim().length > 0) {
    chunks.push({
      content: buffer.trim(),
      position: position++,
      tokenCount: Math.ceil(buffer.trim().length / CHARS_PER_TOKEN),
    });
  }

  return chunks.slice(0, MAX_CHUNKS_PER_ITEM);
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding generation (batch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate embeddings for an array of text strings using the BYOK OpenAI key.
 * Returns an array of float[] vectors (same order as input).
 * Throws if no API key is available.
 */
export async function generateEmbeddings(apiKey: string | null, texts: string[]): Promise<EmbeddingsWithUsage> {
  if (!apiKey) throw new Error('No OpenAI API key available for embedding generation');
  if (!texts || texts.length === 0) return [] as EmbeddingsWithUsage;

  // Security: redact secrets from embedding input
  const safeTexts = texts.map((t) => {
    const scanned = scanSensitiveData(t);
    return scanned.redacted;
  });

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: safeTexts,
      encoding_format: 'float',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI Embeddings API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data: any = await res.json();
  // Sort by index since OpenAI may return out of order
  const sorted = [...data.data].sort((a: any, b: any) => a.index - b.index);
  const embeddings = sorted.map((d: any) => d.embedding) as EmbeddingsWithUsage;
  embeddings.tokens_used = Number(data.usage?.prompt_tokens) || 0;
  return embeddings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content fetching
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSourceContent(sourceUri: string): Promise<string> {
  // SSRF guard: validate the URL, ensure it resolves to a public IP, and
  // pin that IP for the actual fetch so a short-TTL DNS record cannot
  // rebind to a private/loopback address between our check and undici's
  // own connect-time resolution. safeUrlWithIps requires https:// and
  // rejects URL-embedded credentials, which are the right defaults for
  // knowledge ingestion too.
  const validatedIps = await safeUrlWithIps(sourceUri);
  const dispatcher = buildPinnedDispatcher(validatedIps);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(sourceUri, { signal: controller.signal, dispatcher } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sourceUri}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync (ingest) a collection
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncCollectionResult {
  ingested: number;
  failed: number;
  chunks_created: number;
  errors: string[];
}

/**
 * Ingest all pending items in a knowledge collection: fetch content, chunk,
 * embed, and store in knowledge_chunks. Updates item status and collection
 * metadata. Caller-invoked — runs inline in the HTTP request.
 */
export async function syncCollection(sql: SqlTag, orgId: string, collectionId: string): Promise<SyncCollectionResult> {
  const apiKey = await getEmbeddingApiKey(sql, orgId);
  if (!apiKey) {
    throw new Error('No OpenAI API key configured. Add OPENAI_API_KEY in Settings > Integrations.');
  }

  // Fetch pending items
  const items = await sql`
    SELECT * FROM knowledge_collection_items
    WHERE org_id = ${orgId} AND collection_id = ${collectionId} AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  ` as Array<Record<string, any>>;

  if (items.length === 0) {
    return { ingested: 0, failed: 0, chunks_created: 0, errors: [] };
  }

  // Mark collection as syncing
  await sql`
    UPDATE knowledge_collections
    SET ingestion_status = 'syncing', updated_at = now()
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
  `;

  let ingested = 0;
  let failed = 0;
  let totalChunksCreated = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      // 1. Fetch content
      const content = await fetchSourceContent(item.source_uri);
      if (!content || content.trim().length === 0) {
        throw new Error('Empty content');
      }

      // 2. Chunk
      const chunks = chunkText(content);
      if (chunks.length === 0) {
        throw new Error('No chunks produced');
      }

      // 3. Embed (batch — send all chunks at once for efficiency)
      const embeddings = await generateEmbeddings(
        apiKey,
        chunks.map((c) => c.content)
      );

      // 4. Store chunks
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `kch_${crypto.randomUUID()}`;
        await sql`
          INSERT INTO knowledge_chunks (
            chunk_id, item_id, collection_id, org_id,
            content, embedding, position, token_count
          ) VALUES (
            ${chunkId},
            ${item.item_id},
            ${collectionId},
            ${orgId},
            ${chunks[i]!.content},
            ${JSON.stringify(embeddings[i])}::vector,
            ${chunks[i]!.position},
            ${chunks[i]!.tokenCount}
          )
        `;
      }

      // 5. Mark item as indexed
      await sql`
        UPDATE knowledge_collection_items
        SET status = 'indexed', updated_at = now()
        WHERE item_id = ${item.item_id} AND org_id = ${orgId}
      `;

      ingested++;
      totalChunksCreated += chunks.length;
    } catch (err) {
      failed++;
      errors.push(`${item.item_id}: ${(err as Error).message}`);

      await sql`
        UPDATE knowledge_collection_items
        SET status = 'failed', metadata_json = ${JSON.stringify({
          ...(item.metadata_json ? JSON.parse(item.metadata_json) : {}),
          error: (err as Error).message,
          failed_at: new Date().toISOString(),
        })}, updated_at = now()
        WHERE item_id = ${item.item_id} AND org_id = ${orgId}
      `;
    }
  }

  // Update collection status
  const finalStatus = failed === items.length ? 'failed' : 'synced';
  await sql`
    UPDATE knowledge_collections
    SET ingestion_status = ${finalStatus},
        last_synced_at = now(),
        updated_at = now()
    WHERE org_id = ${orgId} AND collection_id = ${collectionId}
  `;

  return { ingested, failed, chunks_created: totalChunksCreated, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector search
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResultChunk {
  chunk_id: unknown;
  item_id: unknown;
  content: unknown;
  score: number;
  position: unknown;
  token_count: unknown;
  title: unknown;
  source_uri: unknown;
}

/** Search result chunks with the query-embedding token cost attached. */
type SearchResults = SearchResultChunk[] & { tokens_used?: number };

export interface SearchCollectionOptions {
  limit?: number;
}

/**
 * Search a knowledge collection by semantic similarity.
 * Embeds the query, then uses pgvector's <=> operator for cosine distance.
 */
export async function searchCollection(
  sql: SqlTag,
  orgId: string,
  collectionId: string,
  query: string,
  options: SearchCollectionOptions = {},
): Promise<SearchResults> {
  const { limit = 5 } = options;

  const apiKey = await getEmbeddingApiKey(sql, orgId);
  if (!apiKey) {
    throw new Error('No OpenAI API key configured for search.');
  }

  // Embed the query
  const embeddings = await generateEmbeddings(apiKey, [query]);
  const [queryEmbedding] = embeddings;
  const tokensUsed = embeddings.tokens_used || 0;

  // pgvector cosine distance: <=> returns distance (0 = identical), so
  // we compute similarity as 1 - distance for the score.
  const results = await sql`
    SELECT
      kc.chunk_id,
      kc.item_id,
      kc.content,
      kc.position,
      kc.token_count,
      ki.title,
      ki.source_uri,
      1 - (kc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS score
    FROM knowledge_chunks kc
    JOIN knowledge_collection_items ki ON kc.item_id = ki.item_id
    WHERE kc.org_id = ${orgId}
      AND kc.collection_id = ${collectionId}
    ORDER BY kc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${Math.min(parseInt(limit as unknown as string, 10) || 5, 20)}
  ` as Array<Record<string, any>>;

  const chunks = results.map((r) => ({
    chunk_id: r.chunk_id,
    item_id: r.item_id,
    content: r.content,
    score: parseFloat(r.score) || 0,
    position: r.position,
    token_count: r.token_count,
    title: r.title || null,
    source_uri: r.source_uri || null,
  })) as SearchResults;
  // Attach the query-embedding token cost so the workflow executor can
  // surface it on action_records.tokens_in — without this every
  // knowledge_search step reports zero token usage regardless of query
  // length, creating a metering blind spot for non-prompt steps.
  chunks.tokens_used = tokensUsed;
  return chunks;
}
