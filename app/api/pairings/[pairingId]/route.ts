export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { getPairing, expirePairing, updatePairing } from '../../../lib/repositories/pairings.repository';

const VALID_PERMISSION_LEVELS = ['readonly', 'workspace_write', 'danger', 'prompt', 'allow'];
// Statuses PATCH may set. 'approved' is deliberately ABSENT: approval must go
// through POST /approve, the only path that writes the agent_identities row —
// a PATCH-approved pairing would vanish from Pending while leaving the agent
// unverified forever.
const PATCHABLE_STATUSES = ['pending', 'expired'];

export async function GET(request: Request, { params }: { params: Promise<{ pairingId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { pairingId } = await params;

    const rows = await getPairing(sql, orgId, pairingId);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pairing not found' }, { status: 404 });
    }

    const pairing = rows[0] as Record<string, any>;
    const expired = pairing.expires_at ? new Date(pairing.expires_at as string | number | Date).getTime() < Date.now() : false;

    if (expired && pairing.status === 'pending') {
      await expirePairing(sql, orgId, pairingId);
      pairing.status = 'expired';
    }

    // Strip public_key from response — non-admin callers don't need it
    const { public_key: _pk, ...safePairing } = pairing;
    return NextResponse.json({ pairing: safePairing });
  } catch (error) {
    console.error('Pairing fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch pairing' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ pairingId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    // Same admin gate as GET-list and POST /approve — pairing mutation is an
    // identity-trust operation and must not be open to any org API caller.
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const { pairingId } = await params;
    const body = await request.json();

    const { status, permission_level } = body;

    // At least one update field must be present
    if (!status && !permission_level) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    if (status && !PATCHABLE_STATUSES.includes(status)) {
      const hint = status === 'approved'
        ? ' Use POST /api/pairings/{id}/approve — approval creates the agent identity.'
        : '';
      return NextResponse.json(
        { error: `Invalid status. PATCH may set: ${PATCHABLE_STATUSES.join(', ')}.${hint}` },
        { status: 400 }
      );
    }

    // Validate permission_level if provided
    if (permission_level && !VALID_PERMISSION_LEVELS.includes(permission_level)) {
      return NextResponse.json(
        { error: `Invalid permission_level. Must be one of: ${VALID_PERMISSION_LEVELS.join(', ')}` },
        { status: 400 }
      );
    }

    const pairing = await updatePairing(sql, orgId, pairingId, { status, permission_level });

    if (!pairing) {
      return NextResponse.json({ error: 'Pairing not found' }, { status: 404 });
    }

    return NextResponse.json({ pairing });
  } catch (error) {
    console.error('Pairing update error:', error);
    return NextResponse.json({ error: 'Failed to update pairing' }, { status: 500 });
  }
}
