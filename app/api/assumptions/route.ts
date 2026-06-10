export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { validateAssumption } from '../../lib/validate.js';
import { getOrgId } from '../../lib/org';
import { redactAny } from '../../lib/security';
import { listAssumptions, createAssumption } from '../../lib/repositories/assumptions.repository';
import { hasAction } from '../../lib/repositories/actions.repository';
import crypto from 'crypto';


export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const validated = searchParams.get('validated');
    const stale = searchParams.get('stale');
    const drift = searchParams.get('drift');
    const action_id = searchParams.get('action_id');
    const agent_id = searchParams.get('agent_id');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    const result = await listAssumptions(sql, orgId, {
      validated,
      stale,
      action_id,
      agent_id,
      limit,
      offset,
    });

    const assumptions = result.assumptions;
    const total = result.total;

    // Drift scoring: calculate per-assumption risk score based on age and validation state
    if (drift === 'true') {
      const now = Date.now();
      let atRisk = 0;
      for (const asm of assumptions) {
        if (asm.validated === 1) {
          asm.drift_score = 0;
        } else if (asm.invalidated === 1) {
          asm.drift_score = null;
        } else {
          // Unvalidated: drift score increases with age (0-100 over 30 days)
          const createdAt = new Date(asm.created_at as string | number | Date).getTime();
          const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);
          asm.drift_score = Math.min(100, Math.round((daysOld / 30) * 100));
          if ((asm.drift_score as number) >= 50) atRisk++;
        }
      }

      return NextResponse.json({
        assumptions,
        total,
        drift_summary: {
          total,
          at_risk: atRisk,
          validated: assumptions.filter((a: Record<string, unknown>) => a.validated === 1).length,
          invalidated: assumptions.filter((a: Record<string, unknown>) => a.invalidated === 1).length,
          unvalidated: assumptions.filter((a: Record<string, unknown>) => a.validated === 0 && a.invalidated === 0).length
        },
        lastUpdated: new Date().toISOString()
      });
    }

    return NextResponse.json({
      assumptions,
      total,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Assumptions API GET error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching assumptions', assumptions: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateAssumption(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // SECURITY: redact likely secrets before storing assumption fields.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    for (const k of ['assumption', 'basis', 'invalidated_reason']) {
      if (data[k] != null) data[k] = redactAny(data[k], dlpFindings);
    }

    // Verify parent action exists
    const actionExists = await hasAction(sql, orgId, data.action_id);
    if (!actionExists) {
      return NextResponse.json({ error: 'Parent action not found' }, { status: 404 });
    }

    data.assumption_id = data.assumption_id || `asm_${crypto.randomUUID()}`;

    const newAssumption = await createAssumption(sql, orgId, data as Parameters<typeof createAssumption>[2]);

    return NextResponse.json({
      assumption: newAssumption,
      assumption_id: newAssumption?.assumption_id,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Assumptions API POST error:', error);
    if ((error as Error).message?.includes('unique') || (error as Error).message?.includes('duplicate')) {
      return NextResponse.json({ error: 'Assumption with this assumption_id already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'An error occurred while creating the assumption' }, { status: 500 });
  }
}
