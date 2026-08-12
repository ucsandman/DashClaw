export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { logActivity } from '../../lib/audit';
import { getSettings, upsertSetting } from '../../lib/repositories/settings.repository';
import {
  APPROVAL_PAUSE_KEY,
  approvalPauseIsActive,
  invalidateGuardSettingsCache,
  type ApprovalPauseState,
} from '../../lib/guard';

/**
 * The windows the operator may choose. An allowlist, not a free number: an
 * unbounded pause is the 18-day June 2026 outage with extra steps, and a
 * typo'd 8760 would be indistinguishable from turning governance off for good.
 */
export const PAUSE_WINDOW_HOURS = [1, 4, 8, 24] as const;

interface PauseView {
  active: boolean;
  until: string | null;
  actor: string | null;
  reason: string | null;
  at: string | null;
  /** Drives the countdown on the surfaces without them re-deriving expiry. */
  remaining_seconds: number;
}

const NOT_PAUSED: PauseView = {
  active: false, until: null, actor: null, reason: null, at: null, remaining_seconds: 0,
};

function toView(state: ApprovalPauseState | null): PauseView {
  if (!approvalPauseIsActive(state)) return NOT_PAUSED;
  return {
    active: true,
    until: state.until,
    actor: state.actor ?? null,
    reason: state.reason ?? null,
    at: state.at ?? null,
    remaining_seconds: Math.max(0, Math.round((Date.parse(state.until) - Date.now()) / 1000)),
  };
}

async function readPause(sql: ReturnType<typeof getSql>, orgId: string): Promise<PauseView> {
  const rows = await getSettings(sql, orgId, { key: APPROVAL_PAUSE_KEY });
  const value = (rows as Array<Record<string, unknown>>).find((r) => r.key === APPROVAL_PAUSE_KEY)?.value;
  if (typeof value !== 'string' || !value) return NOT_PAUSED;
  try {
    return toView(JSON.parse(value) as ApprovalPauseState);
  } catch {
    return NOT_PAUSED;
  }
}

/**
 * GET /api/approval-pause — is the org currently skipping approval prompts?
 *
 * Returns { pause: {...}, window_hours: [...] }. Readable by any org member:
 * every operator looking at /approvals needs to know whether what they are
 * seeing is the whole picture, and hiding that from non-admins would recreate
 * the silent-posture problem this feature is trying not to repeat.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    return NextResponse.json({
      pause: await readPause(sql, orgId),
      window_hours: PAUSE_WINDOW_HOURS,
    });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVAL PAUSE GET');
  }
}

/**
 * POST /api/approval-pause — start (or extend) the pause (admin only).
 * Body: { hours: 1|4|8|24, reason?: string }
 *
 * While paused, a require_approval verdict proceeds instead of waiting for a
 * human. Blocks are untouched, and a verdict raised by an `ungrantable` rule
 * still interrupts — see applyApprovalPause in app/lib/guard/evaluate.ts.
 * Policies are NOT modified, so expiry restores the prior posture exactly.
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as { hours?: unknown; reason?: unknown };
    const hours = Number(body.hours);
    if (!PAUSE_WINDOW_HOURS.includes(hours as (typeof PAUSE_WINDOW_HOURS)[number])) {
      return NextResponse.json(
        { error: `hours must be one of ${PAUSE_WINDOW_HOURS.join(', ')}` },
        { status: 400 },
      );
    }
    const actor = getUserId(request) || 'admin';
    const now = new Date();
    // Absolute deadline, not a duration: expiry is then decided by comparing
    // it to the clock on every read, so no cron, reaper or write is needed to
    // end the pause and a forgotten one cannot outlive its window.
    const state: ApprovalPauseState = {
      until: new Date(now.getTime() + hours * 3_600_000).toISOString(),
      actor,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
      at: now.toISOString(),
    };

    const sql = getSql();
    await upsertSetting(sql, orgId, {
      key: APPROVAL_PAUSE_KEY,
      value: JSON.stringify(state),
      // 'general' on purpose, same as the halt key: the guard hot path reads
      // category-general once per org per TTL window, so riding it costs no
      // extra query. A different category would force a second read.
      category: 'general',
    });
    invalidateGuardSettingsCache(orgId);

    logActivity({
      orgId,
      actorId: actor,
      action: 'org.approvals_paused',
      resourceType: 'setting',
      resourceId: APPROVAL_PAUSE_KEY,
      details: { hours, until: state.until, reason: state.reason },
      request,
    }, sql);

    return NextResponse.json({ ok: true, pause: toView(state) });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVAL PAUSE POST');
  }
}

/**
 * DELETE /api/approval-pause — resume asking for approvals now (admin only).
 * Idempotent: clearing an already-expired or absent pause is a success.
 */
export async function DELETE(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const actor = getUserId(request) || 'admin';
    const sql = getSql();
    // Written as an expired marker rather than deleted: the activity log keeps
    // WHO resumed, and the row itself stays a readable record that a pause was
    // used at all. approvalPauseIsActive() treats a past `until` as inert.
    await upsertSetting(sql, orgId, {
      key: APPROVAL_PAUSE_KEY,
      value: JSON.stringify({
        until: new Date().toISOString(), actor, reason: null, at: new Date().toISOString(),
      } satisfies ApprovalPauseState),
      category: 'general',
    });
    // Eager: resuming governance must not lag a warm instance's cache.
    invalidateGuardSettingsCache(orgId);

    logActivity({
      orgId,
      actorId: actor,
      action: 'org.approvals_resumed',
      resourceType: 'setting',
      resourceId: APPROVAL_PAUSE_KEY,
      details: {},
      request,
    }, sql);

    return NextResponse.json({ ok: true, pause: NOT_PAUSED });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVAL PAUSE DELETE');
  }
}
