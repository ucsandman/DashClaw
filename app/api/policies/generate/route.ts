export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { generatePolicies } from '../../../lib/policy-generator';
import { insertPolicy } from '../../../lib/repositories/guardrails.repository';
import { parseRules, toWatchTier, watchPolicyType } from '../../../lib/guardrails/short-list';

const MAX_INPUT_LENGTH = 5000;

/**
 * POST /api/policies/generate
 *
 * Generate guard policies from natural language input.
 * Body: { input_text: string, dry_run?: boolean (default true), answers?: [{ id, value }] }
 *
 * dry_run=true: Returns { drafts, assumptions, clarifications, warnings, input_hash }.
 * dry_run=false: Creates the drafts in the database (admin only).
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const body = await request.json();

    const { input_text, dry_run = true, answers = [] } = body;

    // Creating policies is an admin-only write, matching /api/policies and
    // /api/policies/import. dry_run previews stay open to any org member.
    if (!dry_run && getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!input_text || typeof input_text !== 'string' || input_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'input_text is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (input_text.length > MAX_INPUT_LENGTH) {
      return NextResponse.json(
        { error: `input_text exceeds maximum length of ${MAX_INPUT_LENGTH} characters` },
        { status: 400 }
      );
    }

    const result = await generatePolicies(sql, orgId, input_text.trim(), Array.isArray(answers) ? answers : []);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    if (dry_run) {
      return NextResponse.json({
        drafts: result.drafts,
        assumptions: result.assumptions,
        clarifications: result.clarifications,
        warnings: result.warnings,
        input_hash: result.input_hash,
      });
    }

    // dry_run=false — create the drafts via repository
    const createdPolicies = [];
    for (const policy of result.drafts ?? []) {
      const policyId = `gp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      // Short List (spec 2.3): a generated draft is stored in Watch. This
      // route writes past the /api/policies admission gate, so the demotion
      // happens here or the generator mints interrupting rules unreviewed.
      await insertPolicy(sql, orgId, {
        id: policyId,
        name: policy.name,
        policyType: watchPolicyType(policy.policy_type),
        rules: JSON.stringify(toWatchTier(parseRules(policy.rules), policy.policy_type)),
      });
      createdPolicies.push(policyId);
    }

    return NextResponse.json({
      created_policies: createdPolicies,
      count: createdPolicies.length,
    });
  } catch (err) {
    return apiErrorResponse(err, 'POLICIES GENERATE');
  }
}
