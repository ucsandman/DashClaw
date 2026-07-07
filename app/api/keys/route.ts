export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { logActivity } from '../../lib/audit';
import { getSql } from '../../lib/db';
import crypto from 'crypto';
import { isSelfHostModeEnabled } from '../../lib/selfHost';
import { isValidApiKeyRole, API_KEY_ROLES } from '../../lib/apiKeyRoles';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `oc_live_${random}`;
}

// Store enough of the key to visually distinguish it in the dashboard.
// "oc_live_" is 8 chars and identical for every key, so we need at least
// 16 chars to show the first 8 unique hex digits after the prefix.
const KEY_PREFIX_LENGTH = 16;

// GET /api/keys - List API keys for the user's org
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    try {
      const keys = await sql`
        SELECT id, key_prefix, label, role, last_used_at, created_at, revoked_at
        FROM api_keys
        WHERE org_id = ${orgId}
        ORDER BY created_at DESC
      `;
      return NextResponse.json({ keys });
    } catch (dbErr) {
      // 42P01 = table not found — fresh self-host install before migration has run.
      // Self-host bypass: return empty list rather than crashing the dashboard.
      if ((dbErr as { code?: string }).code === '42P01' && isSelfHostModeEnabled()) {
        return NextResponse.json({ keys: [] });
      }
      throw dbErr;
    }
  } catch (error) {
    console.error('Keys API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
  }
}

// POST /api/keys - Generate a new API key (admin only)
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to generate API keys' }, { status: 403 });
    }

    const body = await request.json();
    // `role` defaults to 'member' (security review 2026-07-05): agent keys
    // must never be admin by accident — an admin key can approve its own
    // pending actions, defeating the human-approval gate. Callers that
    // genuinely need an admin key must say so explicitly.
    const { label = 'API Key', role = 'member' } = body;

    if (typeof label !== 'string' || label.length > 256) {
      return NextResponse.json({ error: 'Label must be a string of 256 characters or fewer' }, { status: 400 });
    }
    if (!isValidApiKeyRole(role)) {
      return NextResponse.json({ error: `role must be one of: ${API_KEY_ROLES.join(', ')}` }, { status: 400 });
    }

    const sql = getSql();

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
    const keyId = `key_${crypto.randomUUID()}`;

    await sql`
      INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
      VALUES (${keyId}, ${orgId}, ${keyHash}, ${keyPrefix}, ${label}, ${role})
    `;

    logActivity({
      orgId, actorId: getUserId(request) || 'unknown', action: 'key.created',
      resourceType: 'api_key', resourceId: keyId,
      details: { label, prefix: keyPrefix, role }, request,
    }, sql);

    return NextResponse.json({
      key: {
        id: keyId,
        raw_key: rawKey,
        prefix: keyPrefix,
        label,
        role,
        storageWarning: 'Store this key now. It will not be shown again.'
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Keys API POST error:', error);
    return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 });
  }
}

// DELETE /api/keys?id=key_xxx - Revoke an API key (admin only)
export async function DELETE(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to revoke API keys' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');

    if (!keyId || !keyId.startsWith('key_')) {
      return NextResponse.json({ error: 'Valid key id is required' }, { status: 400 });
    }

    const sql = getSql();
    const existing = await sql`
      SELECT id, revoked_at FROM api_keys WHERE id = ${keyId} AND org_id = ${orgId}
    `;

    if (existing.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
    if (existing[0]?.revoked_at) {
      return NextResponse.json({ error: 'API key is already revoked' }, { status: 409 });
    }

    await sql`
      UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ${keyId} AND org_id = ${orgId}
    `;

    // NOTE: middleware caches resolved API keys per-instance for up to 5 minutes
    // (API_KEY_CACHE_TTL in middleware.js). A just-revoked key can therefore still
    // authenticate against a warm serverless instance until that entry expires
    // (≤5 min). On the free-tier serverless design there is no shared/cross-instance
    // cache to invalidate from this Node route (middleware runs in a separate
    // runtime), so this propagation window is a known, bounded tradeoff — revocation
    // is immediate in the DB; only the in-memory cache lags. Same accepted staleness
    // as the trial-counter cache.

    logActivity({
      orgId, actorId: getUserId(request) || 'unknown', action: 'key.revoked',
      resourceType: 'api_key', resourceId: keyId, request,
    }, sql);

    return NextResponse.json({ success: true, revoked: keyId });
  } catch (error) {
    console.error('Keys API DELETE error:', error);
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 });
  }
}
