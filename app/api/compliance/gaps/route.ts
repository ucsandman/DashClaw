export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { convertPolicies } from '../../../lib/guardrails/converter';
import { mapPolicies, loadFramework, listFrameworks } from '../../../lib/compliance/mapper';
import { analyzeGaps } from '../../../lib/compliance/analyzer';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';

/**
 * GET /api/compliance/gaps?framework=soc2 — Run gap analysis
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const frameworkId = searchParams.get('framework');

    if (!frameworkId) {
      return NextResponse.json({
        error: 'framework query parameter is required',
        available: listFrameworks(),
      }, { status: 400 });
    }

    let framework: any;
    try {
      framework = loadFramework(frameworkId);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message, available: listFrameworks() }, { status: 404 });
    }

    const policies = await getActivePolicies(sql, orgId);
    // getActivePolicies returns Record<string,unknown>[] rows that match the
    // DashClawPolicy shape at runtime; convertPolicies returns a GuardrailDocument
    // which is structurally a PolicyDoc for the mapper.
    const policyDoc = convertPolicies(policies as Parameters<typeof convertPolicies>[0], `org-${orgId}`);
    const complianceMap = mapPolicies(policyDoc as unknown as Parameters<typeof mapPolicies>[0], framework);
    const gapAnalysis = analyzeGaps(complianceMap);

    return NextResponse.json(gapAnalysis);
  } catch (err) {
    console.error('[COMPLIANCE/GAPS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
