export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import {
  findOrgId,
  listApiKeys,
  insertApiKey,
  findApiKeyById,
  revokeApiKey,
} from '../../../../lib/repositories/orgs.repository';
import crypto from 'crypto';
import { API_KEY_ROLES, isValidApiKeyRole } from '../../../../lib/apiKeyRoles';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `oc_live_${random}`;
}

// GET /api/orgs/[orgId]/keys - List API keys (prefix only, admin only)
export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    const sql = getSql();
    const { orgId } = await params;

    // SECURITY: Only allow accessing your own org's keys
    const callerOrgId = getOrgId(request);
    if (orgId !== callerOrgId) {
      return NextResponse.json({ error: 'Forbidden - cannot access other organizations' }, { status: 403 });
    }

    // Verify org exists
    const org = await findOrgId(sql, orgId);
    if (org.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Return keys without the hash (security)
    const keys = await listApiKeys(sql, orgId);

    return NextResponse.json({ keys });
  } catch (error) {
    console.error('Keys API GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching API keys' }, { status: 500 });
  }
}

// POST /api/orgs/[orgId]/keys - Generate new API key (admin only)
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    const sql = getSql();
    const { orgId } = await params;

    // SECURITY: Only allow generating keys for your own org
    const callerOrgId = getOrgId(request);
    if (orgId !== callerOrgId) {
      return NextResponse.json({ error: 'Forbidden - cannot access other organizations' }, { status: 403 });
    }

    const body = await request.json();

    // Verify org exists
    const org = await findOrgId(sql, orgId);
    if (org.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const { label = 'API Key', role: keyRole = 'member' } = body;

    if (label && label.length > 256) {
      return NextResponse.json({ error: 'label must be 256 characters or fewer' }, { status: 400 });
    }

    // Must match the shared allowlist (mirrors the api_keys_role_check DB
    // constraint) or an accepted role here 500s on insert instead of 400ing.
    if (!isValidApiKeyRole(keyRole)) {
      return NextResponse.json({ error: `role must be one of: ${API_KEY_ROLES.join(', ')}` }, { status: 400 });
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const keyId = `key_${crypto.randomUUID()}`;

    await insertApiKey(sql, { keyId, orgId, keyHash, keyPrefix, label, role: keyRole });

    return NextResponse.json({
      key: {
        id: keyId,
        key: rawKey,
        prefix: keyPrefix,
        label,
        role: keyRole,
        warning: 'Save this key now. It will not be shown again.'
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Keys API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while generating the API key' }, { status: 500 });
  }
}

// DELETE /api/orgs/[orgId]/keys?id=key_xxx - Revoke an API key (admin only)
export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    const sql = getSql();
    const { orgId } = await params;

    // SECURITY: Only allow revoking keys for your own org
    const callerOrgId = getOrgId(request);
    if (orgId !== callerOrgId) {
      return NextResponse.json({ error: 'Forbidden - cannot access other organizations' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');

    if (!keyId) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const existing = await findApiKeyById(sql, keyId, orgId);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
    if (existing[0]!.revoked_at) {
      return NextResponse.json({ error: 'API key is already revoked' }, { status: 409 });
    }

    await revokeApiKey(sql, keyId, orgId);

    return NextResponse.json({ success: true, revoked: keyId });
  } catch (error) {
    console.error('Keys API DELETE error:', error);
    return NextResponse.json({ error: 'An error occurred while revoking the API key' }, { status: 500 });
  }
}
