export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../../lib/db.js';
import { getOrgId, getOrgRole } from '../../../../lib/org.js';
import { apiErrorResponse } from '../../../../lib/apiErrors.js';
import { POLICY_MODE_CATALOG } from '../../../../lib/policy-modes/catalog.js';
import { compileMode, UnknownPolicyModeError } from '../../../../lib/policy-modes/compile.js';
import { findPolicyByName, insertPolicy } from '../../../../lib/repositories/guardrails.repository.js';

/**
 * POST /api/policies/modes/import — apply a mode by compiling it into ordinary
 * guard policies and persisting them via the normal storage path. Body:
 * { mode_id: string }. Policies are inserted ACTIVE (the mode takes effect),
 * carry a `[<Mode Name>] ...` name + a `_mode` tag in rules, and dedup by name.
 * Admin-only (mirrors /api/policies/import). Unknown mode_id → 400.
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const modeId = body?.mode_id;
    const mode = typeof modeId === 'string' ? POLICY_MODE_CATALOG[modeId] : undefined;
    if (!modeId || !mode) {
      return NextResponse.json(
        { error: `Unknown policy mode: ${typeof modeId === 'string' ? modeId : '(missing mode_id)'}`, code: 'UNKNOWN_MODE' },
        { status: 400 },
      );
    }

    const policies = compileMode(modeId);
    const imported: Array<Record<string, unknown>> = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const p of policies) {
      try {
        const existing = await findPolicyByName(sql, orgId, p.name);
        if (existing.length > 0) {
          skipped.push(p.name);
          continue;
        }
        const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        const result = (await insertPolicy(sql, orgId, {
          id,
          name: p.name,
          policyType: p.policy_type,
          rules: JSON.stringify(p.rules),
          active: p.active,
        })) as Record<string, unknown> | null;
        imported.push({
          id: result?.id ?? id,
          name: p.name,
          policy_type: p.policy_type,
          active: result?.active ?? p.active,
        });
      } catch (err) {
        errors.push(`Failed to import "${p.name}": ${(err as Error).message}`);
      }
    }

    return NextResponse.json(
      {
        mode_id: modeId,
        imported: imported.length,
        skipped: skipped.length,
        errors,
        policies: imported,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof UnknownPolicyModeError) {
      return NextResponse.json({ error: err.message, code: 'UNKNOWN_MODE' }, { status: 400 });
    }
    return apiErrorResponse(err, 'POLICY_MODES IMPORT');
  }
}
