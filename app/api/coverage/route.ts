export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { insertCoverageReport, getAgentCoverage } from '../../lib/repositories/coverage.repository';

// v4.2 coverage truth (docs/superpowers/specs/2026-07-04-coverage-truth.md).
// POST: the Stop hook's per-turn expected-vs-recorded evidence, one fail-silent
// report per turn. GET: the per-agent coverage summary the /agents surface reads.

const MAX_COUNT = 1_000_000; // truth cap — recorded MAY exceed expected; nothing is clamped below it.
const MAX_STR = 200;

/** A non-negative integer within the truth cap, or null when the value is not one. */
function toBoundedCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return Math.min(n, MAX_COUNT);
}

function optString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  return value.slice(0, MAX_STR);
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Validation failed', details: ['request body must be a JSON object'] }, { status: 400 });
    }

    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
    if (!agentId || agentId.length > MAX_STR) {
      return NextResponse.json({ error: 'Validation failed', details: ['agent_id is required (non-empty string ≤ 200 chars)'] }, { status: 400 });
    }

    const expected = toBoundedCount(body.expected);
    const recorded = toBoundedCount(body.recorded);
    if (expected === null || recorded === null) {
      return NextResponse.json({ error: 'Validation failed', details: ['expected and recorded must be integers ≥ 0'] }, { status: 400 });
    }

    const report = await insertCoverageReport(sql, {
      orgId,
      agentId,
      harness: optString(body.harness),
      harnessSessionId: optString(body.harness_session_id),
      expected,
      recorded,
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'COVERAGE_POST');
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const raw = parseInt(searchParams.get('window_hours') || '', 10);
    const windowHours = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 168)) : 24;
    // Ephemeral diagnostic view (U2/U3 precedent): synthetic families included
    // so smoke/loadtest runs can prove the math; nothing persisted, real views
    // and posture never consume it.
    const includeSynthetic = searchParams.get('include_synthetic') === '1';

    const coverage = await getAgentCoverage(sql, orgId, windowHours, { includeSynthetic });

    return NextResponse.json({
      coverage,
      window_hours: windowHours,
      ...(includeSynthetic ? { synthetic_included: true } : {}),
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error, 'COVERAGE_GET');
  }
}
