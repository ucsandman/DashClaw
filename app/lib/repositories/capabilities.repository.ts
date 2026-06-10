import crypto from 'crypto';
import { validateInvocationSchema } from '../capability-contracts';
import type { SqlTag } from '../types/db';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const SOURCE_TYPES = new Set([
  'internal_sdk',
  'http_api',
  'webhook',
  'human_approval',
  'external_marketplace',
]);

interface CapabilityRow {
  capability_id: unknown;
  org_id: unknown;
  name: unknown;
  slug: unknown;
  description?: unknown;
  category?: unknown;
  source_type: unknown;
  auth_type?: unknown;
  risk_level: unknown;
  requires_approval?: unknown;
  tags_json?: unknown;
  pricing_json?: unknown;
  health_status: unknown;
  docs_url?: unknown;
  invocation_schema_json?: unknown;
  created_at: unknown;
  updated_at: unknown;
  [k: string]: unknown;
}

interface CapabilityFilters {
  category?: string;
  risk_level?: string;
  search?: string;
  limit?: number | string;
  offset?: number | string;
}

interface CapabilityInput {
  name?: unknown;
  capability_id?: string;
  slug?: string;
  description?: string | null;
  category?: string | null;
  source_type?: string;
  auth_type?: string;
  risk_level?: string;
  requires_approval?: unknown;
  tags?: unknown;
  pricing?: unknown;
  health_status?: string;
  docs_url?: string | null;
  invocation_schema?: unknown;
  [k: string]: unknown;
}

interface CapabilityPatch {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  source_type?: string;
  auth_type?: string | null;
  risk_level?: string;
  requires_approval?: unknown;
  tags?: unknown;
  pricing?: unknown;
  health_status?: string | null;
  docs_url?: string | null;
  invocation_schema?: unknown;
  [k: string]: unknown;
}

function safeJsonParse(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(name: unknown): string {
  // Cap input length before the regexes to bound worst-case matching time.
  return String(name || '')
    .slice(0, 200)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `cap-${Date.now()}`;
}

export function shapeCapability(row: CapabilityRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    capability_id: row.capability_id,
    org_id: row.org_id,
    name: row.name,
    slug: row.slug,
    description: row.description || null,
    category: row.category || null,
    source_type: row.source_type,
    auth_type: row.auth_type || null,
    risk_level: row.risk_level,
    requires_approval: row.requires_approval === 1 || row.requires_approval === true,
    tags: safeJsonParse(row.tags_json, []),
    pricing: safeJsonParse(row.pricing_json, {}),
    health_status: row.health_status,
    docs_url: row.docs_url || null,
    invocation_schema: safeJsonParse(row.invocation_schema_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listCapabilities(
  sql: SqlTag,
  orgId: string,
  filters: CapabilityFilters = {},
): Promise<Array<Record<string, unknown> | null>> {
  const { category, risk_level, search, limit = 100, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(String(limit), 10) || 100, 500);
  const parsedOffset = parseInt(String(offset), 10) || 0;

  // Branch on which filters are present. This keeps the tagged-template mock
  // path simple (no inline sql`` interpolation fragments).
  let rows: Record<string, unknown>[];
  if (search && category && risk_level) {
    const term = `%${search}%`;
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId}
        AND category = ${category}
        AND risk_level = ${risk_level}
        AND (name ILIKE ${term} OR description ILIKE ${term} OR tags_json ILIKE ${term})
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (search && category) {
    const term = `%${search}%`;
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId}
        AND category = ${category}
        AND (name ILIKE ${term} OR description ILIKE ${term} OR tags_json ILIKE ${term})
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (search && risk_level) {
    const term = `%${search}%`;
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId}
        AND risk_level = ${risk_level}
        AND (name ILIKE ${term} OR description ILIKE ${term} OR tags_json ILIKE ${term})
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (search) {
    const term = `%${search}%`;
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId}
        AND (name ILIKE ${term} OR description ILIKE ${term} OR tags_json ILIKE ${term})
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (category && risk_level) {
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId} AND category = ${category} AND risk_level = ${risk_level}
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (category) {
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId} AND category = ${category}
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else if (risk_level) {
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId} AND risk_level = ${risk_level}
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  } else {
    rows = await sql`
      SELECT * FROM capabilities
      WHERE org_id = ${orgId}
      ORDER BY updated_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;
  }

  return rows.map((r) => shapeCapability(r as CapabilityRow));
}

export async function getCapability(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT *
    FROM capabilities
    WHERE org_id = ${orgId} AND capability_id = ${capabilityId}
    LIMIT 1
  `;
  return shapeCapability(rows[0] as CapabilityRow | undefined);
}

export async function getCapabilityBySlug(
  sql: SqlTag,
  orgId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT * FROM capabilities
    WHERE org_id = ${orgId} AND slug = ${slug}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return shapeCapability(rows[0] as CapabilityRow | undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export async function createCapability(
  sql: SqlTag,
  orgId: string,
  data: CapabilityInput,
): Promise<Record<string, unknown> | null> {
  if (!data?.name || typeof data.name !== 'string') {
    throw new Error('name is required');
  }
  if (data.risk_level && !RISK_LEVELS.has(data.risk_level)) {
    throw new Error(`risk_level must be one of ${Array.from(RISK_LEVELS).join(', ')}`);
  }
  if (data.source_type && !SOURCE_TYPES.has(data.source_type)) {
    throw new Error(`source_type must be one of ${Array.from(SOURCE_TYPES).join(', ')}`);
  }

  validateInvocationSchema(data.source_type || 'internal_sdk', data.invocation_schema || {});

  const capability_id = data.capability_id || `cap_${crypto.randomUUID()}`;
  const slug = data.slug ? slugify(data.slug) : slugify(data.name);

  const rows = await sql`
    INSERT INTO capabilities (
      capability_id,
      org_id,
      name,
      slug,
      description,
      category,
      source_type,
      auth_type,
      risk_level,
      requires_approval,
      tags_json,
      pricing_json,
      health_status,
      docs_url,
      invocation_schema_json
    ) VALUES (
      ${capability_id},
      ${orgId},
      ${data.name},
      ${slug},
      ${data.description || null},
      ${data.category || null},
      ${data.source_type || 'internal_sdk'},
      ${data.auth_type || 'none'},
      ${data.risk_level || 'medium'},
      ${data.requires_approval ? 1 : 0},
      ${JSON.stringify(data.tags || [])},
      ${JSON.stringify(data.pricing || {})},
      ${data.health_status || 'unknown'},
      ${data.docs_url || null},
      ${JSON.stringify(data.invocation_schema || {})}
    )
    RETURNING *
  `;

  return shapeCapability(rows[0] as CapabilityRow | undefined);
}

export async function deleteCapability(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM capabilities
    WHERE org_id = ${orgId} AND capability_id = ${capabilityId}
    RETURNING capability_id
  `;
  return rows.length > 0;
}

export async function updateCapability(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
  patch: CapabilityPatch = {},
): Promise<Record<string, unknown> | null> {
  const existing = await getCapability(sql, orgId, capabilityId);
  if (!existing) return null;

  if (patch.risk_level && !RISK_LEVELS.has(patch.risk_level)) {
    throw new Error(`risk_level must be one of ${Array.from(RISK_LEVELS).join(', ')}`);
  }
  if (patch.source_type && !SOURCE_TYPES.has(patch.source_type)) {
    throw new Error(`source_type must be one of ${Array.from(SOURCE_TYPES).join(', ')}`);
  }

  if ('invocation_schema' in patch || 'source_type' in patch) {
    validateInvocationSchema(
      (patch.source_type ?? existing.source_type) as string,
      patch.invocation_schema ?? existing.invocation_schema,
    );
  }

  // Push fallback to SQL via COALESCE so the UPDATE reads the current row
  // atomically instead of merging against the earlier SELECT. Two concurrent
  // PATCHes no longer lose each other's non-overlapping field writes; the
  // SELECT above is kept only for enum validation and schema-compatibility.
  const requiresApprovalPatch =
    'requires_approval' in patch ? (patch.requires_approval ? 1 : 0) : null;
  const tagsPatch = patch.tags !== undefined ? JSON.stringify(patch.tags) : null;
  const pricingPatch = patch.pricing !== undefined ? JSON.stringify(patch.pricing) : null;
  const invocationSchemaPatch =
    patch.invocation_schema !== undefined ? JSON.stringify(patch.invocation_schema) : null;

  const rows = await sql`
    UPDATE capabilities SET
      name = COALESCE(${patch.name ?? null}, name),
      description = COALESCE(${patch.description ?? null}, description),
      category = COALESCE(${patch.category ?? null}, category),
      source_type = COALESCE(${patch.source_type ?? null}, source_type),
      auth_type = COALESCE(${patch.auth_type ?? null}, auth_type),
      risk_level = COALESCE(${patch.risk_level ?? null}, risk_level),
      requires_approval = COALESCE(${requiresApprovalPatch}, requires_approval),
      tags_json = COALESCE(${tagsPatch}, tags_json),
      pricing_json = COALESCE(${pricingPatch}, pricing_json),
      health_status = COALESCE(${patch.health_status ?? null}, health_status),
      docs_url = COALESCE(${patch.docs_url ?? null}, docs_url),
      invocation_schema_json = COALESCE(${invocationSchemaPatch}, invocation_schema_json),
      updated_at = now()
    WHERE org_id = ${orgId} AND capability_id = ${capabilityId}
    RETURNING *
  `;

  return shapeCapability(rows[0] as CapabilityRow | undefined);
}
