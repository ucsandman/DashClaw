export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  getActivePolicies,
  getDecisionCountsByPolicy,
} from '../../../lib/repositories/guardrails.repository';
import { buildContract } from '../../../lib/policy-modes/contract';

type PolicyRow = {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  active?: number;
};

/** GET /api/policies/contract — the interruption contract for the org. */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const [active, counts] = await Promise.all([
      getActivePolicies(sql, orgId),
      getDecisionCountsByPolicy(sql, orgId, 7).catch(() => ({})),
    ]);

    // getDecisionCountsByPolicy returns Record<string, { fired: number; lastFiredAt: string | null }>
    // but buildContract expects Record<string, number> — map here.
    const fireCounts: Record<string, number> = Object.fromEntries(
      Object.entries(counts).map(([id, v]) => [id, Number((v as { fired?: unknown })?.fired) || 0]),
    );

    const contract = buildContract(active as PolicyRow[], fireCounts);
    return NextResponse.json(contract);
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_CONTRACT GET');
  }
}
