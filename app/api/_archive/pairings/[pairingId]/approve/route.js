export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../../lib/org';
import { ensureAgentPairingsTable } from '../../../../../lib/pairings';

export async function POST(request, { params }) {
  try {
    const sql = getSql();
    await ensureAgentPairingsTable(sql);

    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { pairingId } = await params;

    const rows = await sql`
      SELECT id, agent_id, agent_name, public_key, algorithm, status, expires_at
      FROM agent_pairings
      WHERE org_id = ${orgId} AND id = ${pairingId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pairing not found' }, { status: 404 });
    }

    const pairing = rows[0];
    const expired = pairing.expires_at ? new Date(pairing.expires_at).getTime() < Date.now() : false;
    if (expired) {
      await sql`
        UPDATE agent_pairings
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE org_id = ${orgId} AND id = ${pairingId}
      `;
      return NextResponse.json({ error: 'Pairing expired' }, { status: 410 });
    }

    if (pairing.status !== 'pending') {
      return NextResponse.json({ error: `Pairing is not pending (status=${pairing.status})` }, { status: 409 });
    }

    const identityRows = await sql`
      INSERT INTO agent_identities (org_id, agent_id, public_key, algorithm)
      VALUES (${orgId}, ${pairing.agent_id}, ${pairing.public_key}, ${pairing.algorithm || 'RSASSA-PKCS1-v1_5'})
      ON CONFLICT (org_id, agent_id) DO UPDATE
      SET public_key = EXCLUDED.public_key,
          algorithm = EXCLUDED.algorithm,
          updated_at = CURRENT_TIMESTAMP
      RETURNING agent_id, algorithm, created_at, updated_at
    `;

    await sql`
      UPDATE agent_pairings
      SET status = 'approved', updated_at = CURRENT_TIMESTAMP
      WHERE org_id = ${orgId} AND id = ${pairingId}
    `;

    return NextResponse.json({ identity: identityRows[0] });
  } catch (error) {
    console.error('Pairing approve error:', error);
    return NextResponse.json({ error: 'Failed to approve pairing' }, { status: 500 });
  }
}

