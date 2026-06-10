export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole } from '../../lib/org';
import { upsertIdentity, listIdentities } from '../../lib/repositories/identities.repository';

function isPemPublicKey(s: unknown): boolean {
  return typeof s === 'string' && s.includes('BEGIN PUBLIC KEY') && s.includes('END PUBLIC KEY');
}

export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { agent_id, public_key, algorithm } = body;

    if (!agent_id || !public_key) {
      return NextResponse.json({ error: 'agent_id and public_key are required' }, { status: 400 });
    }
    if (!isPemPublicKey(public_key)) {
      return NextResponse.json({ error: 'public_key must be a PEM public key' }, { status: 400 });
    }

    const sql = getSql();
    const result = await upsertIdentity(sql, { orgId, agentId: agent_id, publicKey: public_key, algorithm });
    return NextResponse.json({ identity: result[0] });
  } catch (error) {
    console.error('Identity registration error:', error);
    return NextResponse.json({ error: 'Failed to register identity' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const sql = getSql();
    const identities = await listIdentities(sql, orgId);
    return NextResponse.json({ identities });
  } catch (error) {
    console.error('Identity fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch identities' }, { status: 500 });
  }
}
