import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { updateSecret, deleteSecret } from '../../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// PATCH stays member-reachable on purpose: the MCP dashclaw_secret_mark_rotated
// tool is a designed agent surface. Value/delivery mutations must NOT ride
// PATCH — they are admin-only via POST /api/secrets/[id]/value.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    if (body.value !== undefined || body.delivery_enabled !== undefined) {
      return NextResponse.json(
        { error: 'value and delivery_enabled cannot be changed via PATCH; use POST /api/secrets/{id}/value (admin only)' },
        { status: 400 }
      );
    }

    const row = await updateSecret(sql, orgId, id, {
      lastRotatedAt: body.last_rotated_at,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes,
    });
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_PATCH');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    // Server-side admin gate (middleware sets x-org-role from api_keys.role;
    // inbound spoofed headers are stripped). Previously client-side only.
    if (getOrgRole(req) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to delete secrets' }, { status: 403 });
    }

    const ok = await deleteSecret(sql, orgId, id);
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_DELETE');
  }
}
