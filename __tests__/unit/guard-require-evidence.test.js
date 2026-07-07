import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';

// require_evidence (17th policy type): raises the decision when a matching call
// was graded from self-declared intent (no act attached). Modeled on
// non_fabrication's fail-closed template.

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: vi.fn() }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, evaluatePolicy, __resetGuardCaches } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';

const dummySql = Object.assign(async () => [], { query: async () => [] });
const rePolicy = { id: 'gp_re', name: 'Evidence Required', policy_type: 'require_evidence' };

const makePolicy = (rules) => ({
  id: 'gp_re',
  name: 'Evidence Required',
  policy_type: 'require_evidence',
  rules: JSON.stringify(rules),
});

describe('validatePolicy — require_evidence', () => {
  const base = (rules) => validatePolicy({ name: 'ER', policy_type: 'require_evidence', rules: JSON.stringify(rules) });

  it('accepts action_types + enforcement', () => {
    expect(base({ action_types: ['deploy'], enforcement: 'require_approval' }).valid).toBe(true);
  });
  it('accepts empty rules (applies to all, warn default)', () => {
    expect(base({}).valid).toBe(true);
  });
  it('rejects a non-array action_types', () => {
    expect(base({ action_types: 'deploy' }).valid).toBe(false);
  });
  it('rejects an invalid enforcement', () => {
    const r = base({ enforcement: 'allow' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('enforcement'))).toBe(true);
  });
});

describe('evaluateRequireEvidencePolicy (via evaluatePolicy) — the matrix', () => {
  it('declared + matching action_type + enforcement=block → block', async () => {
    const r = await evaluatePolicy(rePolicy, { action_types: ['deploy'], enforcement: 'block' }, { action_type: 'deploy', intent_source: 'declared' }, dummySql, 'org_1', 0);
    expect(r).toMatchObject({ action: 'block' });
  });

  it('declared + matching + enforcement=require_approval → require_approval', async () => {
    const r = await evaluatePolicy(rePolicy, { action_types: ['deploy'], enforcement: 'require_approval' }, { action_type: 'deploy', intent_source: 'declared' }, dummySql, 'org_1', 0);
    expect(r).toMatchObject({ action: 'require_approval' });
  });

  it('declared + matching + no enforcement → warn (default)', async () => {
    const r = await evaluatePolicy(rePolicy, { action_types: ['deploy'] }, { action_type: 'deploy', intent_source: 'declared' }, dummySql, 'org_1', 0);
    expect(r).toMatchObject({ action: 'warn' });
  });

  it('evidence-graded call → no-op (null), even when action_type matches', async () => {
    const r = await evaluatePolicy(rePolicy, { action_types: ['deploy'], enforcement: 'block' }, { action_type: 'deploy', intent_source: 'evidence' }, dummySql, 'org_1', 0);
    expect(r).toBeNull();
  });

  it('non-matching action_type → no-op (null)', async () => {
    const r = await evaluatePolicy(rePolicy, { action_types: ['deploy'], enforcement: 'block' }, { action_type: 'api', intent_source: 'declared' }, dummySql, 'org_1', 0);
    expect(r).toBeNull();
  });

  it('empty action_types = all → matches any declared call', async () => {
    const r = await evaluatePolicy(rePolicy, { enforcement: 'block' }, { action_type: 'api', intent_source: 'declared' }, dummySql, 'org_1', 0);
    expect(r).toMatchObject({ action: 'block' });
  });
});

describe('evaluateGuard — require_evidence end to end', () => {
  beforeEach(() => __resetGuardCaches());

  it('escalates a declared-only deploy to require_approval', async () => {
    const sql = createSqlMock({ taggedResponses: [[makePolicy({ action_types: ['deploy'], enforcement: 'require_approval' })]] });
    const result = await evaluateGuard('org_re1', { action_type: 'deploy', agent_id: 'a1' }, sql);
    expect(result.decision).toBe('require_approval');
    expect(result.intent_source).toBe('declared');
  });

  it('does NOT escalate when the deploy carries an act (evidence-graded)', async () => {
    const sql = createSqlMock({ taggedResponses: [[makePolicy({ action_types: ['deploy'], enforcement: 'require_approval' })]] });
    const result = await evaluateGuard('org_re2', {
      action_type: 'deploy',
      agent_id: 'a2',
      act: { kind: 'shell', command: 'vercel deploy --prod' },
    }, sql);
    expect(result.decision).toBe('allow');
    expect(result.intent_source).toBe('evidence');
  });
});
