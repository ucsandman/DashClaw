export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Calibrated interruption controller — operator surface API.
 * Theory: docs/architecture/governance-core-theory.md §1. UI: /calibration.
 *
 * GET  — controller snapshot: settings (mode, target rate), calibrated state
 *        (θ, labeled counts, long-run + windowed observed false-interruption
 *        rate), per-agent e-process alarms, recent adjudication events, and
 *        the org's active risk_threshold policies for θ-vs-policy context.
 * POST — admin-only controls: set mode ('off'|'shadow'|'relief'|'active'),
 *        set the target rate α, reset an agent alarm, reset the calibrated
 *        state. Mode/target live in the settings table (guard hot path reads
 *        them via the cached settings read); every change is audit-logged.
 *
 * Charter note (MAINTAINER.md §3): which arms of the controller run is a
 * human decision made HERE, by click. The controller moves interruptions,
 * never policy rows — standing policy changes still route to the tuning /
 * loosening proposal rails on /policies.
 */

import { NextResponse, after } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../../lib/org';
import { logActivity } from '../../../lib/audit';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getSettings, upsertSetting } from '../../../lib/repositories/settings.repository';
import {
  getCalibrationState,
  listCalibrationEvents,
  resetAgentAlarm,
  resetCalibrationState,
  type CalibrationEventRow,
} from '../../../lib/repositories/calibration-state.repository';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import {
  parseCalibrationSettings,
  freshCalibrationState,
  reliefReady,
  CALIBRATION_DEFAULTS,
  CALIBRATION_MODE_KEY,
  CALIBRATION_TARGET_KEY,
} from '../../../lib/guard/calibration';
import { invalidateGuardCalibrationCache, invalidateGuardSettingsCache } from '../../../lib/guard/caches';

/** Windowed observed rate over the most recent adjudications (display). */
const OBSERVED_WINDOW = 50;

function riskThresholdPolicies(policies: Array<Record<string, unknown>>): Array<{ id: string; name: string; threshold: number; action: string }> {
  const out: Array<{ id: string; name: string; threshold: number; action: string }> = [];
  for (const p of policies) {
    if (p.policy_type !== 'risk_threshold') continue;
    let rules: Record<string, unknown> = {};
    try { rules = JSON.parse(String(p.rules ?? '{}')); } catch { /* best-effort: malformed rules — policy still listed with defaults */ }
    out.push({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      threshold: Number(rules.threshold) || 80,
      action: typeof rules.action === 'string' ? rules.action : 'block',
    });
  }
  return out.sort((a, b) => a.threshold - b.threshold);
}

/** Days the observed rate must hold under target before 'active' is offered. */
const ACTIVE_ELIGIBLE_DAYS = 7;

/**
 * Is the two-armed mode ('active', UI label "Fewer and more") offerable?
 *
 * It is the only mode that can ADD an interruption, so it is offered only
 * once the observed false-interruption rate has held under target for seven
 * straight days: every UTC day in that window that saw at least one verdict
 * must come in at or under the target rate. No verdicts in the window means
 * no evidence, which means not eligible — never eligible by default.
 */
function isActiveEligible(events: CalibrationEventRow[], targetRate: number, now = Date.now()): boolean {
  const cutoff = now - ACTIVE_ELIGIBLE_DAYS * 24 * 60 * 60 * 1000;
  const byDay = new Map<string, { n: number; loss: number }>();
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (!Number.isFinite(t) || t < cutoff || t > now) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { n: 0, loss: 0 };
    bucket.n += 1;
    bucket.loss += e.loss ? 1 : 0;
    byDay.set(day, bucket);
  }
  if (byDay.size === 0) return false;
  for (const bucket of byDay.values()) {
    if (bucket.loss / bucket.n > targetRate) return false;
  }
  return true;
}

export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    const [settingRows, state, events, policies] = await Promise.all([
      getSettings(sql, orgId, { category: 'general' }),
      getCalibrationState(sql, orgId),
      listCalibrationEvents(sql, orgId, 200),
      getActivePolicies(sql, orgId).catch(() => [] as Record<string, unknown>[]),
    ]);
    const settings = parseCalibrationSettings(settingRows as Array<{ key?: unknown; value?: unknown }>);
    const effectiveState = state ?? freshCalibrationState();

    const recent = events.slice(0, OBSERVED_WINDOW);
    const observedWindowRate = recent.length > 0
      ? recent.reduce((s, e) => s + (e.loss ? 1 : 0), 0) / recent.length
      : null;

    const alarms = Object.entries(effectiveState.agents)
      .map(([agentId, a]) => ({ agent_id: agentId, e: a.e, n: a.n, denied: a.denied, alarmed_at: a.alarmed_at }))
      .sort((a, b) => b.e - a.e)
      .slice(0, 25);

    return NextResponse.json({
      settings: { mode: settings.mode, target_rate: settings.targetRate },
      state: {
        theta: effectiveState.theta,
        labeled_total: effectiveState.labeledTotal,
        labeled_live: effectiveState.labeledLive,
        labeled_benign: effectiveState.labeledBenign,
        labeled_denied: effectiveState.labeledDenied,
        loss_sum: effectiveState.lossSum,
        observed_rate: effectiveState.labeledTotal > 0
          ? effectiveState.lossSum / effectiveState.labeledTotal
          : null,
        observed_window_rate: observedWindowRate,
        observed_window: recent.length,
        relief_ceiling: effectiveState.reliefCeiling,
        // The demote arm's own readiness, so the page can say whether relief
        // is live or what it is still waiting for instead of showing a
        // threshold that never fires.
        // Both floors: total evidence AND live evidence. Retrospective group
        // verdicts count toward the first only, so sweeping the review feed
        // can never on its own make the demote arm ready.
        relief_ready: reliefReady(effectiveState),
        // The tighten arm's own gate: "Fewer and more" is the only mode that
        // can ADD an interruption, so the UI keeps it disabled until the
        // observed rate has held under target for seven straight days.
        active_eligible: isActiveEligible(events, settings.targetRate),
      },
      defaults: {
        gamma: CALIBRATION_DEFAULTS.gamma,
        alarm_at: CALIBRATION_DEFAULTS.alarmAt,
        p0: CALIBRATION_DEFAULTS.p0,
        theta_floor: CALIBRATION_DEFAULTS.thetaMin,
        relief_min_labels: CALIBRATION_DEFAULTS.reliefMinLabels,
        relief_min_live_labels: CALIBRATION_DEFAULTS.reliefMinLiveLabels,
      },
      alarms,
      events,
      risk_threshold_policies: riskThresholdPolicies(policies),
    });
  } catch (error) {
    return apiErrorResponse(error, 'CALIBRATION_CONTROLLER GET');
  }
}

const VALID_MODES = ['off', 'shadow', 'relief', 'active'];

export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const userId = getUserId(request);
    const body = await request.json().catch(() => ({})) as {
      mode?: string;
      target_rate?: number;
      reset_agent_alarm?: string;
      reset_state?: boolean;
    };

    const sql = getSql();
    const changes: Record<string, unknown> = {};

    if (body.mode !== undefined) {
      if (!VALID_MODES.includes(body.mode)) {
        return NextResponse.json({ error: `mode must be one of ${VALID_MODES.join(', ')}` }, { status: 400 });
      }
      await upsertSetting(sql, orgId, { key: CALIBRATION_MODE_KEY, value: body.mode, category: 'general' });
      changes.mode = body.mode;
    }

    if (body.target_rate !== undefined) {
      const rate = Number(body.target_rate);
      if (!Number.isFinite(rate) || rate < 0.01 || rate > 0.5) {
        return NextResponse.json({ error: 'target_rate must be between 0.01 and 0.5' }, { status: 400 });
      }
      await upsertSetting(sql, orgId, { key: CALIBRATION_TARGET_KEY, value: String(rate), category: 'general' });
      changes.target_rate = rate;
    }

    if (typeof body.reset_agent_alarm === 'string' && body.reset_agent_alarm) {
      const reset = await resetAgentAlarm(sql, orgId, body.reset_agent_alarm);
      if (!reset) {
        return NextResponse.json({ error: 'No calibration entry for that agent' }, { status: 404 });
      }
      changes.reset_agent_alarm = body.reset_agent_alarm;
    }

    if (body.reset_state === true) {
      await resetCalibrationState(sql, orgId);
      changes.reset_state = true;
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ error: 'Nothing to change — provide mode, target_rate, reset_agent_alarm, or reset_state' }, { status: 400 });
    }

    // A mode/target flip is an enforcement-posture change: reach the guard's
    // cached settings immediately on this instance (others converge ≤30s).
    invalidateGuardSettingsCache(orgId);
    invalidateGuardCalibrationCache(orgId);

    after(() => logActivity({
      orgId,
      actorId: userId || 'unknown',
      action: 'calibration.controller_updated',
      resourceType: 'calibration_controller',
      resourceId: orgId,
      details: changes,
      request,
    }, sql));

    return NextResponse.json({ success: true, changes });
  } catch (error) {
    return apiErrorResponse(error, 'CALIBRATION_CONTROLLER POST');
  }
}
