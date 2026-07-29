export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole } from '../../lib/org';
import { createPairing, listPairings } from '../../lib/repositories/pairings.repository';

function isPemPublicKey(s: unknown): boolean {
  return typeof s === 'string' && s.includes('BEGIN PUBLIC KEY') && s.includes('END PUBLIC KEY');
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
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
    // TTL is configurable (default 15 min) so admin enrollment flows where the
    // approver isn't standing by aren't forced into a too-short window.
    const ttlMinutes = Math.max(1, parseInt(process.env.DASHCLAW_PAIRING_TTL_MINUTES || '15', 10) || 15);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    const rows = await createPairing(sql, {
      orgId, id, agentId: agent_id, agentName: agent_name,
      publicKey: public_key, algorithm, expiresAt,
    });

    const u = new URL(request.url);
    u.pathname = `/pair/${id}`;
    u.search = '';

    return NextResponse.json({ pairing: rows[0], pairing_url: u.toString() });
  } catch (error) {
    console.error('Pairing create error:', error);
    return NextResponse.json({ error: 'Failed to create pairing' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);

    const rows = await listPairings(sql, orgId, status, limit);
    return NextResponse.json({ pairings: rows });
  } catch (error) {
    console.error('Pairings list error:', error);
    return NextResponse.json({ error: 'Failed to list pairings' }, { status: 500 });
  }
}
