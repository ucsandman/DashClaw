/**
 * Auth gate for /api/setup/migrate.
 *
 * Before first-run initialization the migrate endpoint is public so the
 * 8-minute bootstrap can run against an empty database. Once org_default
 * exists it must require an admin-scoped API key — otherwise any
 * unauthenticated POST could re-run DDL and reseed the org plan.
 */
import { createHash } from 'node:crypto';
import { timingSafeCompare } from '../timing-safe';

export async function isAlreadyInitialized(sql: any): Promise<boolean> {
  try {
    const rows = await sql`SELECT 1 FROM organizations WHERE id = 'org_default' LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function isAuthorizedSetupWriter(sql: any, request: Request): Promise<boolean> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return false;

  const envKey = process.env.DASHCLAW_API_KEY;
  if (envKey && timingSafeCompare(token, envKey)) return true;

  try {
    const hash = createHash('sha256').update(token).digest('hex');
    // Reject revoked keys: without `revoked_at IS NULL` a previously-issued
    // admin key that the operator already revoked would still satisfy the
    // post-init re-migration gate, defeating the whole point of revocation.
    const rows = await sql`
      SELECT role FROM api_keys
      WHERE key_hash = ${hash} AND revoked_at IS NULL
      LIMIT 1
    `;
    return rows.length > 0 && rows[0].role === 'admin';
  } catch {
    return false;
  }
}
