export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { deleteIdentity } from '../../../lib/repositories/identities.repository';
import { expirePendingByAgent } from '../../../lib/repositories/pairings.repository';

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { agentId } = await params;
    const sql = getSql();

    const deleted = await deleteIdentity(sql, orgId, agentId);
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
    }

    // Expire any pending pairings for this agent
    await expirePendingByAgent(sql, orgId, agentId);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Identity revoke error:', error);
    return NextResponse.json({ error: 'Failed to revoke identity' }, { status: 500 });
  }
}
