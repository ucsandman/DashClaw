export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { convertPolicies } from '../../../lib/guardrails/converter';
import { evaluateGuardrailPolicy } from '../../../lib/guardrails/evaluator';
import { evaluatePolicy } from '../../../lib/guard';
import { getActivePolicies, createTestRun } from '../../../lib/repositories/guardrails.repository';

/**
 * POST /api/policies/test
 *
 * Two modes:
 * - Recipe mode (body has policy_type + rules): run inline test recipes
 *   (body.tests, or rules.tests) through the real enforcement evaluator
 *   (the same one /api/policies/simulate uses) and report the decision each
 *   recipe produced versus the decision it expected. This proves a policy
 *   behaves as intended before it is saved or activated.
 * - Legacy mode (no recipe body): run the derived tests of the current active
 *   org policies through the guardrails conversion path. Unchanged.
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    if (body && typeof body === 'object' && body.policy_type && body.rules) {
      return await runRecipeMode(sql, orgId, body);
    }

    return await runLegacyMode(sql, orgId);
  } catch (err) {
    console.error('[POLICIES/TEST] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function safeParseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(value as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function runRecipeMode(sql: ReturnType<typeof getSql>, orgId: string, body: Record<string, any>) {
  const { policy_type } = body;

  let rules;
  try {
    rules = typeof body.rules === 'string' ? JSON.parse(body.rules) : body.rules;
  } catch {
    return NextResponse.json({ error: 'rules must be valid JSON' }, { status: 400 });
  }
  if (!rules || typeof rules !== 'object') {
    return NextResponse.json({ error: 'rules must be an object' }, { status: 400 });
  }

  const recipes = Array.isArray(body.tests)
    ? body.tests
    : (Array.isArray(rules.tests) ? rules.tests : []);

  const dummyPolicy = { id: 'recipe_1', name: 'Recipe', policy_type };
  const testResults = [];
  let passed = 0;

  for (const recipe of recipes) {
    const input = (recipe && typeof recipe.input === 'object' && recipe.input) || {};
    const context = {
      ...input,
      systems_touched: typeof input.systems_touched === 'string'
        ? safeParseArray(input.systems_touched)
        : input.systems_touched,
    };
    const expected = recipe?.expect?.decision || 'allow';
    const result = await evaluatePolicy(dummyPolicy as unknown as Parameters<typeof evaluatePolicy>[0], rules, context, sql, orgId, undefined as unknown as number);
    const actual = result && result.action ? result.action : 'allow';
    const testPassed = actual === expected;
    if (testPassed) passed++;
    testResults.push({
      name: recipe?.name || 'unnamed',
      passed: testPassed,
      expected,
      actual,
      reason: result?.reason || null,
    });
  }

  const results = {
    total_policies: 1,
    total_tests: recipes.length,
    passed,
    failed: recipes.length - passed,
    success: passed === recipes.length,
    details: [{ policy_id: 'recipe', policy_name: `${policy_type} recipe`, tests: testResults }],
  };

  return NextResponse.json({ results, mode: 'recipe', generated_at: new Date().toISOString() });
}

async function runLegacyMode(sql: ReturnType<typeof getSql>, orgId: string) {
  const policies = await getActivePolicies(sql, orgId);

  if (policies.length === 0) {
    return NextResponse.json({
      results: { total_policies: 0, total_tests: 0, passed: 0, failed: 0, success: true, details: [] },
      generated_at: new Date().toISOString(),
    });
  }

  // getActivePolicies returns Record<string,unknown>[] rows that match the
  // DashClawPolicy shape at runtime.
  const policyDoc = convertPolicies(policies as Parameters<typeof convertPolicies>[0], `org-${orgId}`) as { policies: any[] };

  const details = [];
  let totalTests = 0;
  let passed = 0;

  for (const policy of policyDoc.policies) {
    const testResults = [];
    for (const testCase of policy.tests || []) {
      totalTests++;
      const result = evaluateGuardrailPolicy(policy as unknown as Parameters<typeof evaluateGuardrailPolicy>[0], testCase.input);
      const testPassed = result.allowed === testCase.expect.allowed;
      if (testPassed) passed++;
      testResults.push({
        name: testCase.name,
        passed: testPassed,
        expected: testCase.expect.allowed,
        actual: result.allowed,
        reason: result.reason || null,
      });
    }
    details.push({
      policy_id: policy.id,
      policy_name: policy.description,
      tests: testResults,
    });
  }

  const results = {
    total_policies: policyDoc.policies.length,
    total_tests: totalTests,
    passed,
    failed: totalTests - passed,
    success: passed === totalTests,
    details,
  };

  // Store test run result
  const runId = `gtr_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  await createTestRun(sql, orgId, { id: runId, ...results, triggered_by: 'manual' });

  return NextResponse.json({ results, generated_at: new Date().toISOString() });
}
