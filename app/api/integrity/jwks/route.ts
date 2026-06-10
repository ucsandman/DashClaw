export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getServerPublicJwks } from '../../../lib/integrity/server-key';

/**
 * GET /api/integrity/jwks — public JWKS for re-verifying DashClaw-issued proof
 * receipts and signed compliance bundles. Public (no API key): external
 * re-verifiers must be able to fetch the issuer's public key. Also reachable at
 * the standard /.well-known/jwks.json via a next.config rewrite.
 *
 * Only the public half of each key is ever served (no `d` member).
 */
export async function GET() {
  try {
    const sql = getSql();
    const jwks = await getServerPublicJwks(sql);
    const hasKeys = Array.isArray(jwks.keys) && jwks.keys.length > 0;
    return NextResponse.json(jwks, {
      status: 200,
      headers: {
        // Cache real key sets, but never an empty one: a fetch before the first
        // key is generated would otherwise pin `[]` at the edge for the full TTL
        // even after a key exists (mirrors jwks-verifier's "don't cache empty").
        'Cache-Control': hasKeys ? 'public, max-age=300' : 'no-store',
      },
    });
  } catch (err) {
    console.error('[integrity/jwks] GET error:', err);
    // Never 500 the JWKS — an empty set degrades verification gracefully.
    return NextResponse.json({ keys: [] }, { status: 200 });
  }
}
