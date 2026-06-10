import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../../lib/org';
import { logActivity } from '../../../../lib/audit';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getSecret,
  setSecretValue,
  clearSecretValue,
  setDeliveryEnabled,
  isEnvSafeName,
} from '../../../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_VALUE_LENGTH = 8192;

/**
 * POST /api/secrets/[id]/value — set, clear, or configure delivery for a
 * managed secret value. Admin only. WRITE-ONLY: the response NEVER echoes
 * the value, and no read path for the plaintext exists anywhere (not even
 * for admins) — the only consumer is the API-key-authed delivery endpoint.
 *
 * Body:
 *   { value: "plaintext" }            set (1..8192 chars)
 *   { value: null }                   clear
 *   optional { delivery_enabled: boolean } rider on either, or alone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // FAIL CLOSED: without ENCRYPTION_KEY in production we must not accept
    // values (mirrors /api/settings).
    if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: 'Server misconfigured: ENCRYPTION_KEY is required in production to protect secret values.' },
        { status: 503 }
      );
    }

    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    // Admin gate: middleware sets x-org-role server-side from api_keys.role;
    // inbound spoofed headers are stripped.
    if (getOrgRole(req) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to manage secret values' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const hasValueField = body.value !== undefined;
    const hasDeliveryField = body.delivery_enabled !== undefined;

    if (!hasValueField && !hasDeliveryField) {
      return NextResponse.json(
        { error: 'Provide value (string to set, null to clear) and/or delivery_enabled (boolean)' },
        { status: 400 }
      );
    }
    if (hasValueField && body.value !== null &&
        (typeof body.value !== 'string' || body.value.length < 1 || body.value.length > MAX_VALUE_LENGTH)) {
      return NextResponse.json(
        { error: `value must be null or a string of 1..${MAX_VALUE_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (hasDeliveryField && typeof body.delivery_enabled !== 'boolean') {
      return NextResponse.json({ error: 'delivery_enabled must be a boolean' }, { status: 400 });
    }

    const secret = await getSecret(sql, orgId, id);
    if (!secret) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // Delivered values become process env vars — the name must be env-safe.
    if (body.delivery_enabled === true && !isEnvSafeName(secret.name)) {
      return NextResponse.json(
        { error: 'Secret name must match ^[A-Za-z_][A-Za-z0-9_]{0,127}$ to enable delivery (it becomes an environment variable name)' },
        { status: 400 }
      );
    }

    const actorId = getUserId(req) || 'unknown';
    let valueSetAt: unknown = secret.value_set_at ?? null;

    if (hasValueField) {
      const row = body.value === null
        ? await clearSecretValue(sql, orgId, id)
        : await setSecretValue(sql, orgId, id, body.value);
      if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      valueSetAt = body.value === null ? null : (row.value_set_at ?? null);

      // Audit names + ids only — NEVER values.
      logActivity({
        orgId, actorId, action: body.value === null ? 'secret.value_cleared' : 'secret.value_set',
        resourceType: 'secret', resourceId: id,
        details: { name: secret.name, id }, request: req,
      }, sql);
    }

    if (hasDeliveryField) {
      const row = await setDeliveryEnabled(sql, orgId, id, body.delivery_enabled);
      if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

      logActivity({
        orgId, actorId, action: 'secret.delivery_changed',
        resourceType: 'secret', resourceId: id,
        details: { name: secret.name, id, delivery_enabled: body.delivery_enabled }, request: req,
      }, sql);
    }

    // Response NEVER echoes the value.
    return NextResponse.json({
      id,
      name: secret.name,
      has_value: hasValueField ? body.value !== null : secret.has_value === true,
      delivery_enabled: hasDeliveryField
        ? (body.delivery_enabled ? 1 : 0)
        : Number(secret.delivery_enabled ?? 0),
      value_set_at: valueSetAt,
    });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_VALUE_POST');
  }
}
