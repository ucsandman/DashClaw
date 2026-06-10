import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { logActivity } from '../../lib/audit';
import { encrypt, decrypt } from '../../lib/encryption';
import {
  ensureSettingsTable,
  getSettings,
  upsertSetting,
  deleteSetting,
  maskValue,
  shouldAutoEncrypt,
  VALID_SETTING_KEYS,
  VALID_CATEGORIES
} from '../../lib/repositories/settings.repository';

export const dynamic = 'force-dynamic';

// GET - Fetch all settings or specific key
// When ?agent_id=X is provided, returns merged settings (agent overrides org defaults)
// When no agent_id, returns only org-level settings (agent_id IS NULL)
export async function GET(request: Request) {
  try {
    const sql = getSql();
    await ensureSettingsTable(sql);
    const orgId = getOrgId(request);

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const category = searchParams.get('category');
    const agentId = searchParams.get('agent_id');

    const settings = await getSettings(sql, orgId, { key: key ?? undefined, category: category ?? undefined, agentId: agentId ?? undefined });

    const isApiKeyRequest = !!request.headers.get('x-api-key');
    const role = getOrgRole(request);

    // SECURITY:
    // - Only admins using an API key can decrypt secrets.
    // - Browser sessions (admins or members) ALWAYS see masked values for sensitive keys.
    // - Members ALWAYS see masked values for EVERYTHING.
    const canDecrypt = isApiKeyRequest && role === 'admin';

    const processed = settings.map((s: any) => {
      let val = s.value;
      const sensitive = s.encrypted || shouldAutoEncrypt(s.key, false);
      const shouldMask = !canDecrypt && (sensitive || role !== 'admin');

      if (val !== undefined && val !== null) {
        if (s.encrypted && canDecrypt) {
          try {
            val = decrypt(val, `${orgId}:${s.key}`);
          } catch (err) {
            console.error('[SETTINGS] Decryption failed for key:', s.key);
            val = '[DECRYPTION_FAILED]';
          }
        } else if (shouldMask) {
          val = maskValue(val);
        }
      }

      return {
        ...s,
        value: val,
        hasValue: !!s.value
      };
    });

    return NextResponse.json({ settings: processed });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
  }
}

// POST - Create or update setting (admin only)
// Accepts optional agent_id in body for per-agent settings
export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: 'Server misconfigured: ENCRYPTION_KEY is required in production to protect sensitive settings.' },
        { status: 503 }
      );
    }

    const sql = getSql();
    await ensureSettingsTable(sql);
    const orgId = getOrgId(request);

    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to modify settings' }, { status: 403 });
    }

    const body = await request.json();
    let { key, value, category = 'general', encrypted = false, agent_id = null } = body;

    const shouldEncrypt = encrypted === true || encrypted === 'true';

    // SECURITY: Force encryption for sensitive keys if not already requested
    const isEncrypted = shouldAutoEncrypt(key, shouldEncrypt);

    let finalValue = value;
    // Prevent encrypting and overriding secrets with UI masked strings
    if (typeof value === 'string' && value.includes('••••••••')) {
      return NextResponse.json({ success: true, key, agent_id, skipped: true });
    }

    if (isEncrypted && value !== undefined && value !== null) {
      try {
        finalValue = encrypt(value, `${orgId}:${key}`);
      } catch (err) {
        console.error('[SETTINGS] Encryption failed:', (err as Error).message);
        return NextResponse.json({ error: 'Server configuration error: encryption failed' }, { status: 500 });
      }
    }

    await upsertSetting(sql, orgId, { key, value: finalValue, category, encrypted: isEncrypted, agent_id });

    logActivity({
      orgId, actorId: getUserId(request) || 'unknown', action: 'setting.updated',
      resourceType: 'setting', resourceId: key,
      details: { category, agent_id: agent_id || null }, request,
    }, sql);

    return NextResponse.json({ success: true, key, agent_id });
  } catch (error) {
    console.error('Settings POST error:', error);
    const status = (error as Error).message.includes('Invalid') || (error as Error).message.includes('required') ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message || 'An internal error occurred' }, { status });
  }
}

// DELETE - Remove a setting (admin only)
// When ?agent_id=X is provided, deletes agent-specific row only
// When no agent_id, deletes org-level row (agent_id IS NULL) only
export async function DELETE(request: Request) {
  try {
    const sql = getSql();
    await ensureSettingsTable(sql);
    const orgId = getOrgId(request);

    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to delete settings' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const agentId = searchParams.get('agent_id');

    await deleteSetting(sql, orgId, key as string, agentId);

    logActivity({
      orgId, actorId: getUserId(request) || 'unknown', action: 'setting.deleted',
      resourceType: 'setting', resourceId: key ?? undefined,
      details: { agent_id: agentId || null }, request,
    }, sql);

    return NextResponse.json({ success: true, deleted: key, agent_id: agentId || null });
  } catch (error) {
    console.error('Settings DELETE error:', error);
    const status = (error as Error).message.includes('required') ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message || 'An internal error occurred' }, { status });
  }
}
