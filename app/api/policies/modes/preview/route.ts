export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { POLICY_MODE_CATALOG } from '../../../../lib/policy-modes/catalog';
import { compileMode, nominalDecision, summarizeModePack, UnknownPolicyModeError } from '../../../../lib/policy-modes/compile';
import { previewModeFriction } from '../../../../lib/policy-modes/friction';

/**
 * POST /api/policies/modes/preview — compile a mode and preview its effect
 * WITHOUT writing anything. Body: { mode_id: string, days?: number }.
 * Returns the generated policy list, a decision summary, and a best-effort
 * friction simulation against recent history (honest empty state when none).
 * Unknown mode_id → 400. Read-only; open to org members (like generate dry_run).
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));
    const modeId = body?.mode_id;
    const days = typeof body?.days === 'number' && body.days > 0 ? body.days : 7;

    const mode = typeof modeId === 'string' ? POLICY_MODE_CATALOG[modeId] : undefined;
    if (!modeId || !mode) {
      return NextResponse.json(
        { error: `Unknown policy mode: ${typeof modeId === 'string' ? modeId : '(missing mode_id)'}`, code: 'UNKNOWN_MODE' },
        { status: 400 },
      );
    }

    const policies = compileMode(modeId);
    const friction = await previewModeFriction(sql, orgId, policies, days);

    return NextResponse.json({
      mode,
      policies: policies.map((p) => ({
        name: p.name,
        policy_type: p.policy_type,
        decision: nominalDecision(p),
        rules: p.rules,
      })),
      summary: summarizeModePack(policies),
      friction,
    });
  } catch (err) {
    if (err instanceof UnknownPolicyModeError) {
      return NextResponse.json({ error: err.message, code: 'UNKNOWN_MODE' }, { status: 400 });
    }
    return apiErrorResponse(err, 'POLICY_MODES PREVIEW');
  }
}
