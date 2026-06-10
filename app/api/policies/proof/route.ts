export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { convertPolicies } from '../../../lib/guardrails/converter';
import type { DashClawPolicy } from '../../../lib/guardrails/converter';
import { generateMarkdownReport, generateJsonReport } from '../../../lib/guardrails/report';
import type { PolicyDoc } from '../../../lib/guardrails/report';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';

/**
 * GET /api/policies/proof?format=md|json — Generate proof report
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'md';

    const policies = await getActivePolicies(sql, orgId);
    // DB rows (Record<string, unknown>[]) match the DashClawPolicy shape at runtime.
    const policyDoc = convertPolicies(policies as unknown as DashClawPolicy[], `org-${orgId}`);

    let report;
    if (format === 'json') {
      // GuardrailDocument is structurally compatible with PolicyDoc (project + policies);
      // ConvertedPolicy.rule is a superset of PolicyRule, so cast at the boundary.
      report = generateJsonReport(policyDoc as unknown as PolicyDoc);
    } else {
      report = generateMarkdownReport(policyDoc as unknown as PolicyDoc);
    }

    return NextResponse.json({
      report,
      format,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[POLICIES/PROOF] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
