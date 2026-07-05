// Organizations repository — centralises all SQL for the organizations and
// api_keys tables used by the /api/orgs routes. Routes pass their getSql()
// instance in; query text is unchanged from the former inline route SQL.
import type { SqlTag } from '../types/db';

/**
 * List a single org (the caller's own) with its active key count.
 * SECURITY: scoped to the caller's org; billing identifiers are not selected.
 */
export async function listOrgWithActiveKeys(
  sql: SqlTag,
  callerOrgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, name, slug, plan, created_at, updated_at,
        (SELECT COUNT(*) FROM api_keys WHERE org_id = organizations.id AND revoked_at IS NULL) as active_keys
      FROM organizations
      WHERE id = ${callerOrgId}
      ORDER BY created_at DESC
    `;
}

/** Insert a new organization, returning the created row. */
export async function insertOrganization(
  sql: SqlTag,
  params: { orgId: string; name: string; slug: string; plan: string },
): Promise<Record<string, unknown>[]> {
  const { orgId, name, slug, plan } = params;
  return sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${orgId}, ${name}, ${slug}, ${plan})
      RETURNING *
    `;
}

/** Insert an API key. */
export async function insertApiKey(
  sql: SqlTag,
  params: {
    keyId: string;
    orgId: string;
    keyHash: string;
    keyPrefix: string;
    label: string;
    role: string;
  },
): Promise<void> {
  const { keyId, orgId, keyHash, keyPrefix, label, role } = params;
  await sql`
      INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
      VALUES (${keyId}, ${orgId}, ${keyHash}, ${keyPrefix}, ${label}, ${role})
    `;
}

/** Fetch an org's public detail columns by id. */
export async function getOrgById(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, name, slug, plan, created_at, updated_at
      FROM organizations
      WHERE id = ${orgId}
    `;
}

/** Count active (non-revoked) API keys for an org. */
export async function countActiveKeys(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT COUNT(*) as total FROM api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL
    `;
}

/** Fetch an org id (existence check). */
export async function findOrgId(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`SELECT id FROM organizations WHERE id = ${orgId}`;
}

/** Update an org's name, returning the updated row. */
export async function updateOrganizationName(
  sql: SqlTag,
  orgId: string,
  name: string | null,
): Promise<Record<string, unknown>[]> {
  return sql`
      UPDATE organizations
      SET name = COALESCE(${name}, name),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${orgId}
      RETURNING *
    `;
}

/** List API keys for an org (hash excluded). */
export async function listApiKeys(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, key_prefix, label, role, last_used_at, created_at, revoked_at
      FROM api_keys
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `;
}

/** Fetch an API key's id + revoked_at scoped to an org. */
export async function findApiKeyById(
  sql: SqlTag,
  keyId: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return sql`
      SELECT id, revoked_at FROM api_keys WHERE id = ${keyId} AND org_id = ${orgId}
    `;
}

/** Revoke an API key scoped to an org. */
export async function revokeApiKey(
  sql: SqlTag,
  keyId: string,
  orgId: string,
): Promise<void> {
  await sql`
      UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ${keyId} AND org_id = ${orgId}
    `;
}
