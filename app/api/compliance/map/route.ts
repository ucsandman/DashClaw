export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { convertPolicies } from '../../../lib/guardrails/converter';
import { mapPolicies, loadFramework, listFrameworks } from '../../../lib/compliance/mapper';
import type { PolicyDoc } from '../../../lib/compliance/mapper';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import type { DashClawPolicy } from '../../../lib/guardrails/converter';

/**
 * GET /api/compliance/map?framework=soc2 — Map policies to a framework
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
    // DB rows match DashClawPolicy at runtime; GuardrailDocument↔PolicyDoc differ
    // structurally (ConvertedPolicy[] vs Policy[]) so bridge via unknown.
    const policyDoc = convertPolicies(policies as unknown as DashClawPolicy[], `org-${orgId}`) as unknown as PolicyDoc;
    const complianceMap = mapPolicies(policyDoc, framework) as Record<string, any>;

    // Expose each control's expected policy_mappings (from the framework
    // definition) alongside the mapping result so the UI can offer a
    // deterministic "create policy from this gap" prefill (A6). Additive only;
    // mapPolicies itself is unchanged.
    const mappingsById = new Map((framework.controls || []).map((c: { id: string; policy_mappings?: unknown[] }) => [c.id, c.policy_mappings || []]));
    const enriched = {
      ...complianceMap,
      controls: (complianceMap.controls || []).map((c: { control_id: string }) => ({
        ...c,
        policy_mappings: mappingsById.get(c.control_id) || [],
      })),
    };

    return NextResponse.json(enriched);
  } catch (err) {
    console.error('[COMPLIANCE/MAP] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
