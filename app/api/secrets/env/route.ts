import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { logActivity } from '../../../lib/audit';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getDeliverableSecrets } from '../../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/secrets/env?agent_id=X — deliver the decrypted env bundle for an
 * agent: every secret with delivery_enabled = 1 AND a stored value, org-wide
 * merged with agent-specific (agent-specific wins per name).
 *
 * SECURITY:
 * - API-key principals ONLY. Browser sessions (even admins) can NEVER read
 *   values — managed secrets are write-only for humans; the bundle exists
 *   solely for agent process startup. Detection mirrors /api/settings:
 *   presence of the x-api-key header (middleware authenticates it; a browser
 *   session never carries one).
 * - Every delivery is audit-logged with agent_id + secret NAMES, never values.
 * - One corrupt row never fails the bundle (repository skips + logs the name).
 */
export async function GET(req: Request) {
  try {
    // FAIL CLOSED: without ENCRYPTION_KEY in production nothing can decrypt;
    // return an explicit 503 instead of silently delivering an empty bundle.
    if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: 'Server misconfigured: ENCRYPTION_KEY is required in production to deliver secret values.' },
        { status: 503 }
      );
    }

    const isApiKeyRequest = !!req.headers.get('x-api-key');
    if (!isApiKeyRequest) {
      return NextResponse.json(
        {
          error: 'Secret delivery requires an API-key principal. Managed secret values are write-only for browser sessions — they are delivered only to agent processes authenticating with an API key.',
        },
        { status: 403 }
      );
    }

    // readonly keys are metadata-only principals — they must not pull live
    // plaintext (security-review hardening; middleware only blocks readonly
    // on non-GET methods, and this is a GET).
    if (getOrgRole(req) === 'readonly') {
      return NextResponse.json(
        { error: 'Readonly API keys cannot retrieve secret values' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

    const sql = getSql();
    const orgId = getOrgId(req);

    const secrets = await getDeliverableSecrets(sql, orgId, agentId);

    const env: Record<string, string> = {};
    const delivered: string[] = [];
    for (const { name, value } of secrets) {
      env[name] = value;
      delivered.push(name);
    }

    // Audit names + agent only — NEVER values.
    logActivity({
      orgId,
      actorId: getUserId(req) || agentId,
      actorType: 'api_key',
      action: 'secret.delivered',
      resourceType: 'secret',
      details: { agent_id: agentId, names: delivered, count: delivered.length },
      request: req,
    }, sql);

    return NextResponse.json({ env, count: delivered.length, delivered });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_ENV_GET');
  }
}
