export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';

export async function POST(request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    
    // Only admins can register identities
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { agent_id, public_key, algorithm } = body;
    
    if (!agent_id || !public_key) {
      return NextResponse.json({ error: 'agent_id and public_key are required' }, { status: 400 });
    }

    const sql = getSql();
    
    const result = await sql`
      INSERT INTO agent_identities (org_id, agent_id, public_key, algorithm)
      VALUES (${orgId}, ${agent_id}, ${public_key}, ${algorithm || 'RSASSA-PKCS1-v1_5'})
      ON CONFLICT (org_id, agent_id) DO UPDATE 
      SET public_key = EXCLUDED.public_key, 
          algorithm = EXCLUDED.algorithm,
          updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return NextResponse.json({ identity: result[0] });
  } catch (error) {
    console.error('Identity registration error:', error);
    return NextResponse.json({ error: 'Failed to register identity' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    
    const identities = await sql`
      SELECT agent_id, algorithm, created_at, updated_at 
      FROM agent_identities 
      WHERE org_id = ${orgId}
      ORDER BY agent_id ASC
    `;

    return NextResponse.json({ identities });
  } catch (error) {
    console.error('Identity fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch identities' }, { status: 500 });
  }
}
