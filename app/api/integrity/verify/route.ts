export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getServerPublicJwks } from '../../../lib/integrity/server-key';
import { verifyReceipt } from '../../../lib/integrity/receipt';
import { verifyBundle } from '../../../lib/integrity/bundle';

/**
 * POST /api/integrity/verify — independently re-verify a proof receipt or a
 * signed compliance bundle against the instance's published public key(s).
 * Public (no API key): anyone holding a receipt/bundle should be able to verify
 * its integrity. Stateless — it does not read the original record.
 *
 * Body: { receipt } OR { bundle }
 * Returns: { ok, kid?, reason? } — bundles also echo { prevBundleHash } (the
 * single back-link; verifying the whole chain means walking successive exports).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { keys } = await getServerPublicJwks(getSql());

    if (body && body.receipt) {
      return NextResponse.json(verifyReceiptAgainstJwks(body.receipt, keys));
    }
    if (body && body.bundle) {
      return NextResponse.json(verifyBundle(body.bundle, keys));
    }
    return NextResponse.json(
      { ok: false, error: 'Provide a `receipt` or a `bundle` to verify.' },
      { status: 400 },
    );
  } catch (err) {
    console.error('[integrity/verify] POST error:', err);
    // Fail-closed: any error is a non-verification, not a 500.
    return NextResponse.json({ ok: false, reason: 'verification_error' }, { status: 200 });
  }
}

/**
 * Verify a receipt against a JWKS: prefer the key whose kid matches the
 * receipt's signature, fall back to trying every published key.
 */
function verifyReceiptAgainstJwks(receipt: any, keys: any) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { ok: false, reason: 'no_published_keys' };
  }
  const kid = receipt?.signature?.kid;
  const matched = kid ? keys.filter((k: any) => k.kid === kid) : [];
  const candidates = matched.length > 0 ? matched : keys;
  for (const k of candidates) {
    const r = verifyReceipt(receipt, k);
    if (r.ok) return { ok: true, kid: k.kid };
  }
  return { ok: false, reason: 'no_matching_key_or_bad_signature' };
}
