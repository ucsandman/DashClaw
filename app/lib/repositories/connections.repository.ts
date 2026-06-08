/**
 * Repository for agent connections
 * Handles all database operations for agent_connections table
 */
import type { SqlTag } from '../types/db';

const VALID_AUTH_TYPES = ['api_key', 'subscription', 'oauth', 'pre_configured', 'environment'];
const VALID_STATUSES = ['active', 'inactive', 'error'];

interface ListConnectionsFilter {
  agentId?: string | null;
  provider?: string | null;
}

interface ConnectionInput {
  provider?: string;
  auth_type?: string;
  status?: string;
  plan_name?: string | null;
  metadata?: unknown;
  [k: string]: unknown;
}

/**
 * Ensure agent_connections table exists
 */
export async function ensureConnectionsTable(sql: SqlTag): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS agent_connections (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'org_default',
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'api_key',
      plan_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT,
      reported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_connections_org_agent_provider_unique
    ON agent_connections (org_id, agent_id, provider)
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_id ON agent_connections(agent_id)`;
}

// Generous safety cap on an unbounded SELECT. An org's distinct connections
// (agents × providers) are far fewer than this; the bound only guards against
// pathological table growth dragging the query.
const LIST_LIMIT = 500;

/**
 * List connections with optional filters
 */
export async function listConnections(
  sql: SqlTag,
  orgId: string,
  { agentId, provider }: ListConnectionsFilter = {}
): Promise<Record<string, unknown>[]> {
  // SECURITY: Use parameterized queries only — no sql.unsafe().
  let connections;
  if (agentId && provider) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND agent_id = ${agentId} AND provider = ${provider} ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`;
  } else if (agentId) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`;
  } else if (provider) {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} AND provider = ${provider} ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`;
  } else {
    connections = await sql`SELECT * FROM agent_connections WHERE org_id = ${orgId} ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`;
  }

  return connections || [];
}

/**
 * Upsert a single connection
 */
export async function upsertConnection(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  connection: ConnectionInput
): Promise<Record<string, unknown> | undefined> {
  const {
    provider,
    auth_type = 'api_key',
    status = 'active',
    plan_name = null,
    metadata = null
  } = connection;

  // Validation
  if (!provider || typeof provider !== 'string' || provider.length > 128) {
    throw new Error('provider is required and must be <= 128 chars');
  }
  if (auth_type && !VALID_AUTH_TYPES.includes(auth_type)) {
    throw new Error(`auth_type must be one of: ${VALID_AUTH_TYPES.join(', ')}`);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (plan_name != null && (typeof plan_name !== 'string' || plan_name.length > 256)) {
    throw new Error('plan_name must be a string <= 256 chars');
  }

  const metadataStr = metadata
    ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata))
    : null;

  if (metadataStr && metadataStr.length > 10000) {
    throw new Error('metadata too large (max 10KB)');
  }

  const crypto = await import('node:crypto');
  const id = `conn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const rows = await sql`
    INSERT INTO agent_connections (id, org_id, agent_id, provider, auth_type, plan_name, status, metadata, reported_at, updated_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${provider}, ${auth_type}, ${plan_name}, ${status}, ${metadataStr}, ${now}, ${now})
    ON CONFLICT (org_id, agent_id, provider) DO UPDATE SET
      auth_type = EXCLUDED.auth_type,
      plan_name = EXCLUDED.plan_name,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;

  return rows[0];
}

/**
 * Batch upsert connections
 */
export async function upsertConnections(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  connections: ConnectionInput[]
): Promise<{ results: Record<string, unknown>[]; errors: { provider: unknown; error: string }[] }> {
  if (!agentId || typeof agentId !== 'string' || agentId.length > 128) {
    throw new Error('agent_id is required and must be <= 128 chars');
  }
  if (!Array.isArray(connections) || connections.length === 0) {
    throw new Error('connections array is required and must not be empty');
  }
  if (connections.length > 50) {
    throw new Error('Maximum 50 connections per request');
  }

  const results: Record<string, unknown>[] = [];
  const errors: { provider: unknown; error: string }[] = [];

  for (const conn of connections) {
    try {
      const result = await upsertConnection(sql, orgId, agentId, conn);
      if (result) results.push(result);
    } catch (error) {
      errors.push({ provider: conn.provider, error: (error as Error).message });
    }
  }

  return { results, errors };
}
