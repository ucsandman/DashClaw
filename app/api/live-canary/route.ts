export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import {
  insertLiveCanaryRun,
  listLiveCanaryRunsForOrg,
  type LiveCanaryCheck,
} from '../../lib/repositories/live-canary.repository';

/**
 * v3.4 live-host canary (docs/superpowers/plans/2026-07-04-live-host-canary.md).
 *
 * POST — scripts/live-canary.mjs (hourly GitHub Actions cron) files its
 * verdict here after probing the production hosts as a real client. Runs
 * land in live_canary_runs only — never the action/guard ledgers — so the
 * canary's synthetic traffic is structurally invisible to posture scoring
 * and calibration mining.
 *
 * GET — latest runs for the caller's org (?limit=1..20, default 1). The
 * human surfaces are /setup ("Live host canary" card) and the posture
 * auditability finding; this endpoint is the machine-readable twin.
 */

const MAX_CHECKS = 50;
const MAX_SHORT = 200;
const MAX_LONG = 1000;

function invalid(field: string, reason: string): NextResponse {
  return NextResponse.json({ error: `invalid ${field}: ${reason}` }, { status: 400 });
}

function isShortString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_SHORT;
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return invalid('body', 'expected a JSON object');

    const { source, status, checks, startedAt, finishedAt } = body as Record<string, unknown>;

    if (status !== 'pass' && status !== 'fail') return invalid('status', "expected 'pass' or 'fail'");
    if (source !== undefined && !isShortString(source)) {
      return invalid('source', `expected a string of 1..${MAX_SHORT} chars`);
    }
    for (const [field, value] of [['startedAt', startedAt], ['finishedAt', finishedAt]] as const) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return invalid(field, 'expected an ISO timestamp');
      }
    }
    if (!Array.isArray(checks) || checks.length < 1 || checks.length > MAX_CHECKS) {
      return invalid('checks', `expected an array of 1..${MAX_CHECKS} probe results`);
    }
    const cleanChecks: LiveCanaryCheck[] = [];
    for (const c of checks) {
      if (!c || typeof c !== 'object') return invalid('checks', 'each entry must be an object');
      const { id, title, status: cStatus, detail, durationMs, target } = c as Record<string, unknown>;
      if (!isShortString(id)) return invalid('checks[].id', `expected a string of 1..${MAX_SHORT} chars`);
      if (!isShortString(title)) return invalid('checks[].title', `expected a string of 1..${MAX_SHORT} chars`);
      if (cStatus !== 'pass' && cStatus !== 'fail') return invalid('checks[].status', "expected 'pass' or 'fail'");
      if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_LONG)) {
        return invalid('checks[].detail', `expected a string of at most ${MAX_LONG} chars`);
      }
      if (target !== undefined && (typeof target !== 'string' || target.length > MAX_LONG)) {
        return invalid('checks[].target', `expected a string of at most ${MAX_LONG} chars`);
      }
      if (durationMs !== undefined && (typeof durationMs !== 'number' || !Number.isFinite(durationMs))) {
        return invalid('checks[].durationMs', 'expected a finite number');
      }
      cleanChecks.push({
        id, title, status: cStatus,
        ...(detail !== undefined ? { detail } : {}),
        ...(target !== undefined ? { target } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }

    const { id } = await insertLiveCanaryRun(sql, orgId, {
      source: (source as string | undefined) ?? 'github-actions',
      status,
      checks: cleanChecks,
      startedAt: startedAt as string,
      finishedAt: finishedAt as string,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'LIVE CANARY POST');
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const raw = new URL(request.url).searchParams.get('limit');
    const parsed = raw === null ? 1 : Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      return invalid('limit', 'expected an integer between 1 and 20');
    }
    const runs = await listLiveCanaryRunsForOrg(sql, orgId, parsed);
    return NextResponse.json({ runs });
  } catch (error) {
    return apiErrorResponse(error, 'LIVE CANARY GET');
  }
}
