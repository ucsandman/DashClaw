import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { listSecrets, createSecret } from '../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    // Rows carry has_value/value_set_at/delivery_enabled — NEVER
    // value_encrypted or plaintext (write-only managed values).
    const rows = await listSecrets(sql, orgId, agentId ? { agentId } : {});
    return NextResponse.json({ secrets: rows });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_GET');
  }
}

export async function POST(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    // Server-side admin gate (middleware sets x-org-role from api_keys.role;
    // inbound spoofed headers are stripped). Previously client-side only.
    if (getOrgRole(req) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to create secrets' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    if (body.rotation_interval_days !== undefined && body.rotation_interval_days !== null) {
      const n = Number(body.rotation_interval_days);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: 'rotation_interval_days must be >= 1' }, { status: 400 });
      }
    }

    const result = await createSecret(sql, orgId, {
      name: body.name,
      agentId: body.agent_id || null,
      lastRotatedAt: body.last_rotated_at || null,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes || null,
    });

    return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_POST');
  }
}
