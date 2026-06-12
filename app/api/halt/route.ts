export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { logActivity } from '../../lib/audit';
import { getSettings, upsertSetting } from '../../lib/repositories/settings.repository';
import { invalidateGuardSettingsCache } from '../../lib/guard';

const HALT_KEY = 'DASHCLAW_ORG_HALT';

interface HaltState {
  halted: boolean;
  actor: string | null;
  reason: string | null;
  at: string | null;
}

const NOT_HALTED: HaltState = { halted: false, actor: null, reason: null, at: null };

function parseHaltValue(value: unknown): HaltState {
  if (typeof value !== 'string' || !value) return NOT_HALTED;
  try {
    const parsed = JSON.parse(value) as Partial<HaltState>;
    if (!parsed || typeof parsed !== 'object') return NOT_HALTED;
    return {
      halted: !!parsed.halted,
      actor: parsed.actor ?? null,
      reason: parsed.reason ?? null,
      at: parsed.at ?? null,
    };
  } catch {
    return NOT_HALTED;
  }
}

/**
 * GET /api/halt — current org kill-switch state (admin only).
 *
 * Returns { halt: { halted, actor, reason, at } }.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const sql = getSql();
    const rows = await getSettings(sql, orgId, { key: HALT_KEY });
    const value = (rows as Array<Record<string, unknown>>).find((r) => r.key === HALT_KEY)?.value;
    return NextResponse.json({ halt: parseHaltValue(value) });
  } catch (err) {
    return apiErrorResponse(err, 'HALT GET');
  }
}

/**
 * POST /api/halt — set or clear the org kill switch (admin only).
 * Body: { halted: boolean, reason?: string }
 *
 * While halted, EVERY guard evaluation for the org returns an immediate
 * block (hook, MCP, SDK, API — anything that goes through evaluateGuard),
 * each still persisted as an audited guard decision. The settings cache is
 * invalidated eagerly so the switch takes effect immediately, not after the
 * ~30s guard cache TTL. Both transitions write an activity_logs audit row.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as { halted?: unknown; reason?: unknown };
    if (typeof body.halted !== 'boolean') {
      return NextResponse.json({ error: 'halted must be a boolean' }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null;
    const actor = getUserId(request) || 'admin';
    const state: HaltState = {
      halted: body.halted,
      actor,
      reason,
      at: new Date().toISOString(),
    };

    const sql = getSql();
    await upsertSetting(sql, orgId, {
      key: HALT_KEY,
      value: JSON.stringify(state),
      // 'general' on purpose: the guard hot path piggybacks the halt read on
      // its existing category-general cached settings query (one read per org
      // per TTL window) — a different category would force a second query.
      category: 'general',
    });
    // Eager invalidation: the kill switch must not lag the cache TTL.
    invalidateGuardSettingsCache(orgId);

    logActivity({
      orgId,
      actorId: actor,
      action: body.halted ? 'org.halted' : 'org.resumed',
      resourceType: 'setting',
      resourceId: HALT_KEY,
      details: { reason, at: state.at },
      request,
    }, sql);

    return NextResponse.json({ ok: true, halt: state });
  } catch (err) {
    return apiErrorResponse(err, 'HALT POST');
  }
}
