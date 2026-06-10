export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import crypto from 'crypto';

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  const random = crypto.randomBytes(16).toString('hex');
  return `oc_live_${random}`;
}

// POST /api/onboarding/api-key — generate API key for user's workspace
export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { label = 'My Agent Key' } = body;

    if (label && label.length > 256) {
      return NextResponse.json({ error: 'label must be 256 characters or fewer' }, { status: 400 });
    }

    const sql = getSql();

    // Look up user's current org from DB (bypasses potentially stale JWT)
    const users = await sql`
      SELECT id, org_id FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (users.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const orgId = users[0].org_id;
    if (orgId === 'org_default') {
      return NextResponse.json({ error: 'Create a workspace first' }, { status: 400 });
    }

    // Verify org exists
    const orgs = await sql`SELECT id FROM organizations WHERE id = ${orgId}`;
    if (orgs.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // SECURITY: Check API key quota (same as POST /api/keys)
    // OSS edition defaults to Infinity, but keep correct call signature for future enforcement.
    const { getOrgPlan, checkQuotaFast } = require('../../../../lib/usage');
    const plan = await getOrgPlan(orgId, sql);
    const quotaCheck = await checkQuotaFast(orgId, 'api_keys', plan, sql);
    if (!quotaCheck.allowed) {
      return NextResponse.json({ error: 'API key quota exceeded', code: 'QUOTA_EXCEEDED', usage: quotaCheck.usage, limit: quotaCheck.limit }, { status: 402 });
    }

    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const keyId = `key_${crypto.randomUUID()}`;

    await sql`
      INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
      VALUES (${keyId}, ${orgId}, ${keyHash}, ${keyPrefix}, ${label}, 'admin')
    `;

    return NextResponse.json({
      key: {
        id: keyId,
        raw_key: rawKey,
        prefix: keyPrefix,
        label,
        warning: 'Save this key now. It will not be shown again.',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Onboarding api-key error:', error);
    return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 });
  }
}
