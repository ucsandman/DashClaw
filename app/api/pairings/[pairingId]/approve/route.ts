export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import { getPairing, expirePairing, approvePairing } from '../../../../lib/repositories/pairings.repository';
import { upsertIdentity } from '../../../../lib/repositories/identities.repository';

export async function POST(request: Request, { params }: { params: Promise<{ pairingId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { pairingId } = await params;

    const rows = await getPairing(sql, orgId, pairingId);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pairing not found' }, { status: 404 });
    }

    const pairing = rows[0] as Record<string, any>;
    const expired = pairing.expires_at ? new Date(pairing.expires_at as string | number | Date).getTime() < Date.now() : false;
    if (expired) {
      await expirePairing(sql, orgId, pairingId);
      return NextResponse.json({ error: 'Pairing expired' }, { status: 410 });
    }

    if (pairing.status !== 'pending') {
      return NextResponse.json({ error: `Pairing is not pending (status=${pairing.status})` }, { status: 409 });
    }

    const identityRows = await upsertIdentity(sql, {
      orgId,
      agentId: pairing.agent_id as string,
      publicKey: pairing.public_key as string,
      algorithm: (pairing.algorithm as string) || 'RSASSA-PKCS1-v1_5',
    });

    await approvePairing(sql, orgId, pairingId);

    return NextResponse.json({ identity: identityRows[0] });
  } catch (error) {
    console.error('Pairing approve error:', error);
    return NextResponse.json({ error: 'Failed to approve pairing' }, { status: 500 });
  }
}
