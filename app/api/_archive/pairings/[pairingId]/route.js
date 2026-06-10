export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { ensureAgentPairingsTable } from '../../../../lib/pairings';

export async function GET(request, { params }) {
  try {
    const sql = getSql();
    await ensureAgentPairingsTable(sql);

    const orgId = getOrgId(request);
    const pairingId = params.pairingId;

    const rows = await sql`
      SELECT id, agent_id, agent_name, algorithm, status, created_at, updated_at, expires_at
      FROM agent_pairings
      WHERE org_id = ${orgId} AND id = ${pairingId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pairing not found' }, { status: 404 });
    }

    const pairing = rows[0];
    const expired = pairing.expires_at ? new Date(pairing.expires_at).getTime() < Date.now() : false;

    // Soft-expire pending rows on read.
    if (expired && pairing.status === 'pending') {
      await sql`
        UPDATE agent_pairings
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE org_id = ${orgId} AND id = ${pairingId}
      `;
      pairing.status = 'expired';
    }

    return NextResponse.json({ pairing });
  } catch (error) {
    console.error('Pairing fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch pairing' }, { status: 500 });
  }
}

