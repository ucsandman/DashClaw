export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { convertPolicies } from '../../../lib/guardrails/converter';
import { mapPolicies, loadFramework, listFrameworks } from '../../../lib/compliance/mapper';
import type { DashClawPolicy } from '../../../lib/guardrails/converter';
import type { PolicyDoc } from '../../../lib/compliance/mapper';
import { generateMarkdownReport, generateJsonReport } from '../../../lib/compliance/reporter';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import { createSnapshot } from '../../../lib/repositories/compliance.repository';
import { analyzeGaps } from '../../../lib/compliance/analyzer';

/**
 * GET /api/compliance/report?framework=soc2&format=md|json — Generate full compliance report
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const frameworkId = searchParams.get('framework');
    const format = searchParams.get('format') || 'md';

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
    // DB rows match DashClawPolicy at runtime; GuardrailDocument↔PolicyDoc differ
    // structurally (ConvertedPolicy[] vs Policy[]) so bridge via unknown.
    const policyDoc = convertPolicies(policies as unknown as DashClawPolicy[], `org-${orgId}`) as unknown as PolicyDoc;
    const complianceMap = mapPolicies(policyDoc, framework);

    let report: any;
    if (format === 'json') {
      report = generateJsonReport(complianceMap);
    } else {
      report = generateMarkdownReport(complianceMap);
    }

    // Save snapshot
    const gapAnalysis = analyzeGaps(complianceMap);
    const snapshotId = `cs_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await createSnapshot(sql, orgId, {
      id: snapshotId,
      framework: frameworkId,
      total_controls: complianceMap.summary.total_controls,
      covered: complianceMap.summary.covered,
      partial: complianceMap.summary.partial,
      gaps: complianceMap.summary.gaps,
      coverage_percentage: complianceMap.summary.coverage_percentage,
      risk_level: gapAnalysis.risk_assessment.overall_risk,
      full_report: format === 'json' ? report : null,
    });

    return NextResponse.json({
      report,
      format,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[COMPLIANCE/REPORT] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
