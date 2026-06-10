export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { getSettings, upsertSetting, deleteSetting } from '../../../lib/repositories/settings.repository';

// Map a settings array to a {key: value} lookup.
function toMap(rows: Array<{ key: string; value: unknown }> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows || []) out[r.key] = r.value;
  return out;
}

function readConfig(map: Record<string, unknown>): { enabled: boolean; until: string | null; effective: boolean } {
  const enabled = String(map.BEHAVIOR_RECORDER_ENABLED || '').toLowerCase() === 'true';
  const until = (map.BEHAVIOR_RECORDER_UNTIL as string | null) || null;
  let expired = false;
  if (until) {
    const t = Date.parse(until);
    expired = Number.isFinite(t) && t <= Date.now();
  }
  return { enabled, until, effective: enabled && !expired };
}

/**
 * GET /api/behavior/recorder — current recorder config for this org.
 * The local agent hook polls this (cached per-process) to decide whether to
 * capture behavior samples. Returns { enabled, until, effective }. @beta
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const map = toMap(await getSettings(sql, orgId, { category: 'general' }) as Array<{ key: string; value: unknown }>);
    return NextResponse.json(readConfig(map));
  } catch (err) {
    console.error('[behavior/recorder] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/behavior/recorder — set recorder enablement + optional auto-stop
 * window (admin only). Body: { enabled: boolean, duration_days?: number|null }.
 * duration_days > 0 sets an auto-stop window; null/0 means "until turned off".
 */
export async function POST(request: Request) {
  try {
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));

    const enabled = body.enabled === true;
    const days = Number(body.duration_days);
    const hasWindow = enabled && Number.isFinite(days) && days > 0;
    const until = hasWindow ? new Date(Date.now() + days * 86400_000).toISOString() : null;

    await upsertSetting(sql, orgId, { key: 'BEHAVIOR_RECORDER_ENABLED', value: enabled ? 'true' : 'false', category: 'general' });
    if (until) {
      await upsertSetting(sql, orgId, { key: 'BEHAVIOR_RECORDER_UNTIL', value: until, category: 'general' });
    } else {
      await deleteSetting(sql, orgId, 'BEHAVIOR_RECORDER_UNTIL');
    }

    return NextResponse.json(readConfig({
      BEHAVIOR_RECORDER_ENABLED: enabled ? 'true' : 'false',
      BEHAVIOR_RECORDER_UNTIL: until,
    }));
  } catch (err) {
    console.error('[behavior/recorder] POST error:', (err as Error).message);
    const status = /Invalid setting key|Invalid category/.test((err as Error).message) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? (err as Error).message : 'Internal server error' }, { status });
  }
}
