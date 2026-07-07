export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole } from '../../lib/org';
import { denyTrialPrincipal } from '../../lib/hosted/trial-principal';
import {
  listOrgWithActiveKeys,
  insertOrganization,
  insertApiKey,
} from '../../lib/repositories/orgs.repository';
import crypto from 'crypto';

// Hash API key using Node crypto (server-side)
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Generate a new API key: oc_live_{32 hex chars}
function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `oc_live_${random}`;
}

// GET /api/orgs - List organizations (admin only)
export async function GET(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    const sql = getSql();
    const callerOrgId = getOrgId(request);

    // SECURITY: Only return the caller's own org (not all orgs).
    // Avoid returning sensitive billing identifiers (stripe_*) unless strictly necessary.
    const orgs = await listOrgWithActiveKeys(sql, callerOrgId);

    return NextResponse.json({ organizations: orgs });
  } catch (error) {
    console.error('Orgs API GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching organizations' }, { status: 500 });
  }
}

// POST /api/orgs - Create organization + first API key (admin only)
export async function POST(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    // SECURITY (v5.1): tenant creation is an operator power. A hosted-trial
    // session is admin of its own capped, expiring org — but the org it would
    // create here has no hosted_mode, no cap, no expiry, and returns a raw
    // admin key. Without this gate a stranger could mint one Turnstile-gated
    // trial and convert it into unlimited permanent uncapped orgs, escaping
    // every trial control. No-op on self-host (no trial principals).
    const trialDenied = await denyTrialPrincipal(request);
    if (trialDenied) return trialDenied;

    const sql = getSql();
    const body = await request.json();

    // SECURITY: Ignore 'plan' from user input. New orgs always start on 'free'.
    // Use Stripe webhooks or an internal service to upgrade plans.
    const { name, slug } = body;
    const plan = 'free';

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!slug || typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: 'slug is required and must be lowercase alphanumeric with hyphens' }, { status: 400 });
    }
    if (slug.length > 64) {
      return NextResponse.json({ error: 'slug must be 64 characters or fewer' }, { status: 400 });
    }
    if (name.length > 256) {
      return NextResponse.json({ error: 'name must be 256 characters or fewer' }, { status: 400 });
    }

    const orgId = `org_${crypto.randomUUID()}`;

    // Create the organization
    const orgResult = await insertOrganization(sql, { orgId, name: name.trim(), slug, plan });

    // Generate first admin API key
    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const keyId = `key_${crypto.randomUUID()}`;

    await insertApiKey(sql, { keyId, orgId, keyHash, keyPrefix, label: 'Admin Key', role: 'admin' });

    return NextResponse.json({
      organization: orgResult[0],
      api_key: {
        id: keyId,
        key: rawKey,
        prefix: keyPrefix,
        role: 'admin',
        warning: 'Save this key now. It will not be shown again.'
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Orgs API POST error:', error);
    if ((error as Error).message?.includes('unique') || (error as Error).message?.includes('duplicate')) {
      return NextResponse.json({ error: 'An organization with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'An error occurred while creating the organization' }, { status: 500 });
  }
}
