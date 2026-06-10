export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { generatePolicySuggestions } from '../../../lib/policy-suggestions';
import { insertPolicy } from '../../../lib/repositories/guardrails.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const suggestions = await generatePolicySuggestions(sql, orgId);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[learning/suggestions] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();
    const { action, suggestion_index } = body;

    if (action === 'accept') {
      const suggestions = await generatePolicySuggestions(sql, orgId);
      const suggestion = suggestions[suggestion_index];
      if (!suggestion) {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }

      const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const policy = await insertPolicy(sql, orgId, {
        id,
        name: suggestion.suggested_policy.name,
        policyType: suggestion.suggested_policy.policy_type,
        rules: suggestion.suggested_policy.rules,
        agentIds: suggestion.suggested_policy.agent_ids,
      });
      return NextResponse.json({ accepted: true, policy });
    }

    return NextResponse.json({ error: 'Invalid action. Use "accept".' }, { status: 400 });
  } catch (err) {
    console.error('[learning/suggestions] POST error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
