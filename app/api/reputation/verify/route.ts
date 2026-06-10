export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getServerPublicJwks } from '../../../lib/integrity/server-key';
import { verifyReputationReceipt } from '../../../lib/reputation';

/**
 * POST /api/reputation/verify — verify a posted reputation receipt against the
 * instance's published signing keys. Body: { receipt }. The vector hash is
 * checked constant-time and the Ed25519 signature is verified via the integrity
 * layer. Always returns HTTP 200 with { ok, reason? } (a non-verification is
 * not a server error).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const receipt = body?.receipt;
    if (!receipt || typeof receipt !== 'object') {
      return NextResponse.json({ ok: false, reason: 'missing_receipt' });
    }

    const sql = await getSql();
    const { keys } = await getServerPublicJwks(sql);
    if (!keys || keys.length === 0) {
      return NextResponse.json({ ok: false, reason: 'no_published_keys' });
    }

    const kid = receipt.signature?.kid;
    const ordered = kid ? [...keys].sort((a: object, b: object) => ((a as { kid?: string }).kid === kid ? -1 : (b as { kid?: string }).kid === kid ? 1 : 0)) : keys;

    let lastReason = 'bad_signature';
    for (const key of ordered) {
      const result = verifyReputationReceipt(receipt, key);
      if (result.ok) return NextResponse.json({ ok: true, kid: (key as { kid?: string }).kid });
      lastReason = result.reason || lastReason;
      if (result.reason === 'vector_hash_mismatch' || result.reason === 'malformed') {
        return NextResponse.json({ ok: false, reason: result.reason });
      }
    }
    return NextResponse.json({ ok: false, reason: lastReason });
  } catch (err) {
    console.error('[REPUTATION/VERIFY] POST error:', err);
    return NextResponse.json({ ok: false, reason: 'verification_error' });
  }
}
