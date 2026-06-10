export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { ensureAgentPairingsTable } from '../../../lib/pairings';

function isPemPublicKey(s) {
  return typeof s === 'string' && s.includes('BEGIN PUBLIC KEY') && s.includes('END PUBLIC KEY');
}

export async function POST(request) {
  try {
    const sql = getSql();
    await ensureAgentPairingsTable(sql);

    const orgId = getOrgId(request);
    const body = await request.json();
    const agent_id = body.agent_id;
    const agent_name = body.agent_name || null;
    const public_key = body.public_key;
    const algorithm = body.algorithm || 'RSASSA-PKCS1-v1_5';

    if (!agent_id || typeof agent_id !== 'string') {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }
    if (!public_key || !isPemPublicKey(public_key)) {
      return NextResponse.json({ error: 'public_key must be a PEM public key' }, { status: 400 });
    }

    const id = `pair_${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const rows = await sql`
      INSERT INTO agent_pairings (id, org_id, agent_id, agent_name, public_key, algorithm, status, expires_at)
      VALUES (${id}, ${orgId}, ${agent_id}, ${agent_name}, ${public_key}, ${algorithm}, 'pending', ${expiresAt})
      RETURNING id, agent_id, agent_name, algorithm, status, created_at, expires_at
    `;

    const u = new URL(request.url);
    u.pathname = `/pair/${id}`;
    u.search = '';

    return NextResponse.json({
      pairing: rows[0],
      pairing_url: u.toString(),
    });
  } catch (error) {
    console.error('Pairing create error:', error);
    return NextResponse.json({ error: 'Failed to create pairing' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const sql = getSql();
    await ensureAgentPairingsTable(sql);

    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    const rows = await sql`
      SELECT id, agent_id, agent_name, algorithm, status, created_at, updated_at, expires_at
      FROM agent_pairings
      WHERE org_id = ${orgId} AND status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({ pairings: rows });
  } catch (error) {
    console.error('Pairings list error:', error);
    return NextResponse.json({ error: 'Failed to list pairings' }, { status: 500 });
  }
}

